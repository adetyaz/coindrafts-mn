<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { sectorTheme } from '$lib/sectorTheme';
	import { durationLabel } from '$lib/constants';
	import TokenIcon from '$lib/components/TokenIcon.svelte';
	import RaceChart from '$lib/components/RaceChart.svelte';
	import StakeCommit from '$lib/components/StakeCommit.svelte';
	import Toast from '$lib/components/Toast.svelte';

	type Pick = {
		sector: string;
		symbol: string;
		name: string;
		currencyId: string;
		entryPrice: number;
		currentPrice: number;
		pct: number;
	};
	type Side = { userId: string; name: string | null; picks: Pick[]; totalPct: number } | null;
	type Live = {
		status: string;
		isPaper: boolean;
		durationMinutes: number | null;
		startAt: string | null;
		endAt: string | null;
		msRemaining: number | null;
		finished: boolean;
		me: Side;
		opponent: Side;
		stakeId?: string | null;
		history: { at: string; prices: Record<string, number> }[];
	};

	const POLL_MS = 4000;
	const SAMPLE_SECONDS = 4;

	const contestId = page.params.id;

	let live = $state<Live | null>(null);
	let phase = $state<'loading' | 'waiting' | 'start' | 'racing' | 'error'>('loading');
	let errorMessage = $state('');
	let msRemaining = $state(0);

	// Rebuilt from server-stored samples on every poll, so the line survives a
	// refresh and both players see the same race. Each entry is one sampled
	// tick: a timestamp plus each pick's % move from its locked entry price.
	let series = $state<{ at: number; vals: Record<string, number> }[]>([]);

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;

	const clock = $derived.by(() => {
		const s = Math.max(0, Math.floor(msRemaining / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = s % 60;
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
			: `${m}:${String(sec).padStart(2, '0')}`;
	});

	function keyFor(side: 'me' | 'opp', symbol: string) {
		return `${side}:${symbol}`;
	}

	async function poll() {
		try {
			const res = await fetch(`/api/contest/${contestId}/live`);
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = '/?auth=required';
					return;
				}
				throw new Error('Could not load the game');
			}
			const data: Live = await res.json();
			live = data;
			msRemaining = data.msRemaining ?? 0;

			if (data.status === 'resolved' || data.finished) {
				window.location.href = `/contest/result?contestId=${contestId}`;
				return;
			}

			// Convert stored prices into % moves against each pick's locked entry.
			// Entry prices live on the picks, so history only has to carry prices.
			const entryFor = new Map<string, { key: string; entry: number }>();
			for (const p of data.me?.picks ?? [])
				entryFor.set(p.currencyId, { key: keyFor('me', p.symbol), entry: p.entryPrice });
			for (const p of data.opponent?.picks ?? [])
				entryFor.set(p.currencyId, { key: keyFor('opp', p.symbol), entry: p.entryPrice });

			const rebuilt = (data.history ?? []).map((tick) => {
				const vals: Record<string, number> = {};
				for (const [currencyId, price] of Object.entries(tick.prices)) {
					const meta = entryFor.get(currencyId);
					if (!meta || meta.entry <= 0) continue;
					vals[meta.key] = ((price - meta.entry) / meta.entry) * 100;
				}
				return { at: new Date(tick.at).getTime(), vals };
			});

			// Always end on the freshest numbers, even if this tick wasn't stored
			// (writes are throttled, polls are not).
			const latest: Record<string, number> = {};
			for (const p of data.me?.picks ?? []) latest[keyFor('me', p.symbol)] = p.pct;
			for (const p of data.opponent?.picks ?? []) latest[keyFor('opp', p.symbol)] = p.pct;

			series = [...rebuilt, { at: Date.now(), vals: latest }].slice(-300);

			// Contest stays 'open' (no clock yet) until both sides have locked a
			// lineup — see the lineup endpoint. Keep polling in that state rather
			// than showing a countdown/race for an opponent who hasn't drafted.
			if (data.status === 'open') {
				phase = 'waiting';
			} else if (phase === 'loading' || phase === 'waiting') {
				phase = 'start';
			}
		} catch (e) {
			if (phase === 'loading') {
				phase = 'error';
				errorMessage = e instanceof Error ? e.message : 'Could not load the game';
			}
			// Mid-race failures are ignored — the next tick retries rather than
			// tearing down a running race for one dropped poll.
		}
	}

	onMount(async () => {
		await poll();
		pollTimer = setInterval(poll, POLL_MS);
		tickTimer = setInterval(() => {
			msRemaining = Math.max(0, msRemaining - 1000);
		}, 1000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
		if (tickTimer) clearInterval(tickTimer);
	});

	function lastVal(key: string) {
		return series.at(-1)?.vals[key] ?? 0;
	}

	const racers = $derived([
		...(live?.me?.picks ?? []).map((p) => ({
			key: keyFor('me', p.symbol),
			pick: p,
			mine: true
		})),
		...(live?.opponent?.picks ?? []).map((p) => ({
			key: keyFor('opp', p.symbol),
			pick: p,
			mine: false
		}))
	]);

	// One distinct color per TOKEN, not per sector — sector color collides the
	// moment both sides draft the same sector (both pick an L1, say), making
	// individual coins impossible to tell apart in a 10-line race. Assigned by
	// each symbol's position in the sorted unique list, so it's deterministic
	// across polls (same set of symbols always sorts the same way) and
	// collision-free up to 10 palette entries — the max a race ever has (5
	// picks × 2 sides).
	const RACE_PALETTE = [
		'#F78E79',
		'#5FA8D8',
		'#68C2A8',
		'#F7C978',
		'#B57EDC',
		'#E8709A',
		'#7EC8E3',
		'#A3D977',
		'#E2555A',
		'#4FBDBD'
	];
	const symbolColor = $derived.by(() => {
		const uniqueSymbols = [...new Set(racers.map((r) => r.pick.symbol.toUpperCase()))].sort();
		const map = new Map<string, string>();
		uniqueSymbols.forEach((sym, i) => map.set(sym, RACE_PALETTE[i % RACE_PALETTE.length]));
		return map;
	});

	// Shapes the race data for the chart component.
	const chartRacers = $derived(
		racers.map((r) => ({
			key: r.key,
			label: r.pick.symbol.toUpperCase(),
			sector: r.pick.sector,
			colour: symbolColor.get(r.pick.symbol.toUpperCase()) ?? sectorTheme(r.pick.sector).color,
			mine: r.mine
		}))
	);
	const chartTimestamps = $derived(series.map((s) => s.at));
	const chartValues = $derived(racers.map((r) => series.map((s) => s.vals[r.key] ?? 0)));

	const leader = $derived.by(() => {
		if (racers.length === 0) return null;
		return racers.reduce((a, b) => (lastVal(a.key) >= lastVal(b.key) ? a : b));
	});
</script>

<div class="mx-auto max-w-[1100px] px-7 pt-7 pb-18">
	{#if phase === 'loading'}
		<div class="h-64 animate-pulse rounded-[24px] bg-surface-alt"></div>
	{:else if phase === 'waiting'}
		<div class="rounded-[24px] border border-border bg-surface p-11 text-center max-sm:p-6">
			<div class="anim-blink mx-auto h-2.5 w-2.5 rounded-full bg-primary"></div>
			<div class="mt-4 text-[28px] font-black tracking-[-0.03em]">Waiting for your opponent</div>
			<p class="mt-3 text-[15px] text-text-muted">
				Your lineup is locked in. The clock hasn't started — it only begins once
				{live?.opponent?.name ?? 'they'} lock theirs too, so neither of you loses draft time waiting on
				the other.
			</p>
		</div>
	{:else if phase === 'error'}
		<div class="rounded-[24px] border border-border bg-surface p-11 text-center">
			<div class="text-[28px] font-black tracking-[-0.03em]">Can't load this game</div>
			<p class="mt-3 text-[15px] text-text-muted">{errorMessage}</p>
			<a
				href="/dashboard"
				class="mt-6 inline-flex h-12 items-center rounded-full bg-primary px-8 text-sm font-extrabold text-text no-underline"
				>Back to dashboard</a
			>
		</div>

		<!-- ── START SCREEN ─────────────────────────────────────────────── -->
	{:else if phase === 'start'}
		<div class="hero-coral dot-grid rounded-[24px] p-11 max-sm:p-6">
			<div class="flex flex-wrap items-center gap-2.5">
				<span
					class="rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
					>Ready</span
				>
				{#if live?.isPaper}
					<span class="rounded-full bg-black/10 px-2.5 py-1 text-[10px] font-bold uppercase"
						>Scrimmage</span
					>
				{/if}
			</div>
			<div
				class="mt-4 text-[52px] leading-[0.94] font-black tracking-[-0.045em] max-sm:text-[34px]"
			>
				{live?.me?.name ?? 'You'} vs {live?.opponent?.name ?? 'Opponent'}
			</div>
			<p class="mt-3 text-[15px] opacity-80">
				Both lineups are locked at their entry prices. From here it's decided by the market —
				whoever's five move furthest, wins.
			</p>

			<div class="mt-8 flex flex-wrap gap-9">
				<div>
					<div class="font-mono text-[34px] leading-none font-bold tracking-[-0.03em]">{clock}</div>
					<div class="mt-2 text-[10px] font-extrabold tracking-[0.1em] uppercase opacity-70">
						Time left
					</div>
				</div>
				<div>
					<div class="font-mono text-[34px] leading-none font-bold tracking-[-0.03em]">
						{durationLabel(live?.durationMinutes)}
					</div>
					<div class="mt-2 text-[10px] font-extrabold tracking-[0.1em] uppercase opacity-70">
						Duration
					</div>
				</div>
				<div>
					<div class="font-mono text-[34px] leading-none font-bold tracking-[-0.03em]">
						{live?.me?.picks.length ?? 0} v {live?.opponent?.picks.length ?? 0}
					</div>
					<div class="mt-2 text-[10px] font-extrabold tracking-[0.1em] uppercase opacity-70">
						Picks
					</div>
				</div>
			</div>

			<button
				onclick={() => (phase = 'racing')}
				class="mt-9 h-13 cursor-pointer rounded-full bg-text px-9 text-sm font-extrabold text-primary transition hover:-translate-y-0.5"
			>
				Watch the race →
			</button>
		</div>

		{#if live?.stakeId}
			<div class="mt-4.5">
				<StakeCommit stakeId={live.stakeId} />
			</div>
		{/if}

		<div class="mt-4.5 flex flex-wrap gap-4.5">
			{#each [{ side: live?.me, label: 'Your lineup', mine: true }, { side: live?.opponent, label: `${live?.opponent?.name ?? 'Opponent'}'s lineup`, mine: false }] as col (col.label)}
				<div class="min-w-0 flex-[1_1_340px] rounded-[20px] border border-border bg-surface p-6">
					<div class="mb-4 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
						{col.label}
					</div>
					{#if !col.side}
						<p class="text-[13px] text-text-muted">No lineup yet.</p>
					{:else}
						<div class="flex flex-col gap-2.5">
							{#each col.side.picks as p (p.symbol)}
								{@const th = sectorTheme(p.sector)}
								<div class="flex items-center gap-3 rounded-2xl bg-surface-alt p-3">
									<TokenIcon symbol={p.symbol} size={30} bg={th.color} fg="var(--color-ink)" />
									<div class="min-w-0 flex-1">
										<div class="text-sm font-extrabold">{p.symbol.toUpperCase()}</div>
										<div
											class="text-[10px] font-extrabold tracking-[0.1em] uppercase"
											style="color:{th.ink}"
										>
											{th.label}
										</div>
									</div>
									<span class="font-mono text-xs text-text-muted">
										{p.entryPrice > 0
											? `$${p.entryPrice < 1 ? p.entryPrice.toPrecision(3) : p.entryPrice.toFixed(2)}`
											: '—'}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- ── RACE SCREEN ──────────────────────────────────────────────── -->
	{:else if phase === 'racing'}
		<div class="mb-4.5 flex flex-wrap items-end justify-between gap-5">
			<div>
				<div class="font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase">
					Live · {live?.me?.name ?? 'You'} vs {live?.opponent?.name ?? 'Opponent'}
				</div>
				<h1 class="mt-2 text-[40px] leading-none font-black tracking-[-0.04em] max-sm:text-[28px]">
					{clock} left
				</h1>
			</div>
			<div class="flex gap-7">
				<div>
					<div
						class="font-mono text-[28px] leading-none font-bold"
						style="color:{(live?.me?.totalPct ?? 0) >= 0
							? 'var(--color-mint-ink)'
							: 'var(--color-red-ink)'}"
					>
						{(live?.me?.totalPct ?? 0) >= 0 ? '+' : ''}{(live?.me?.totalPct ?? 0).toFixed(2)}%
					</div>
					<div class="mt-1.5 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
						You
					</div>
				</div>
				<div>
					<div
						class="font-mono text-[28px] leading-none font-bold opacity-70"
						style="color:{(live?.opponent?.totalPct ?? 0) >= 0
							? 'var(--color-mint-ink)'
							: 'var(--color-red-ink)'}"
					>
						{(live?.opponent?.totalPct ?? 0) >= 0 ? '+' : ''}{(
							live?.opponent?.totalPct ?? 0
						).toFixed(2)}%
					</div>
					<div class="mt-1.5 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
						{live?.opponent?.name ?? 'Opponent'}
					</div>
				</div>
			</div>
		</div>

		{#if series.length < 2}
			<div
				class="grid h-[380px] place-items-center rounded-[24px] border border-border bg-surface text-center"
			>
				<div>
					<p class="text-sm font-bold text-text">Waiting for the first ticks…</p>
					<p class="mt-2 text-[13px] text-text-muted">
						Prices are sampled every {SAMPLE_SECONDS}s. The race draws itself as they arrive.
					</p>
				</div>
			</div>
		{:else}
			<RaceChart racers={chartRacers} timestamps={chartTimestamps} values={chartValues} />
		{/if}

		<div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[11px] text-text-muted">
			<span
				><span
					class="mr-1.5 inline-block h-0.5 w-5 align-middle"
					style="background:var(--color-text)"
				></span>Solid = your picks</span
			>
			<span
				><span
					class="mr-1.5 inline-block h-0.5 w-5 align-middle opacity-45"
					style="background:var(--color-text)"
				></span>Dashed = opponent</span
			>
			{#if leader}
				<span class="font-bold text-text"
					>Leading: {leader.pick.symbol.toUpperCase()} ({lastVal(leader.key) >= 0
						? '+'
						: ''}{lastVal(leader.key).toFixed(2)}%)</span
				>
			{/if}
		</div>

		<div class="mt-4.5 grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
			{#each racers as r (r.key)}
				{@const th = sectorTheme(r.pick.sector)}
				{@const v = lastVal(r.key)}
				<div
					class="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5"
					style={r.mine ? '' : 'opacity:0.7'}
				>
					<TokenIcon symbol={r.pick.symbol} size={30} bg={th.color} fg="var(--color-ink)" />
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-extrabold">{r.pick.symbol.toUpperCase()}</div>
						<div
							class="text-[10px] font-extrabold tracking-[0.1em] uppercase"
							style="color:{th.ink}"
						>
							{r.mine ? 'You' : (live?.opponent?.name ?? 'Opponent')} · {th.label}
						</div>
					</div>
					<span
						class="font-mono text-sm font-bold"
						style="color:{v >= 0 ? 'var(--color-mint-ink)' : 'var(--color-red-ink)'}"
						>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span
					>
				</div>
			{/each}
		</div>

		<p class="mt-5 text-center text-[12px] text-text-muted">
			Prices are sampled every {SAMPLE_SECONDS}s and stored, so the race survives a refresh and both
			players see the same line. Results are always scored from locked entry prices, never from this
			graph.
		</p>
	{/if}
</div>

<Toast />
