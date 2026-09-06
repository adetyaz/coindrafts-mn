<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/toast';

	type Member = {
		id: string;
		userId: string;
		username: string;
		wins: number;
		losses: number;
		points: number;
		joinedAt: string;
	};

	type League = {
		id: string;
		name: string;
		type: string;
		inviteCode: string | null;
		seasonStart: string;
		seasonEnd: string;
	};

	let league = $state<League | null>(null);
	let members = $state<Member[]>([]);
	let loading = $state(true);

	onMount(async () => {
		const id = page.params.id;
		try {
			const res = await fetch(`/api/leagues/${id}`);
			if (res.ok) {
				const data = await res.json();
				league = data.league;
				members = data.members;
			} else {
				toast('League not found', 'error');
				goto('/leagues');
			}
		} catch {
			toast('Failed to load league', 'error');
		} finally {
			loading = false;
		}
	});

	function copyInviteCode() {
		if (league?.inviteCode) {
			navigator.clipboard.writeText(league.inviteCode);
			toast('Invite code copied!', 'success');
		}
	}
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	{#if loading}
		<div class="h-32 animate-pulse rounded-[20px] bg-surface-alt"></div>
	{:else if league}
		<div class="mb-6.5 flex flex-wrap items-end justify-between gap-6">
			<div>
				<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">{league.name}</h1>
				<p class="mt-2 text-sm text-text-muted">
					{league.type} &middot; {members.length} members &middot; Season ends {new Date(
						league.seasonEnd
					).toLocaleDateString()}
				</p>
			</div>
		</div>

		<div class="flex flex-wrap gap-4.5">
			<div class="min-w-0 flex-[1_1_520px]">
				<div class="mb-3 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">Standings</div>
				{#if members.length === 0}
					<div class="rounded-[20px] border border-dashed border-border-strong bg-surface py-14 text-center">
						<p class="text-sm font-bold text-text-muted">No members yet</p>
					</div>
				{:else}
					<div class="overflow-x-auto rounded-[18px] border border-border">
						<div
							class="grid min-w-[520px] grid-cols-[56px_minmax(140px,1fr)_70px_70px_80px] gap-2.5 bg-surface px-5 py-2.5 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase"
						>
							<div>#</div>
							<div>Player</div>
							<div class="text-right">W</div>
							<div class="text-right">L</div>
							<div class="text-right">Pts</div>
						</div>
						{#each members as member, i (member.id)}
							<div
								class="grid min-w-[520px] grid-cols-[56px_minmax(140px,1fr)_70px_70px_80px] items-center gap-2.5 border-t border-border px-5 py-3.5"
								style={i === 0 ? 'background:var(--color-primary-muted)' : ''}
							>
								<span class="font-mono text-sm font-bold" style={i === 0 ? 'color:var(--color-primary-ink)' : 'color:var(--color-text-muted)'}>{i + 1}</span>
								<span class="truncate text-sm font-bold">{member.username}</span>
								<span class="text-right font-mono text-sm font-bold text-positive-ink">{member.wins}</span>
								<span class="text-right font-mono text-sm font-bold text-negative-ink">{member.losses}</span>
								<span class="text-right font-mono text-sm font-bold">{member.points}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
				{#if league.inviteCode}
					<div class="hero-coral dot-grid rounded-[20px] p-6">
						<div class="mb-3.5 text-[11px] font-extrabold tracking-[0.12em] opacity-75 uppercase">Invite code</div>
						<div class="mb-4.5 font-mono text-[26px] font-bold tracking-[0.06em]">{league.inviteCode}</div>
						<button
							onclick={copyInviteCode}
							class="w-full cursor-pointer rounded-full bg-text py-3 text-sm font-extrabold text-primary"
							>Copy invite code</button
						>
					</div>
				{/if}
				<a
					href="/leagues"
					class="w-full rounded-full border border-border bg-transparent py-3.5 text-center text-sm font-bold text-text no-underline"
					>&larr; All leagues</a
				>
			</div>
		</div>
	{/if}
</div>

<Toast />
