<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toast } from '$lib/toast';
	import Toast from '$lib/components/Toast.svelte';
	import { BADGE_MAP } from '$lib/badges';

	type Row = { rank: number; username: string; score: number; xpEarned: number; isMe: boolean };
	type PickRow = { sector: string; pick: string; pct: number; points: number };

	let leaderboard = $state<Row[]>([]);
	let breakdown = $state<PickRow[]>([]);
	let myRank = $state<number | null>(null);
	let myXp = $state(0);
	let loading = $state(true);
	let error = $state('');
	// The two "not resolved yet" responses aren't errors — they mean the
	// lobby/tournament stage is still waiting on other players or hasn't gone
	// live yet. This used to be checked once and left as a dead-end error
	// message with no way to see when it actually resolves; now it polls
	// until it does, the same way the 1v1 race screen already does.
	let waiting = $state(false);
	const WAITING_MESSAGES = new Set([
		'Not every player has submitted a lineup yet',
		'Lobby is not live yet'
	]);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		const lobbyId = page.params.id;
		if (!lobbyId) {
			error = 'No lobby selected';
			loading = false;
			return;
		}
		load(lobbyId);
		pollTimer = setInterval(() => load(lobbyId), 5000);
		return () => {
			if (pollTimer) clearInterval(pollTimer);
		};
	});

	async function load(lobbyId: string) {
		try {
			const res = await fetch(`/api/lobby/${lobbyId}/result`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				const message = err.error ?? 'Failed to load lobby result';
				if (WAITING_MESSAGES.has(message)) {
					waiting = true;
					loading = false;
					return;
				}
				throw new Error(message);
			}
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			waiting = false;
			const data = await res.json();
			leaderboard = data.leaderboard ?? [];
			breakdown = data.breakdown ?? [];
			myRank = data.myRank ?? null;
			myXp = data.myXp ?? 0;

			if (Array.isArray(data.newBadges)) {
				for (const code of data.newBadges) {
					const badge = BADGE_MAP.get(code);
					if (badge) toast(`${badge.emoji} Badge unlocked: ${badge.name}`, 'success');
				}
			}
		} catch (e) {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			error = e instanceof Error ? e.message : 'Could not load result';
		} finally {
			loading = false;
		}
	}

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};

	const rowAbove = $derived.by(() => {
		const rank = myRank;
		if (rank == null) return null;
		return leaderboard.find((r) => r.rank === rank - 1) ?? null;
	});
	const myScore = $derived(leaderboard.find((r) => r.isMe)?.score ?? null);
	const gapToAbove = $derived(
		rowAbove && myScore != null ? Math.max(0, rowAbove.score - myScore) : null
	);
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	{#if loading}
		<p class="mb-4 text-sm text-text-muted">Resolving lobby and computing scores…</p>
	{:else if waiting}
		<div class="rounded-[24px] border border-border bg-surface p-11 text-center max-sm:p-6">
			<div class="anim-blink mx-auto h-2.5 w-2.5 rounded-full bg-primary"></div>
			<div class="mt-4 text-[28px] font-black tracking-[-0.03em]">Waiting on the rest of the lobby</div>
			<p class="mt-3 text-[15px] text-text-muted">
				Not everyone has locked a lineup yet, or the window hasn't closed. This checks again automatically —
				no need to keep refreshing.
			</p>
			<a
				href="/dashboard"
				class="mt-6 inline-flex h-12 items-center rounded-full border border-border bg-transparent px-8 text-sm font-bold text-text no-underline"
				>Back to dashboard</a
			>
		</div>
	{:else if error}
		<p class="mb-4 text-sm text-negative-ink">{error}</p>
	{:else}
		<div
			class="mb-4.5 rounded-[24px] p-11 max-sm:p-6"
			style="background:var(--color-primary);color:var(--color-ink);box-shadow:0 0 90px rgba(247,142,121,0.3)"
		>
			<div class="mb-7 flex flex-wrap items-start justify-between gap-4">
				<span class="rounded-full bg-black/10 px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] uppercase"
					>Ranked lobby &middot; settled</span
				>
				<span class="font-mono text-[13px] font-bold">{leaderboard.length} players</span>
			</div>
			<div class="flex flex-wrap items-end gap-8">
				<div>
					<div class="mb-2.5 text-[11px] font-extrabold tracking-[0.12em] opacity-75 uppercase">You placed</div>
					<div class="flex items-baseline gap-1.5">
						<span class="text-[100px] leading-[0.8] font-black tracking-[-0.06em] max-sm:text-[64px]"
							>{myRank ?? '—'}</span
						>
						<span class="text-[22px] font-extrabold opacity-65">of {leaderboard.length}</span>
					</div>
				</div>
				<div class="flex flex-wrap gap-6 pb-2">
					<div>
						<div class="font-mono text-[28px] font-bold tracking-[-0.03em]">+{myXp}</div>
						<div class="mt-1.5 text-[11px] font-extrabold tracking-[0.1em] opacity-70 uppercase">XP earned</div>
					</div>
					{#if gapToAbove != null && gapToAbove > 0}
						<div>
							<div class="font-mono text-[28px] font-bold tracking-[-0.03em]">{gapToAbove.toLocaleString()}pt</div>
							<div class="mt-1.5 text-[11px] font-extrabold tracking-[0.1em] opacity-70 uppercase">
								Off {ordinal((myRank ?? 1) - 1)} place
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="flex flex-wrap gap-4.5">
			<div class="min-w-0 flex-[1_1_520px]">
				<div class="mb-3 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
					Final standings
				</div>
				<div class="overflow-x-auto rounded-[18px] border border-border">
					<div
						class="grid min-w-[600px] grid-cols-[64px_minmax(140px,1fr)_90px] gap-2.5 bg-surface px-4.5 py-2.5 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase"
					>
						<div>Place</div>
						<div>Player</div>
						<div class="text-right">XP</div>
					</div>
					{#each leaderboard as row (row.username + row.rank)}
						<div
							class="grid min-w-[600px] grid-cols-[64px_minmax(140px,1fr)_90px] items-center gap-2.5 border-t border-border px-4.5 py-3.5"
							style={row.isMe ? 'background:var(--color-primary-muted)' : ''}
						>
							<span class="font-mono text-[15px] font-bold" style={row.rank === 1 ? 'color:var(--color-primary-ink)' : ''}>
								{#if row.rank === 1}🥇{:else if row.rank === 2}🥈{:else if row.rank === 3}🥉{:else}{row.rank}{/if}
							</span>
							<span class="truncate text-sm font-bold">
								{row.username}{#if row.isMe}<span
										class="ml-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold tracking-[0.1em] text-text uppercase"
										>You</span
									>{/if}
							</span>
							<span class="text-right text-sm font-bold">+{row.xpEarned}</span>
						</div>
					{/each}
				</div>
			</div>

			<div class="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
				<div class="frost-panel rounded-[20px] p-[22px]">
					<div class="mb-3 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
						Your picks
					</div>
					<div class="flex flex-col gap-2.5">
						{#each breakdown as row, i (`${row.sector}-${row.pick}-${i}`)}
							<div class="flex items-center justify-between gap-2.5">
								<div class="flex min-w-0 items-center gap-2.5">
									<span class="shrink-0 text-[11px] font-extrabold tracking-[0.08em] text-text-muted uppercase">{row.sector}</span>
									<span class="truncate text-sm font-bold">{row.pick}</span>
								</div>
								<div class="flex shrink-0 items-center gap-2.5">
									<span
										class="font-mono text-xs font-bold"
										style="color:{row.pct >= 0 ? 'var(--color-mint-ink)' : 'var(--color-red-ink)'}"
										>{row.pct >= 0 ? '+' : ''}{row.pct}%</span
									>
									<span class="font-mono text-xs font-bold text-text-muted">+{row.points}</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
				<a
					href="/lobby"
					class="w-full rounded-full bg-primary py-4 text-center text-[15px] font-extrabold text-text no-underline"
					>Queue another lobby</a
				>
				<a
					href="/dashboard"
					class="w-full rounded-full border border-border bg-transparent py-4 text-center text-[15px] font-bold text-text no-underline"
					>Back to dashboard</a
				>
			</div>
		</div>
	{/if}
</div>

<Toast />
