<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from '$lib/toast';

	// Purely informational — a term and its definition. No quiz here: that's
	// the Gauntlet's job, and only its job. This used to ask a multiple-choice
	// question of its own, which is exactly the duplication that was flagged.
	type DailyTerm = {
		id: string;
		term: string;
		definition: string;
		xpReward: number;
		alreadyAnswered: boolean;
	};

	let dailyTerm = $state<DailyTerm | null>(null);
	let loading = $state(true);
	let claiming = $state(false);
	let claimedXp = $state<number | null>(null);

	onMount(loadTerm);

	async function loadTerm() {
		loading = true;
		try {
			const res = await fetch('/api/term/today');
			dailyTerm = res.ok ? await res.json() : null;
		} catch {
			dailyTerm = null;
		} finally {
			loading = false;
		}
	}

	async function claim() {
		if (!dailyTerm || dailyTerm.alreadyAnswered || claiming) return;
		claiming = true;
		try {
			const res = await fetch('/api/term/answer', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ termId: dailyTerm.id })
			});
			const data = await res.json();
			if (res.ok) {
				claimedXp = data.xpEarned;
				dailyTerm = { ...dailyTerm, alreadyAnswered: true };
				toast(`+${data.xpEarned} XP!`, 'success');
			} else {
				toast(data.error || 'Failed to claim', 'error');
			}
		} catch {
			toast('Claim failed', 'error');
		} finally {
			claiming = false;
		}
	}
</script>

<div class="rounded-[20px] border border-border bg-surface p-[22px]">
	<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">Word of the day</div>

	{#if loading}
		<div class="h-24 animate-pulse rounded-2xl bg-surface-alt"></div>
	{:else if !dailyTerm}
		<p class="text-sm text-text-muted">No term available today. Check back tomorrow!</p>
	{:else}
		<div class="rounded-2xl bg-surface-alt p-4">
			<p class="font-mono text-sm font-extrabold text-primary-ink">{dailyTerm.term}</p>
			<p class="mt-2 text-[14px] leading-snug text-text">{dailyTerm.definition}</p>
		</div>

		{#if dailyTerm.alreadyAnswered}
			<div class="mt-3.5 rounded-2xl p-4" style="background:rgba(104,194,168,0.12)">
				<p class="text-sm font-extrabold" style="color:var(--color-mint-ink)">
					{claimedXp != null ? `+${claimedXp} XP earned` : 'Already read today'}
				</p>
			</div>
		{:else}
			<button
				onclick={claim}
				disabled={claiming}
				class="mt-3.5 w-full cursor-pointer rounded-full bg-primary py-3 text-sm font-extrabold text-text transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
			>
				{claiming ? 'Claiming…' : `Got it — claim +${dailyTerm.xpReward} XP`}
			</button>
		{/if}
	{/if}
</div>
