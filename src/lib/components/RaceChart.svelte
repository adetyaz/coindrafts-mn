<script lang="ts">
	// Live race chart, built on uPlot (21KB gzipped, canvas, designed for
	// many-series streaming time data — which is exactly this: up to 10 tokens
	// updating every few seconds).
	//
	// Replaces a hand-rolled SVG that drew bare polylines with no axes, no
	// cursor and no way to read a value off it. What's here that wasn't:
	// a crosshair that reports every token's position at the moment you hover,
	// a legend you can click to isolate a line, real time and percent axes,
	// and a highlighted leader.
	//
	// uPlot renders to canvas, so it can't read CSS custom properties — theme
	// colours are resolved from the DOM on mount and re-resolved when the theme
	// changes, then handed over as literals.
	//
	// FUTURE: a WebGL/Three.js renderer is planned for something more dramatic
	// than a 2D chart can do (see new-feature-ideas.md §8). The prop contract
	// here — racers / timestamps / values — is deliberately renderer-agnostic so
	// that swap needs no change to the page, the /live endpoint or sampling.
	import { onMount, onDestroy, untrack } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';

	export type Racer = {
		key: string;
		label: string;
		sector: string;
		colour: string;
		mine: boolean;
	};

	let {
		racers,
		timestamps,
		values,
		height = 340
	}: {
		racers: Racer[];
		/** ms epoch per sample */
		timestamps: number[];
		/** values[racerIndex][sampleIndex], already % change from entry */
		values: number[][];
		height?: number;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let chart: uPlot | null = null;
	let width = $state(900);

	// Index the cursor is over, or null when it isn't on the plot.
	let cursorIdx = $state<number | null>(null);
	// Series the user has isolated by clicking a legend row.
	let isolated = $state<string | null>(null);

	function themeColours() {
		const cs = getComputedStyle(document.documentElement);
		const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
		return {
			grid: v('--color-border', '#E1E8E6'),
			axis: v('--color-text-muted', '#5C6B66'),
			surface: v('--color-surface', '#FFFFFF')
		};
	}

	/** rgba() from a hex swatch, for gradient stops. */
	function tint(hex: string, alpha: number) {
		const h = hex.replace('#', '').trim();
		if (h.length !== 6) return hex;
		const n = parseInt(h, 16);
		return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
	}

	// Percent moves inside a short game are small — often hundredths of a
	// percent. Fixed 2dp would render most of the race as a flat row of
	// "+0.00%", so precision follows the visible range.
	function precisionFor(span: number) {
		if (span >= 5) return 1;
		if (span >= 0.5) return 2;
		if (span >= 0.05) return 3;
		return 4;
	}

	const visibleSpan = $derived.by(() => {
		let min = Infinity;
		let max = -Infinity;
		for (const row of values) {
			for (const v of row) {
				if (v == null) continue;
				if (v < min) min = v;
				if (v > max) max = v;
			}
		}
		if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
		return max - min;
	});

	function buildOptions(): uPlot.Options {
		const c = themeColours();

		return {
			width,
			height,
			padding: [16, 18, 4, 6],
			legend: { show: false },
			cursor: {
				// A soft proximity focus so hovering near a line highlights it rather
				// than demanding pixel accuracy — 10 lines get close together.
				focus: { prox: 26 },
				points: { size: 8, width: 2 },
				drag: { x: false, y: false }
			},
			scales: {
				x: { time: true },
				// No forced zero. A 0.04% spread across the field is the whole story
				// in a 10-minute game; anchoring to zero would flatten it to a
				// straight line. uPlot auto-fits, and the axis labels carry the real
				// scale so a small move still reads as a small move.
				y: { auto: true }
			},
			axes: [
				{
					stroke: c.axis,
					grid: { stroke: c.grid, width: 1, dash: [2, 4] },
					ticks: { stroke: c.grid, width: 1, size: 4 },
					font: '11px Archivo, system-ui, sans-serif',
					size: 32
				},
				{
					stroke: c.axis,
					grid: { stroke: c.grid, width: 1, dash: [2, 4] },
					ticks: { stroke: c.grid, width: 1, size: 4 },
					font: '11px Archivo, system-ui, sans-serif',
					size: 62,
					// Precision is derived from the splits on every draw, not captured
					// once at build time — the chart is updated with setData() rather
					// than rebuilt, so anything captured here would freeze at whatever
					// the range happened to be on the first tick.
					values: (_u, splits) => {
						const span = splits.length > 1 ? splits[splits.length - 1] - splits[0] : 0;
						const p = precisionFor(span);
						return splits.map((s) => `${s > 0 ? '+' : ''}${s.toFixed(p)}%`);
					}
				}
			],
			series: [
				{},
				...racers.map((r) => ({
					label: r.label,
					stroke: r.colour,
					// Yours reads as the primary line; the opponent's is thinner and
					// dashed, so the two sides stay distinguishable at a glance even
					// when sector colours repeat across both lineups.
					width: r.mine ? 2.25 : 1.4,
					dash: r.mine ? undefined : [5, 4],
					alpha: r.mine ? 1 : 0.5,
					points: { show: false },
					// Smooth curves rather than straight segments between samples —
					// a race should read as motion, not as a sawtooth.
					paths: uPlot.paths.spline?.(),
					// Only your own lines get a fill; ten overlapping washes would be
					// mud. Fades to nothing so it reads as depth, not a block.
					fill: r.mine
						? (u: uPlot) => {
								const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
								g.addColorStop(0, tint(r.colour, 0.22));
								g.addColorStop(1, tint(r.colour, 0));
								return g;
							}
						: undefined
				}))
			],
			hooks: {
				setCursor: [
					(u) => {
						cursorIdx = u.cursor.idx ?? null;
					}
				],
				draw: [
					(u) => {
						const ctx = u.ctx;
						const xs = u.data[0] as number[];
						if (!xs || xs.length === 0) return;

						ctx.save();
						ctx.beginPath();
						ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
						ctx.clip();

						// Leading edge: a glowing dot at each line's head, so the eye
						// lands on "where things stand right now" before reading the
						// history behind it. Drawn after uPlot so nothing overpaints it.
						racers.forEach((r, si) => {
							if (isolated && isolated !== r.key) return;
							const row = u.data[si + 1] as (number | null)[];
							if (!row) return;
							let idx = row.length - 1;
							while (idx >= 0 && row[idx] == null) idx--;
							if (idx < 0) return;

							const cx = u.valToPos(xs[idx], 'x', true);
							const cy = u.valToPos(row[idx] as number, 'y', true);
							if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

							ctx.shadowColor = tint(r.colour, r.mine ? 0.85 : 0.4);
							ctx.shadowBlur = r.mine ? 14 : 7;
							ctx.fillStyle = r.colour;
							ctx.globalAlpha = r.mine ? 1 : 0.55;
							ctx.beginPath();
							ctx.arc(cx, cy, r.mine ? 4.25 : 3, 0, Math.PI * 2);
							ctx.fill();

							// A pale core keeps the dot legible where lines overlap.
							ctx.shadowBlur = 0;
							ctx.fillStyle = c.surface;
							ctx.globalAlpha = r.mine ? 0.95 : 0.5;
							ctx.beginPath();
							ctx.arc(cx, cy, r.mine ? 1.6 : 1.1, 0, Math.PI * 2);
							ctx.fill();
						});

						ctx.restore();
					}
				]
			}
		};
	}

	function currentData(): uPlot.AlignedData {
		const xs = timestamps.map((t) => t / 1000); // uPlot time scale is seconds
		const ys = racers.map((r, i) => {
			const row = values[i] ?? [];
			// A hidden series still has to be present — nulls keep the alignment.
			if (isolated && isolated !== r.key) return xs.map(() => null);
			return xs.map((_, j) => (row[j] ?? null) as number | null);
		});
		return [xs, ...ys] as unknown as uPlot.AlignedData;
	}

	function rebuild() {
		if (!host) return;
		chart?.destroy();
		chart = new uPlot(buildOptions(), currentData(), host);
	}

	onMount(() => {
		width = host?.clientWidth ?? 900;
		rebuild();

		const ro = new ResizeObserver(() => {
			const w = host?.clientWidth ?? width;
			if (w > 0 && Math.abs(w - width) > 1) {
				width = w;
				chart?.setSize({ width: w, height });
			}
		});
		if (host) ro.observe(host);

		// Canvas can't follow CSS variables, so the chart is rebuilt when the
		// theme flips rather than left painting last theme's greys.
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onTheme = () => rebuild();
		mq.addEventListener('change', onTheme);

		return () => {
			ro.disconnect();
			mq.removeEventListener('change', onTheme);
		};
	});

	onDestroy(() => chart?.destroy());

	// Push new samples without tearing the chart down — this runs every poll.
	$effect(() => {
		void timestamps;
		void values;
		void isolated;
		untrack(() => chart)?.setData(currentData());
	});

	function valueAt(i: number): number | null {
		const row = values[i];
		if (!row || row.length === 0) return null;
		const idx = cursorIdx ?? row.length - 1;
		return row[idx] ?? row[row.length - 1] ?? null;
	}

	const legendPrecision = $derived(precisionFor(visibleSpan));

	function fmtPct(v: number | null) {
		if (v == null) return '—';
		return `${v >= 0 ? '+' : ''}${v.toFixed(legendPrecision)}%`;
	}

	// Stated plainly under the chart. The y-axis auto-fits, so a 0.03% spread
	// fills the full height — dramatic, and potentially misleading without the
	// real range in view.
	const spanLabel = $derived(
		visibleSpan === 0 ? '—' : `${visibleSpan.toFixed(precisionFor(visibleSpan))}% spread`
	);

	const leaderIdx = $derived.by(() => {
		let best = -1;
		let bestVal = -Infinity;
		racers.forEach((_, i) => {
			const v = valueAt(i);
			if (v != null && v > bestVal) {
				bestVal = v;
				best = i;
			}
		});
		return best;
	});

	const hoverLabel = $derived.by(() => {
		if (cursorIdx == null || !timestamps[cursorIdx]) return 'now';
		return new Date(timestamps[cursorIdx]).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	});
</script>

<div class="chart-wrap">
	<div bind:this={host} class="chart-host" style="height:{height}px"></div>

	<div class="legend-head">
		<span class="legend-time">{hoverLabel}</span>
		<span class="legend-span" title="Distance between the best and worst performer — the chart auto-zooms to fit it">
			{spanLabel}
		</span>
		{#if isolated}
			<button type="button" class="legend-clear" onclick={() => (isolated = null)}>Show all</button>
		{:else}
			<span class="legend-hint">Hover to scrub · click a token to isolate</span>
		{/if}
	</div>

	<div class="legend">
		{#each racers as r, i (r.key)}
			{@const v = valueAt(i)}
			<button
				type="button"
				class="legend-row"
				class:dim={isolated != null && isolated !== r.key}
				class:leader={i === leaderIdx}
				onclick={() => (isolated = isolated === r.key ? null : r.key)}
				aria-pressed={isolated === r.key}
			>
				<span class="swatch" style="background:{r.colour};{r.mine ? '' : 'opacity:.55'}"></span>
				<span class="sym">{r.label}</span>
				<span class="who">{r.mine ? 'you' : 'opp'}</span>
				<span class="val" style="color:{(v ?? 0) >= 0 ? 'var(--color-mint-ink)' : 'var(--color-red-ink)'}">
					{fmtPct(v)}
				</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.chart-wrap {
		border: 1px solid var(--color-border);
		border-radius: 20px;
		background: var(--color-surface);
		padding: 14px 14px 10px;
		overflow: hidden;
	}
	.chart-host {
		width: 100%;
	}
	.legend-head {
		display: flex;
		align-items: baseline;
		gap: 14px;
		padding: 10px 4px 8px;
		border-top: 1px solid var(--color-border);
		margin-top: 8px;
	}
	.legend-time {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		font-weight: 700;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
	.legend-hint,
	.legend-clear {
		font-size: 11px;
		color: var(--color-text-muted);
		margin-left: auto;
	}
	.legend-span {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		font-weight: 700;
		color: var(--color-text-muted);
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--color-surface-alt);
		font-variant-numeric: tabular-nums;
		cursor: help;
	}
	.legend-clear {
		background: none;
		border: none;
		cursor: pointer;
		font-weight: 700;
		text-decoration: underline;
	}
	.legend {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
		gap: 2px;
	}
	.legend-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 8px;
		border: none;
		border-radius: 9px;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 0.12s;
	}
	.legend-row:hover {
		background: var(--color-surface-alt);
	}
	.legend-row.dim {
		opacity: 0.35;
	}
	.legend-row.leader .sym {
		color: var(--color-primary-ink);
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}
	.sym {
		font-size: 12.5px;
		font-weight: 800;
		color: var(--color-text);
	}
	.who {
		font-size: 9.5px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.val {
		margin-left: auto;
		font-family: ui-monospace, monospace;
		font-size: 12.5px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	@media (prefers-reduced-motion: reduce) {
		.legend-row {
			transition: none;
		}
	}
</style>
