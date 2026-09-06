<script lang="ts">
	// Token hover overlay (G-07).
	//
	// Passive and free — deliberately distinct from the AI draft agent, which
	// costs XP. This just surfaces live data the player could otherwise only get
	// by leaving the draft screen.
	//
	// Two things shape the implementation:
	//  • Hover fires constantly while skimming a pool of 179 tokens, so the fetch
	//    is delayed until the pointer settles, and the endpoint caches hard.
	//  • It must never block drafting. It dismisses on leave, and it's positioned
	//    beside the anchor card (never on top of it), so being clickable — needed
	//    for the Stats/News tabs — still can't cover that card's own Add button.
	import { onDestroy } from 'svelte';
	import { Spring, prefersReducedMotion } from 'svelte/motion';
	import { scale, fade } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';
	import TokenIcon from './TokenIcon.svelte';

	type Detail = {
		symbol: string;
		price: number | null;
		change24h: number | null;
		volume24h: number | null;
		high24h: number | null;
		low24h: number | null;
		marketcap: number | null;
		rank: number | null;
		ath: number | null;
		downFromAth: number | null;
		news: { title: string; source?: string }[];
	};

	let {
		currencyId,
		symbol,
		anchor,
		onenter,
		onleave
	}: {
		currencyId: string;
		symbol: string;
		anchor: DOMRect | null;
		// Lets the draft page keep the overlay open while the pointer is over
		// IT, not just the card — needed now that its tabs are clickable, since
		// reaching them means crossing the gap between card and overlay.
		onenter?: () => void;
		onleave?: () => void;
	} = $props();

	const OPEN_DELAY_MS = 220;

	let detail = $state<Detail | null>(null);
	let loading = $state(false);
	let tab = $state<'stats' | 'news'>('stats');
	let timer: ReturnType<typeof setTimeout> | null = null;

	// Only fetch once the pointer has settled — skimming a grid shouldn't fire a
	// request per card passed over.
	$effect(() => {
		const id = currencyId;
		const sym = symbol;
		if (timer) clearTimeout(timer);
		detail = null;
		tab = 'stats';
		if (!id || !sym) return;

		loading = true;
		timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/token/${id}?symbol=${encodeURIComponent(sym)}`);
				if (res.ok) detail = await res.json();
			} catch {
				/* overlay simply shows nothing */
			} finally {
				loading = false;
			}
		}, OPEN_DELAY_MS);

		return () => {
			if (timer) clearTimeout(timer);
		};
	});

	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});

	const W = 300;

	// Where the overlay wants to be: beside the card, flipping to the other side
	// near the viewport edge so it never runs off screen.
	const target = $derived.by(() => {
		if (!anchor) return null;
		const gap = 12;
		const spaceRight = window.innerWidth - anchor.right;
		const flipped = spaceRight <= W + gap;
		const left = flipped ? Math.max(gap, anchor.left - W - gap) : anchor.right + gap;
		const top = Math.min(Math.max(gap, anchor.top), window.innerHeight - 320);
		return { left, top, flipped };
	});

	// Spring-driven so moving between cards GLIDES rather than teleports — the
	// overlay reads as one object following the cursor, not a new panel each
	// time. Tuned soft enough to feel alive, stiff enough not to lag behind a
	// quick sweep across the grid.
	const motion = new Spring(
		{ x: 0, y: 0 },
		{ stiffness: 0.18, damping: 0.72 }
	);

	// Which side it sits on drives the entry direction, so it appears to emerge
	// from the card rather than arriving from nowhere.
	let flipped = $state(false);
	let placed = $state(false);

	$effect(() => {
		const t = target;
		if (!t) {
			placed = false;
			return;
		}
		flipped = t.flipped;
		if (!placed) {
			// First appearance: jump to position, then let the transition play.
			// Springing in from a stale coordinate would look like a glitch.
			motion.set({ x: t.left, y: t.top }, { instant: true });
			placed = true;
		} else {
			motion.target = { x: t.left, y: t.top };
		}
	});

	const pos = $derived(placed ? motion.current : null);

	const fmtNum = (n: number | null, prefix = '') => {
		if (n == null) return '—';
		if (Math.abs(n) >= 1e9) return `${prefix}${(n / 1e9).toFixed(2)}B`;
		if (Math.abs(n) >= 1e6) return `${prefix}${(n / 1e6).toFixed(1)}M`;
		if (Math.abs(n) >= 1000) return `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
		if (Math.abs(n) >= 1) return `${prefix}${n.toFixed(2)}`;
		return `${prefix}${n.toPrecision(3)}`;
	};
</script>

{#if pos}
	<!-- Interactive now that it has a clickable News tab — it was pointer-events-none
	     before, which also silently made the tab itself unclickable. Safe because the
	     overlay is positioned beside the anchor card (never on top of it, see `target`
	     above), so it can't swallow a click meant for that card's own Add button. -->
	<div
		class="fixed z-50"
		style="left:{pos.x}px; top:{pos.y}px; width:{W}px"
		role="tooltip"
		onmouseenter={onenter}
		onmouseleave={onleave}
	>
		<div
			in:scale={{
				duration: prefersReducedMotion.current ? 0 : 260,
				start: 0.92,
				opacity: 0,
				easing: backOut
			}}
			out:fade={{ duration: prefersReducedMotion.current ? 0 : 120, easing: cubicOut }}
			class="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_18px_50px_rgba(26,36,33,0.22)]"
			style="transform-origin:{flipped ? 'right' : 'left'} top"
		>
			<div class="flex items-center gap-2.5 border-b border-border px-4 py-3">
				<TokenIcon {symbol} size={26} bg="var(--color-surface-alt)" fg="var(--color-text)" />
				<div class="min-w-0 flex-1">
					<div class="text-sm font-extrabold text-text">{symbol.toUpperCase()}</div>
					{#if detail?.rank}
						<div class="font-mono text-[10px] text-text-muted">Rank #{detail.rank}</div>
					{/if}
				</div>
				{#if detail?.change24h != null}
					<span
						class="rounded-full px-2 py-1 font-mono text-[11px] font-bold"
						style="background:{detail.change24h >= 0
							? 'rgba(104,194,168,0.14)'
							: 'rgba(232,112,112,0.14)'};color:{detail.change24h >= 0
							? 'var(--color-mint-ink)'
							: 'var(--color-red-ink)'}"
					>
						{detail.change24h >= 0 ? '+' : ''}{detail.change24h.toFixed(2)}%
					</span>
				{/if}
			</div>

			{#if loading && !detail}
				<div class="px-4 py-6">
					<div class="h-2.5 w-2/3 animate-pulse rounded bg-surface-alt"></div>
					<div class="mt-2.5 h-2.5 w-1/2 animate-pulse rounded bg-surface-alt"></div>
				</div>
			{:else if detail}
				<div class="flex gap-1 border-b border-border px-3 pt-2">
					{#each [{ id: 'stats' as const, label: 'Stats' }, { id: 'news' as const, label: `News${detail.news.length ? ` (${detail.news.length})` : ''}` }] as t (t.id)}
						<button
							type="button"
							onclick={() => (tab = t.id)}
							class="cursor-pointer rounded-t-lg px-2.5 py-1.5 text-[11px] font-bold"
							style={tab === t.id
								? 'color:var(--color-text);border-bottom:2px solid var(--color-primary)'
								: 'color:var(--color-text-muted)'}
						>
							{t.label}
						</button>
					{/each}
				</div>

				{#if tab === 'stats'}
					<div class="grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3.5">
						{#each [{ k: 'Price', v: fmtNum(detail.price, '$') }, { k: '24h volume', v: fmtNum(detail.volume24h, '$') }, { k: '24h high', v: fmtNum(detail.high24h, '$') }, { k: '24h low', v: fmtNum(detail.low24h, '$') }, { k: 'Market cap', v: fmtNum(detail.marketcap, '$') }, { k: 'From ATH', v: detail.downFromAth != null ? `-${(detail.downFromAth * 100).toFixed(0)}%` : '—' }] as row (row.k)}
							<div>
								<div class="text-[9.5px] font-extrabold tracking-[0.08em] text-text-muted uppercase">
									{row.k}
								</div>
								<div class="mt-0.5 font-mono text-[12.5px] font-bold text-text">{row.v}</div>
							</div>
						{/each}
					</div>
				{:else if detail.news.length > 0}
					<div class="px-4 py-3">
						<div class="flex flex-col gap-2">
							{#each detail.news.slice(0, 3) as n (n.title)}
								<p class="text-[11.5px] leading-snug text-text-secondary">{n.title}</p>
							{/each}
						</div>
					</div>
				{:else}
					<p class="px-4 py-6 text-center text-[11.5px] text-text-muted">No recent news for this token.</p>
				{/if}
			{/if}
		</div>
	</div>
{/if}
