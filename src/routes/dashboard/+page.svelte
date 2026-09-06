<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Gauntlet from '$lib/components/Gauntlet.svelte';
	import TokenIcon from '$lib/components/TokenIcon.svelte';
	import StatBlock from '$lib/components/ui/StatBlock.svelte';
	import Bar from '$lib/components/ui/Bar.svelte';
	import type { BadgeDef } from '$lib/badges';

	let contests = $state<Array<Record<string, unknown>>>([]);
	let myLobbies = $state<Array<Record<string, unknown>>>([]);
	let badges = $state<(BadgeDef & { earned: boolean; earnedAt: string | null })[]>([]);
	let sectors = $state<Array<Record<string, unknown>>>([]);
	let alerts = $state<Array<Record<string, unknown>>>([]);
	let tokens = $state<
		{
			currency_id: string;
			symbol?: string;
			name?: string;
			price: number | null;
			change24h: number | null;
			rank: number | null;
		}[]
	>([]);
	let news = $state<{ title?: string; date?: string; source?: string; url?: string }[]>([]);
	let loading = $state(true);
	let actionError = $state('');

	const user = $derived(page.data.user);
	const resolvedContests = $derived(contests.filter((c) => c.status === 'resolved'));
	// Win rate is a competitive-skill number, so Scrimmage (bot-only, no real
	// stakes) is excluded here — the "resolved" count above stays inclusive,
	// since that's a general activity stat, not a skill claim (H-03).
	const realResolvedContests = $derived(resolvedContests.filter((c) => !c.isPaper));
	const winCount = $derived(realResolvedContests.filter((c) => c.winnerId === user?.id).length);
	const winRate = $derived(
		realResolvedContests.length > 0 ? Math.round((winCount / realResolvedContests.length) * 100) : 0
	);

	onMount(async () => {
		await Promise.all([
			loadContests(),
			loadMyLobbies(),
			loadSectors(),
			loadAlerts(),
			loadTokens(),
			loadNews(),
			loadBadges()
		]);
		loading = false;
	});

	async function loadMyLobbies() {
		try {
			const res = await fetch('/api/lobby/mine');
			if (res.ok) myLobbies = await res.json();
		} catch (error) {
			console.error('Failed to load active lobbies:', error);
		}
	}

	async function loadBadges() {
		try {
			const res = await fetch('/api/badges');
			if (res.ok) badges = await res.json();
		} catch (error) {
			console.error('Failed to load badges:', error);
		}
	}

	async function loadContests() {
		try {
			const res = await fetch('/api/contests');
			if (res.ok) contests = await res.json();
		} catch (error) {
			console.error('Failed to load contests:', error);
		}
	}

	async function loadSectors() {
		try {
			const res = await fetch('/api/sectors');
			if (res.ok) {
				const data = await res.json();
				sectors = Array.isArray(data) ? data.slice(0, 6) : [];
			}
		} catch (error) {
			console.error('Failed to load sectors:', error);
		}
	}

	async function loadAlerts() {
		try {
			const res = await fetch('/api/etf');
			if (res.ok) {
				const data = await res.json();
				alerts = data.alerts ?? [];
			}
		} catch (error) {
			console.error('Failed to load alerts:', error);
		}
	}

	async function loadTokens() {
		try {
			const res = await fetch('/api/tokens');
			if (res.ok) tokens = await res.json();
		} catch (error) {
			console.error('Failed to load tokens:', error);
		}
	}

	async function loadNews() {
		try {
			const res = await fetch('/api/news');
			if (res.ok) {
				const data = await res.json();
				news = Array.isArray(data) ? data.slice(0, 5) : [];
			}
		} catch (error) {
			console.error('Failed to load news:', error);
		}
	}

	async function createContest(
		type: 'daily' | 'weekly' = 'daily',
		mode: 'real' | 'paper' = 'real'
	) {
		actionError = '';
		try {
			const res = await fetch('/api/contests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type, mode })
			});
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				if (res.status === 401) {
					window.location.href = '/?auth=required';
					return;
				}
				throw new Error(payload?.error ?? 'Failed to create contest');
			}
			const contest = await res.json();
			const modeParam = contest.isPaper ? '&mode=paper' : '';
			window.location.href = `/draft?contestId=${contest.id}&type=${contest.type}${modeParam}`;
		} catch (error) {
			actionError = (error as Error)?.message ?? 'Failed to create contest';
			console.error('Failed to create contest:', error);
		}
	}

	function formatPct(value: number) {
		const signed = value >= 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
		return `${signed}%`;
	}

	function avatarBg(sym: string): string {
		const colors = [
			'var(--color-primary)',
			'var(--color-sector-l1)',
			'var(--color-sector-l2)',
			'var(--color-sector-defi)',
			'var(--color-sector-meme)',
			'var(--color-sector-wildcard)'
		];
		let h = 0;
		for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0;
		return colors[h % colors.length];
	}
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<div class="mb-4.5 flex flex-wrap items-start gap-4.5">
		<div
			class="hero-coral dot-grid flex min-w-0 flex-[1_1_520px] flex-col gap-7 rounded-[24px] p-9"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<span
					class="rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
				>
					{resolvedContests.length > 0 ? `${winRate}% win rate` : 'New player'}
				</span>
				{#if contests.filter((c) => c.status !== 'resolved').length > 0}
					<span class="font-mono text-[13px] font-bold"
						>{contests.filter((c) => c.status !== 'resolved').length} active</span
					>
				{/if}
			</div>
			<div>
				<div class="text-[46px] leading-[0.95] font-black tracking-[-0.045em] max-sm:text-[34px]">
					{contests.length === 0 ? 'Draft your first lineup' : 'Ready for your next contest'}
				</div>
				<p class="mt-3.5 text-[15px] opacity-80">
					{contests.length === 0
						? 'Five sectors, one token each, twenty-four hours to prove your read.'
						: `${resolvedContests.length} contest${resolvedContests.length === 1 ? '' : 's'} resolved so far this season.`}
				</p>
			</div>
			<div class="flex flex-wrap gap-2.5">
				<button
					class="cursor-pointer rounded-full bg-text px-[26px] py-3.5 text-sm font-extrabold text-primary transition hover:-translate-y-0.5"
					onclick={() => goto('/matchmaking')}
				>
					Find an opponent
				</button>
				<button
					class="cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-[26px] py-3.5 text-sm font-bold text-text"
					onclick={() => goto('/tournament')}
				>
					Tournaments
				</button>
				<button
					class="cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-[26px] py-3.5 text-sm font-bold text-text"
					onclick={() => goto('/draft')}
				>
					Open draft
				</button>
				<!-- Always shown, and routes to the Scrimmage page rather than creating a
				     contest inline — so the duration choice applies here too. -->
				<button
					class="cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-[26px] py-3.5 text-sm font-bold text-text"
					onclick={() => goto('/scrimmage')}
				>
					{contests.length === 0 ? 'Try Scrimmage' : 'Scrimmage'}
				</button>
			</div>
			<p class="text-[13px] opacity-70">
				Scrimmage — draft against bots and earn XP, without touching your real rank.
			</p>
		</div>

		<div class="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
			<div class="grid grid-cols-2 gap-4.5 rounded-[20px] border border-border bg-surface p-[22px]">
				<StatBlock
					value={resolvedContests.length > 0 ? `${winRate}%` : '—'}
					label="Win rate"
					color="var(--color-mint-ink)"
				/>
				<StatBlock value={String(resolvedContests.length)} label="Resolved" />
			</div>
		</div>
	</div>

	<div class="mb-4.5 flex flex-wrap gap-4.5">
		<div class="min-w-0 flex-[1_1_340px]">
			<Gauntlet />
		</div>
		<div class="min-w-0 flex-[1_1_340px] rounded-[20px] border border-border bg-surface p-[22px]">
			<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				Sector performance
			</div>
			{#if loading}
				<p class="text-xs text-text-muted">Loading sector data…</p>
			{:else if sectors.length === 0}
				<p class="text-xs text-text-muted">Sector feed unavailable.</p>
			{:else}
				<div class="flex flex-col gap-3">
					{#each sectors as sector, i (sector?.sector ?? sector?.name ?? i)}
						{@const chg = Number(sector.change ?? 0)}
						<div class="flex items-center gap-2.5">
							<span class="w-14 text-xs font-bold">{sector.sector ?? sector.name ?? 'Sector'}</span>
							<div class="flex-1">
								<Bar
									pct={Math.max(8, Math.min(100, Math.abs(chg) * 8))}
									color={chg >= 0 ? 'var(--color-mint)' : 'var(--color-red)'}
									height="6px"
								/>
							</div>
							<span
								class="w-12 text-right font-mono text-xs font-bold"
								style="color:{chg >= 0 ? 'var(--color-mint-ink)' : 'var(--color-red-ink)'}"
								>{formatPct(chg)}</span
							>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="min-w-0 flex-[1_1_340px] rounded-[20px] border border-border bg-surface p-[22px]">
			<div class="mb-4.5 flex items-center gap-2">
				<span class="anim-blink h-[7px] w-[7px] rounded-full bg-negative"></span>
				<span class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase"
					>Whale flow</span
				>
			</div>
			{#if alerts.length === 0}
				<p class="text-xs text-text-muted">No active alerts right now.</p>
			{:else}
				<div class="flex flex-col gap-3.5">
					{#each alerts.slice(0, 3) as alert, i (alert?.date ?? `${alert?.type ?? 'alert'}-${i}`)}
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="text-[13px] font-bold">{alert.type} streak detected</p>
								<p class="font-mono text-[11px] text-text-muted">{alert.streak} days</p>
							</div>
							<span class="shrink-0 font-mono text-[13px] font-bold text-primary-ink"
								>${Math.round(Number(alert.amount)).toLocaleString()}</span
							>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="mb-4.5 rounded-[20px] border border-border bg-surface p-[22px]">
		<div class="mb-4.5 flex items-center justify-between">
			<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				Badges
			</div>
			<span class="font-mono text-xs text-text-muted"
				>{badges.filter((b) => b.earned).length}/{badges.length} unlocked</span
			>
		</div>
		<div class="flex flex-wrap gap-2.5">
			{#each badges as badge (badge.code)}
				<div
					class="flex items-center gap-2.5 rounded-full border px-3.5 py-2"
					style={badge.earned
						? 'border-color:var(--color-primary);background:var(--color-primary-muted)'
						: 'border-color:var(--color-border);background:var(--color-surface-alt);opacity:0.55'}
					title={badge.description}
				>
					<span class="text-base {badge.earned ? '' : 'grayscale'}">{badge.emoji}</span>
					<span
						class="text-xs font-bold"
						style={badge.earned
							? 'color:var(--color-primary-ink)'
							: 'color:var(--color-text-muted)'}>{badge.name}</span
					>
				</div>
			{/each}
		</div>
	</div>

	<div class="mb-4.5 flex flex-wrap gap-4.5">
		<div class="min-w-0 flex-[1_1_340px] rounded-[20px] border border-border bg-surface p-[22px]">
			<div class="mb-4.5 flex items-center justify-between">
				<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
					Hot tokens
				</div>
			</div>
			{#if loading}
				<p class="text-xs text-text-muted">Loading tokens…</p>
			{:else if tokens.length === 0}
				<p class="text-xs text-text-muted">Token data unavailable.</p>
			{:else}
				<div class="flex flex-col divide-y divide-border">
					{#each tokens.slice(0, 5) as token (token.currency_id)}
						<div class="flex items-center justify-between py-2.5">
							<div class="flex items-center gap-2.5">
								<TokenIcon
									symbol={token.symbol}
									size={28}
									bg={avatarBg(token.symbol ?? '')}
									fg="var(--color-ink)"
								/>
								<div>
									<p class="text-[13px] font-bold">{(token.symbol ?? '').toUpperCase()}</p>
									<p class="text-[11px] text-text-muted">{token.name}</p>
								</div>
							</div>
							<div class="text-right">
								<p class="font-mono text-[13px] font-bold">
									{token.price != null
										? token.price >= 1000
											? `$${token.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
											: `$${token.price.toFixed(token.price < 1 ? 4 : 2)}`
										: '—'}
								</p>
								{#if token.change24h != null}
									<span
										class="font-mono text-[11px] font-bold"
										style="color:{token.change24h >= 0
											? 'var(--color-mint-ink)'
											: 'var(--color-red-ink)'}">{formatPct(token.change24h)}</span
									>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
			<div class="mt-2.5 border-t border-border pt-2.5">
				<a href="/draft" class="text-xs font-bold text-primary-ink no-underline hover:underline"
					>Draft a token from this list &rarr;</a
				>
			</div>
		</div>

		<div class="min-w-0 flex-[1_1_340px] rounded-[20px] border border-border bg-surface p-[22px]">
			<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				Scout report
			</div>
			{#if loading}
				<p class="text-xs text-text-muted">Loading news…</p>
			{:else if news.length === 0}
				<p class="text-xs text-text-muted">No news available.</p>
			{:else}
				<div class="flex flex-col divide-y divide-border">
					{#each news as item, i (i)}
						<div class="flex gap-2.5 py-2.5">
							<div class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></div>
							<div class="min-w-0">
								<p class="text-[13px] leading-snug font-bold">{item.title ?? 'Market update'}</p>
								<p class="text-[11px] text-text-muted">
									{item.source ?? 'SoSoValue'}{item.date ? ` · ${item.date}` : ''}
								</p>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="rounded-[20px] border border-border bg-surface p-[22px]">
		<div class="mb-4.5 flex flex-wrap items-center justify-between gap-3">
			<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				My contests
			</div>
			<div class="flex gap-2">
				<button
					class="cursor-pointer rounded-full bg-primary-muted px-3.5 py-1.5 text-xs font-bold text-primary-ink"
					onclick={() => createContest('daily')}>+ Daily</button
				>
				<button
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold"
					style="background:rgba(247,201,120,0.16);color:var(--color-warning-ink)"
					onclick={() => createContest('weekly')}>+ Weekly</button
				>
				<button
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold"
					style="background:rgba(104,194,168,0.14);color:var(--color-mint-ink)"
					onclick={() => createContest('daily', 'paper')}>+ Scrimmage</button
				>
			</div>
		</div>
		{#if actionError}
			<p class="mb-2.5 text-xs text-negative-ink">{actionError}</p>
		{/if}
		{#if loading}
			<p class="text-xs text-text-muted">Loading…</p>
		{:else if contests.length === 0}
			<p class="text-xs text-text-muted">No contests yet — start a draft above.</p>
		{:else}
			<div class="flex flex-col divide-y divide-border">
				{#each contests as c, i (c.id ?? i)}
					<div class="flex flex-wrap items-center justify-between gap-2.5 py-3">
						<div class="flex flex-wrap items-center gap-2.5">
							{#if c.status === 'resolved'}
								<span
									class="rounded-full bg-surface-alt px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase"
									>Resolved</span
								>
							{:else if c.status === 'live'}
								<span
									class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
									style="background:rgba(104,194,168,0.14);color:var(--color-mint-ink)">Live</span
								>
							{:else}
								<span
									class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
									style="background:rgba(247,201,120,0.16);color:var(--color-warning-ink)"
									>Open</span
								>
							{/if}
							<span class="text-[13px] font-bold"
								>{c.type === 'weekly' ? 'Weekly' : 'Daily'} Contest</span
							>
							{#if c.isPaper}
								<span
									class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
									style="background:rgba(104,194,168,0.14);color:var(--color-mint-ink)"
									>Scrimmage</span
								>
							{/if}
							<span class="font-mono text-[11px] text-text-muted"
								>{String(c.id ?? '').slice(0, 8)}…</span
							>
						</div>
						{#if c.status === 'resolved'}
							<a
								href={`/contest/result?contestId=${c.id}`}
								class="rounded-full bg-primary-muted px-3.5 py-1.5 text-xs font-bold text-primary-ink no-underline"
								>View result</a
							>
						{:else if c.myLineupLocked}
							<a
								href={`/game/${c.id}`}
								class="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-text no-underline"
								>{c.status === 'live' ? 'Watch race' : 'Waiting for opponent'}</a
							>
						{:else}
							<a
								href={`/draft?contestId=${c.id}&type=${c.type ?? 'daily'}${c.isPaper ? '&mode=paper' : ''}`}
								class="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-text no-underline"
								>Continue draft</a
							>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if myLobbies.length > 0}
		<div class="mt-4.5 rounded-[20px] border border-border bg-surface p-[22px]">
			<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				My multiplayer &amp; tournaments
			</div>
			<div class="flex flex-col divide-y divide-border">
				{#each myLobbies as l, i (String(l.id ?? i))}
					<div class="flex flex-wrap items-center justify-between gap-2.5 py-3">
						<div class="flex flex-wrap items-center gap-2.5">
							<span
								class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
								style={l.status === 'live'
									? 'background:rgba(104,194,168,0.14);color:var(--color-mint-ink)'
									: 'background:rgba(247,201,120,0.16);color:var(--color-warning-ink)'}
								>{l.status}</span
							>
							<span class="text-[13px] font-bold">
								{#if l.tournamentId}
									{l.tournamentName ?? 'Tournament'} &middot; {l.tournamentStage === 1
										? 'Final'
										: 'Qualifier'}
								{:else}
									Multiplayer lobby
								{/if}
							</span>
							<span class="font-mono text-[11px] text-text-muted"
								>{String(l.id ?? '').slice(0, 8)}…</span
							>
						</div>
						{#if l.myLineupLocked}
							<a
								href={`/lobby/${l.id}/result`}
								class="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-text no-underline"
								>{l.status === 'live' ? 'Watch' : 'Waiting for others'}</a
							>
						{:else}
							<a
								href={`/draft?lobbyId=${l.id}`}
								class="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-text no-underline"
								>Continue draft</a
							>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
