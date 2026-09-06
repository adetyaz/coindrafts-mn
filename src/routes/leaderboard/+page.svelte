<script lang="ts">
	import { onMount } from 'svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/toast';

	type LeaderboardRow = {
		rank: number;
		id: string;
		username: string;
		walletShort: string;
		xp: number;
		streak: number;
		isMe: boolean;
	};

	let rows = $state<LeaderboardRow[]>([]);
	let loading = $state(true);

	const podium = $derived(rows.slice(0, 3));
	const ladder = $derived(rows.slice(3));

	onMount(async () => {
		try {
			const res = await fetch('/api/leaderboard');
			if (res.ok) {
				rows = await res.json();
			}
		} catch {
			toast('Failed to load leaderboard', 'error');
		} finally {
			loading = false;
		}
	});
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<div class="mb-6.5">
		<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">Leaderboard</h1>
		<p class="mt-2 text-sm text-text-muted">Top players ranked by XP</p>
	</div>

	{#if loading}
		<div class="flex flex-col gap-2">
			{#each [0, 1, 2] as i (i)}
				<div class="h-14 animate-pulse rounded-2xl bg-surface-alt"></div>
			{/each}
		</div>
	{:else if rows.length === 0}
		<p class="py-14 text-center text-sm text-text-muted">No players yet. Be the first!</p>
	{:else}
		<div class="mb-6.5 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
			{#each podium as row, i (row.id)}
				<div
					class="rounded-[20px] p-6"
					style={i === 0
						? 'background:var(--color-primary);color:var(--color-ink);box-shadow:0 0 70px rgba(247,142,121,0.25)'
						: 'background:var(--color-surface);border:1px solid var(--color-border)'}
				>
					<div class="mb-4.5 flex items-center justify-between">
						<span class="font-mono text-[26px] font-bold tracking-[-0.03em]"
							>{row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'}</span
						>
						{#if row.streak > 0}
							<span class="font-mono text-xs font-bold" style={i === 0 ? '' : 'color:var(--color-primary-ink)'}
								>{row.streak}&nbsp;🔥</span
							>
						{/if}
					</div>
					<div class="text-xl font-extrabold tracking-[-0.02em]">{row.username}</div>
					<div
						class="mt-1 font-mono text-[13px]"
						style={i === 0 ? 'opacity:0.72' : 'color:var(--color-text-muted)'}
					>
						{row.walletShort}
					</div>
					<div class="mt-3.5 font-mono text-[30px] font-bold">{row.xp.toLocaleString()}</div>
				</div>
			{/each}
		</div>

		{#if ladder.length > 0}
			<div class="overflow-x-auto rounded-[18px] border border-border">
				<div
					class="grid min-w-[560px] grid-cols-[64px_minmax(140px,1fr)_90px_90px] gap-2.5 bg-surface px-5 py-2.5 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase"
				>
					<div>Rank</div>
					<div>Player</div>
					<div class="text-right">XP</div>
					<div class="text-right">Streak</div>
				</div>
				{#each ladder as row (row.id)}
					<div
						class="grid min-w-[560px] grid-cols-[64px_minmax(140px,1fr)_90px_90px] items-center gap-2.5 border-t border-border px-5 py-3.5"
						style={row.isMe ? 'background:var(--color-primary-muted)' : ''}
					>
						<span class="font-mono text-sm font-bold text-text-muted">{row.rank}</span>
						<div class="min-w-0">
							<p class="truncate text-sm font-bold">
								{row.username}{#if row.isMe}<span
										class="ml-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold tracking-[0.1em] text-text uppercase"
										>You</span
									>{/if}
							</p>
							<p class="font-mono text-[11px] text-text-muted">{row.walletShort}</p>
						</div>
						<span class="text-right font-mono text-sm font-bold">{row.xp.toLocaleString()}</span>
						<span class="text-right font-mono text-sm font-bold text-positive-ink"
							>{row.streak > 0 ? `${row.streak} 🔥` : '—'}</span
						>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<Toast />
