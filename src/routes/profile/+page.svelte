<script lang="ts">
	import { onMount } from 'svelte';
	import { ethers } from 'ethers';
	import type { BadgeDef } from '$lib/badges';
	import { toast } from '$lib/toast';
	import Toast from '$lib/components/Toast.svelte';
	import { getEvmWalletProvider, ensureZeroGChain } from '$lib/evmWallet';
	import { ACHIEVEMENTS_ABI } from '$lib/achievementsAbi';
	import { badgeImagePath } from '$lib/achievementArt';
	import { resolve } from '$app/paths';

	type Me = { id: string; username: string; xpTotal: number; paperXpTotal: number; streak: number };
	type Contest = Record<string, unknown>;
	type LeaderboardRow = { rank: number; id: string; isMe: boolean };
	type League = { id: string; name: string };
	type ClaimableAchievement = { typeId: number; name: string; description: string };

	let me = $state<Me | null>(null);
	let contests = $state<Contest[]>([]);
	let badges = $state<(BadgeDef & { earned: boolean })[]>([]);
	let myRank = $state<number | null>(null);
	let totalPlayers = $state(0);
	let myLeagues = $state<League[]>([]);
	let loading = $state(true);

	// On-chain achievement badges (0G Chain) — a second, separate system from
	// the off-chain `badges` above. Claimed by the player, not pushed to them:
	// the backend signs a voucher, the player's own wallet submits it.
	let achievementsConfigured = $state(true);
	let claimable = $state<ClaimableAchievement[]>([]);
	let claimingTypeId = $state<number | null>(null);

	async function loadClaimableAchievements() {
		try {
			const res = await fetch('/api/achievements/eligible');
			if (!res.ok) return;
			const data = await res.json();
			achievementsConfigured = data.configured;
			claimable = data.claimable ?? [];
		} catch {
			/* non-fatal — the rest of the profile page still works */
		}
	}

	async function claimAchievement(typeId: number) {
		claimingTypeId = typeId;
		try {
			const voucherRes = await fetch('/api/achievements/claim-voucher', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ typeId })
			});
			const voucherData = await voucherRes.json().catch(() => ({}));
			if (!voucherRes.ok) throw new Error(voucherData?.error ?? 'Could not prepare claim');

			const wallet = getEvmWalletProvider();
			if (!wallet) throw new Error('Connect an EVM wallet to claim on-chain badges');

			toast('Switching your wallet to 0G…', 'info');
			await ensureZeroGChain(wallet.provider);

			const browserProvider = new ethers.BrowserProvider(wallet.provider as never);
			const signer = await browserProvider.getSigner();
			const contract = new ethers.Contract(voucherData.contractAddress, ACHIEVEMENTS_ABI, signer);

			toast('Confirm the claim in your wallet…', 'info');
			const tx = await contract.claimAchievement(typeId, voucherData.signature);
			await tx.wait();

			toast('Badge claimed — it is in your wallet now.', 'success');
			claimable = claimable.filter((c) => c.typeId !== typeId);
		} catch (e) {
			toast(e instanceof Error ? e.message : 'Claim failed', 'error');
		} finally {
			claimingTypeId = null;
		}
	}

	const resolvedContests = $derived(contests.filter((c) => c.status === 'resolved'));

	onMount(async () => {
		try {
			const [meRes, contestsRes, badgesRes, leaderboardRes, leaguesRes] = await Promise.all([
				fetch('/api/me'),
				fetch('/api/contests'),
				fetch('/api/badges'),
				fetch('/api/leaderboard'),
				fetch('/api/leagues')
			]);
			if (meRes.ok) me = await meRes.json();
			if (contestsRes.ok) contests = await contestsRes.json();
			if (badgesRes.ok) badges = await badgesRes.json();
			if (leaderboardRes.ok) {
				const rows: LeaderboardRow[] = await leaderboardRes.json();
				totalPlayers = rows.length;
				myRank = rows.find((r) => r.isMe)?.rank ?? null;
			}
			void loadClaimableAchievements();
			if (leaguesRes.ok) {
				const data = await leaguesRes.json();
				myLeagues = data.mine ?? [];
			}
		} finally {
			loading = false;
		}
	});

	// Win rate is a competitive-skill number, so Scrimmage (bot-only, no real
	// stakes) is excluded here — same fix as the dashboard's win rate (H-03).
	const realResolvedContests = $derived(resolvedContests.filter((c) => !c.isPaper));
	const winRate = $derived.by(() => {
		const myId = me?.id;
		if (realResolvedContests.length === 0 || !myId) return null;
		const w = realResolvedContests.filter((c) => c.winnerId === myId).length;
		return Math.round((w / realResolvedContests.length) * 100);
	});
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	{#if loading}
		<div class="h-40 animate-pulse rounded-[24px] bg-surface-alt"></div>
	{:else if me}
		<div
			class="hero-coral dot-grid mb-4.5 flex flex-wrap items-center justify-between gap-6 rounded-[24px] p-9"
		>
			<div class="flex min-w-0 items-center gap-6">
				<div
					class="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-full bg-text text-3xl font-black text-primary"
				>
					{me.username?.[0]?.toUpperCase() ?? '?'}
				</div>
				<div class="min-w-0">
					<div class="mb-2 flex flex-wrap items-center gap-2.5">
						{#if myRank != null}
							<span
								class="rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.12em] text-primary uppercase"
								>Rank #{myRank}{totalPlayers ? ` of ${totalPlayers}` : ''}</span
							>
						{/if}
						{#if me.streak > 0}
							<span class="font-mono text-xs font-bold opacity-75">{me.streak} day streak</span>
						{/if}
					</div>
					<div
						class="truncate text-[40px] leading-none font-black tracking-[-0.035em] max-sm:text-[28px]"
					>
						@{me.username}
					</div>
				</div>
			</div>
		</div>

		<div
			class="mb-4.5 grid grid-cols-5 gap-0 overflow-hidden rounded-[20px] border border-border max-sm:grid-cols-2"
		>
			<div class="border-r border-border bg-surface px-6 py-6.5 last:border-r-0">
				<div class="font-mono text-[26px] font-bold tracking-[-0.03em]">{contests.length}</div>
				<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
					Contests
				</div>
			</div>
			<div class="border-r border-border bg-surface px-6 py-6.5 last:border-r-0">
				<div class="font-mono text-[26px] font-bold tracking-[-0.03em] text-positive-ink">
					{winRate != null ? `${winRate}%` : '—'}
				</div>
				<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
					Win rate
				</div>
			</div>
			<div class="border-r border-border bg-surface px-6 py-6.5 last:border-r-0">
				<div class="font-mono text-[26px] font-bold tracking-[-0.03em]">
					{me.xpTotal.toLocaleString()}
				</div>
				<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
					Total XP
				</div>
			</div>
			<div class="border-r border-border bg-surface px-6 py-6.5 last:border-r-0">
				<div class="font-mono text-[26px] font-bold tracking-[-0.03em]">{me.streak}</div>
				<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
					Day streak
				</div>
			</div>
			<div
				class="bg-surface px-6 py-6.5"
				title="Earned from Scrimmage — never counts toward your real rank"
			>
				<div class="font-mono text-[26px] font-bold tracking-[-0.03em] text-positive-ink">
					{(me.paperXpTotal ?? 0).toLocaleString()}
				</div>
				<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
					Scrimmage XP
				</div>
			</div>
		</div>

		<div class="flex flex-wrap gap-4.5">
			<div class="flex min-w-0 flex-[1_1_520px] flex-col gap-4.5">
				<div class="rounded-[20px] border border-border bg-surface p-6">
					<div class="mb-4.5 flex items-center justify-between">
						<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
							Badge cabinet
						</div>
						<span class="font-mono text-xs text-text-muted"
							>{badges.filter((b) => b.earned).length} / {badges.length} earned</span
						>
					</div>
					<div class="grid grid-cols-2 gap-3">
						{#each badges as badge (badge.code)}
							<div
								class="flex items-center gap-3 rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
								style={badge.earned
									? 'background:var(--color-primary-muted);border:1px solid var(--color-primary)'
									: 'background:var(--color-surface-alt);border:1px solid var(--color-border)'}
							>
								<div
									class="grid h-9.5 w-9.5 shrink-0 place-items-center rounded-xl text-lg {badge.earned
										? ''
										: 'grayscale'}"
									style={badge.earned
										? 'background:rgba(247,142,121,0.25)'
										: 'background:var(--color-surface)'}
								>
									{badge.emoji}
								</div>
								<div class="min-w-0">
									<div
										class="text-sm font-extrabold"
										style={badge.earned
											? 'color:var(--color-ink)'
											: 'color:var(--color-text-muted)'}
									>
										{badge.name}
									</div>
									<div class="truncate text-[11px] text-text-muted">{badge.description}</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				{#if achievementsConfigured && claimable.length > 0}
					<div class="rounded-[20px] border border-border bg-surface p-6">
						<div class="mb-1 flex items-center justify-between">
							<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
								Achievements — unclaimed on 0G
							</div>
						</div>
						<p class="mb-4 text-[11px] text-text-muted">
							You've earned these. Claiming mints it to your own wallet — you approve and pay the
							gas, it's genuinely yours.
						</p>
						<div class="flex flex-col gap-2.5">
							{#each claimable as a (a.typeId)}
								<div
									class="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-alt p-4"
								>
									<div class="flex min-w-0 items-center gap-3.5">
										{#if badgeImagePath(a.typeId)}
											<img
												src={badgeImagePath(a.typeId)}
												alt=""
												class="h-14 w-14 shrink-0 rounded-xl"
											/>
										{/if}
										<div class="min-w-0">
											<div class="text-sm font-extrabold">{a.name}</div>
											<div class="text-[11px] text-text-muted">{a.description}</div>
										</div>
									</div>
									<button
										disabled={claimingTypeId === a.typeId}
										onclick={() => claimAchievement(a.typeId)}
										class="shrink-0 cursor-pointer rounded-full bg-primary px-4 py-2 text-xs font-extrabold text-text disabled:cursor-not-allowed disabled:opacity-60"
									>
										{claimingTypeId === a.typeId ? 'Claiming…' : 'Claim'}
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="rounded-[20px] border border-border bg-surface p-6">
					<div
						class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase"
					>
						Recent contests
					</div>
					{#if contests.length === 0}
						<p class="text-xs text-text-muted">No contests yet.</p>
					{:else}
						<div class="flex flex-col divide-y divide-border">
							{#each contests.slice(0, 8) as c, i (String(c.id ?? i))}
								<div class="flex items-center justify-between gap-3 py-3">
									<div class="flex items-center gap-2.5">
										{#if c.status === 'resolved'}
											<span
												class="rounded-full bg-surface-alt px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase"
												>Resolved</span
											>
										{:else}
											<span
												class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
												style="background:rgba(247,201,120,0.16);color:var(--color-warning-ink)"
												>Open</span
											>
										{/if}
										<span class="text-[13px] font-bold"
											>{c.type === 'weekly' ? 'Weekly' : 'Daily'} contest</span
										>
									</div>
									{#if c.status === 'resolved'}
										<a
											href={resolve(`/contest/result?contestId=${c.id}`)}
											class="text-xs font-bold text-primary-ink no-underline hover:underline"
											>View</a
										>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="flex min-w-0 flex-[1_1_280px] flex-col gap-4.5">
				<div class="rounded-[20px] border border-border bg-surface p-6">
					<div class="mb-4 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
						Leagues
					</div>
					{#if myLeagues.length === 0}
						<p class="text-xs text-text-muted">Not in any leagues yet.</p>
					{:else}
						<div class="flex flex-col gap-2.5">
							{#each myLeagues as l (l.id)}
								<a
									href={resolve(`/leagues/${l.id}`)}
									class="text-sm font-bold text-text no-underline hover:underline">{l.name}</a
								>
							{/each}
						</div>
					{/if}
					<a
						href={resolve('/leagues')}
						class="mt-4 inline-block text-xs font-bold text-primary-ink no-underline hover:underline"
						>Browse leagues &rarr;</a
					>
				</div>
			</div>
		</div>
	{/if}
</div>

<Toast />
