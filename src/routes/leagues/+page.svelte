<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/toast';
	import { BADGE_MAP } from '$lib/badges';

	type League = {
		id: string;
		name: string;
		type: string;
		memberCount: number;
		seasonEnd: string;
	};

	let tab = $state<'mine' | 'public'>('mine');
	let myLeagues = $state<League[]>([]);
	let publicLeagues = $state<League[]>([]);
	let loading = $state(true);
	let showCreate = $state(false);
	let showJoin = $state(false);
	let newLeagueName = $state('');
	let newLeagueType = $state<'public' | 'private'>('public');
	let inviteCode = $state('');

	onMount(loadLeagues);

	async function loadLeagues() {
		loading = true;
		try {
			const res = await fetch('/api/leagues');
			if (res.ok) {
				const data = await res.json();
				myLeagues = data.mine || [];
				publicLeagues = data.public || [];
			}
		} catch {
			toast('Failed to load leagues', 'error');
		} finally {
			loading = false;
		}
	}

	async function createLeague() {
		if (!newLeagueName.trim()) return;
		try {
			const res = await fetch('/api/leagues', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newLeagueName.trim(), type: newLeagueType })
			});
			if (res.ok) {
				const data = await res.json();
				showCreate = false;
				newLeagueName = '';
				await loadLeagues();
				if (Array.isArray(data.newBadges)) {
					for (const code of data.newBadges) {
						const badge = BADGE_MAP.get(code);
						if (badge) toast(`${badge.emoji} Badge unlocked: ${badge.name}`, 'success');
					}
				}
				goto(`/leagues/${data.id}`);
			} else {
				const err = await res.json();
				toast(err.error || 'Failed to create league', 'error');
			}
		} catch {
			toast('Failed to create league', 'error');
		}
	}

	async function joinLeague() {
		if (!inviteCode.trim()) return;
		try {
			const res = await fetch('/api/leagues/join', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inviteCode: inviteCode.trim() })
			});
			if (res.ok) {
				const data = await res.json();
				showJoin = false;
				inviteCode = '';
				await loadLeagues();
				goto(`/leagues/${data.leagueId}`);
			} else {
				const err = await res.json();
				toast(err.error || 'Failed to join league', 'error');
			}
		} catch {
			toast('Failed to join league', 'error');
		}
	}
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<div class="mb-6.5 flex flex-wrap items-end justify-between gap-6">
		<div>
			<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">Leagues</h1>
			<p class="mt-2 text-sm text-text-muted">Private ladders with your own crowd</p>
		</div>
		<div class="flex gap-2.5">
			<button
				onclick={() => (showCreate = true)}
				class="cursor-pointer rounded-full bg-primary px-[26px] py-3 text-sm font-extrabold text-text transition hover:bg-primary-hover"
			>
				Create league
			</button>
			<button
				onclick={() => (showJoin = true)}
				class="cursor-pointer rounded-full border border-border bg-transparent px-[26px] py-3 text-sm font-bold text-text-muted transition hover:bg-hover"
			>
				Join with code
			</button>
		</div>
	</div>

	<div class="mb-4.5 flex w-fit gap-1 rounded-full border border-border bg-surface p-1">
		<button
			onclick={() => (tab = 'mine')}
			class="cursor-pointer rounded-full px-4 py-1.5 text-xs font-bold transition-all {tab === 'mine'
				? 'bg-primary text-text'
				: 'text-text-muted'}"
		>
			My leagues ({myLeagues.length})
		</button>
		<button
			onclick={() => (tab = 'public')}
			class="cursor-pointer rounded-full px-4 py-1.5 text-xs font-bold transition-all {tab === 'public'
				? 'bg-primary text-text'
				: 'text-text-muted'}"
		>
			Browse public
		</button>
	</div>

	{#if loading}
		<div class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
			{#each [0, 1, 2] as i (i)}
				<div class="h-40 animate-pulse rounded-[20px] bg-surface-alt"></div>
			{/each}
		</div>
	{:else}
		{@const list = tab === 'mine' ? myLeagues : publicLeagues}
		{#if list.length === 0}
			<div class="rounded-[20px] border border-dashed border-border-strong bg-surface py-16 text-center">
				<p class="text-sm font-bold text-text-muted">
					{tab === 'mine' ? "You haven't joined any leagues yet" : 'No public leagues available'}
				</p>
			</div>
		{:else}
			<div class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5">
				{#each list as league (league.id)}
					<button
						onclick={() => goto(`/leagues/${league.id}`)}
						class="cursor-pointer rounded-[20px] border border-border bg-surface p-6 text-left transition-transform hover:-translate-y-1"
					>
						<div class="mb-4 flex items-center justify-between">
							<span
								class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase"
								style="background:var(--color-primary-muted);color:var(--color-primary-ink)">{league.type}</span
							>
							<span class="font-mono text-xs text-text-muted">{league.memberCount} members</span>
						</div>
						<div class="text-xl font-extrabold tracking-[-0.02em]">{league.name}</div>
						<div class="mt-1.5 text-[13px] text-text-muted">
							Season ends {new Date(league.seasonEnd).toLocaleDateString()}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

{#if showCreate}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
		<div class="w-full max-w-sm rounded-[24px] bg-surface p-7">
			<h2 class="mb-4.5 text-xl font-extrabold tracking-[-0.02em]">Create league</h2>
			<div class="mb-4">
				<label for="league-name" class="mb-1.5 block text-xs font-bold text-text-muted">League name</label>
				<input
					id="league-name"
					type="text"
					bind:value={newLeagueName}
					placeholder="e.g. Solana Maxis"
					class="w-full rounded-xl border border-border px-3.5 py-2.5 text-sm outline-none focus:border-primary"
				/>
			</div>
			<div class="mb-6">
				<div class="mb-1.5 text-xs font-bold text-text-muted">Type</div>
				<div class="flex gap-2">
					<button
						onclick={() => (newLeagueType = 'public')}
						class="flex-1 cursor-pointer rounded-xl border py-2.5 text-sm font-bold transition-all"
						style={newLeagueType === 'public'
							? 'border-color:var(--color-primary);background:var(--color-primary-muted);color:var(--color-primary-ink)'
							: 'border-color:var(--color-border);color:var(--color-text-muted)'}
					>
						Public
					</button>
					<button
						onclick={() => (newLeagueType = 'private')}
						class="flex-1 cursor-pointer rounded-xl border py-2.5 text-sm font-bold transition-all"
						style={newLeagueType === 'private'
							? 'border-color:var(--color-primary);background:var(--color-primary-muted);color:var(--color-primary-ink)'
							: 'border-color:var(--color-border);color:var(--color-text-muted)'}
					>
						Private
					</button>
				</div>
			</div>
			<div class="flex gap-2.5">
				<button
					onclick={() => (showCreate = false)}
					class="flex-1 cursor-pointer rounded-full border border-border py-3 text-sm font-bold text-text-muted hover:bg-hover"
				>
					Cancel
				</button>
				<button
					onclick={createLeague}
					disabled={!newLeagueName.trim()}
					class="flex-1 cursor-pointer rounded-full py-3 text-sm font-extrabold transition-all {newLeagueName.trim()
						? 'bg-primary text-text hover:bg-primary-hover'
						: 'cursor-not-allowed bg-surface-alt text-text-muted'}"
				>
					Create
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showJoin}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
		<div class="w-full max-w-sm rounded-[24px] bg-surface p-7">
			<h2 class="mb-4.5 text-xl font-extrabold tracking-[-0.02em]">Join league</h2>
			<div class="mb-6">
				<label for="invite-code" class="mb-1.5 block text-xs font-bold text-text-muted">Invite code</label>
				<input
					id="invite-code"
					type="text"
					bind:value={inviteCode}
					placeholder="Enter 6-character code"
					class="w-full rounded-xl border border-border px-3.5 py-2.5 text-sm uppercase outline-none focus:border-primary"
				/>
			</div>
			<div class="flex gap-2.5">
				<button
					onclick={() => (showJoin = false)}
					class="flex-1 cursor-pointer rounded-full border border-border py-3 text-sm font-bold text-text-muted hover:bg-hover"
				>
					Cancel
				</button>
				<button
					onclick={joinLeague}
					disabled={!inviteCode.trim()}
					class="flex-1 cursor-pointer rounded-full py-3 text-sm font-extrabold transition-all {inviteCode.trim()
						? 'bg-primary text-text hover:bg-primary-hover'
						: 'cursor-not-allowed bg-surface-alt text-text-muted'}"
				>
					Join
				</button>
			</div>
		</div>
	</div>
{/if}

<Toast />
