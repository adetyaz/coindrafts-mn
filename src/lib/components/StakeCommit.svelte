<script lang="ts">
	// The commit step: confirm the matched stake, or raise it.
	//
	// Blind by design — you never see what your opponent committed, only whether
	// they have. Because the wager settles at the LOWER of the two, raising can
	// never cost you more than your own number, which is what makes this safe
	// without a timer, a counter-offer, or any way to be pressured.
	import { toast } from '$lib/toast';

	type StakeState = {
		id: string;
		tierAmount: number;
		currency: string;
		status: string;
		agreedAmount: number | null;
		myCommit: number | null;
		confirmedAdult: boolean;
		opponentCommitted: boolean;
		balance: number;
	};

	let { stakeId, onLocked }: { stakeId: string; onLocked?: () => void } = $props();

	let stake = $state<StakeState | null>(null);
	let amount = $state(0);
	let adult = $state(false);
	let submitting = $state(false);
	let error = $state('');
	let poll: ReturnType<typeof setInterval> | null = null;

	async function load() {
		try {
			const res = await fetch(`/api/stake/${stakeId}`);
			if (!res.ok) return;
			const data: StakeState = await res.json();
			stake = data;
			if (amount < data.tierAmount) amount = data.tierAmount;
			if (data.status === 'locked' || data.status === 'settled') {
				if (poll) clearInterval(poll);
				onLocked?.();
			}
		} catch {
			/* transient — the next tick retries */
		}
	}

	$effect(() => {
		void stakeId;
		load();
		// Only to notice the opponent committing; this is not a countdown, and
		// nothing expires.
		poll = setInterval(load, 3000);
		return () => {
			if (poll) clearInterval(poll);
		};
	});

	const canAfford = $derived(stake ? amount <= stake.balance : false);

	async function commit() {
		if (!stake) return;
		submitting = true;
		error = '';
		try {
			const res = await fetch(`/api/stake/${stakeId}/commit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount, confirmedAdult: adult })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data?.error ?? 'Could not commit';
				return;
			}
			await load();
			toast(
				data.status === 'locked'
					? `Wager locked at ${data.agreed} XP`
					: 'Committed — waiting for your opponent',
				'success'
			);
		} catch {
			error = 'Could not reach the server. Try again.';
		} finally {
			submitting = false;
		}
	}
</script>

{#if stake}
	<div class="rounded-[20px] border border-border bg-surface p-6">
		{#if stake.status === 'locked' || stake.status === 'settled'}
			<div class="flex items-center gap-2.5">
				<span class="text-[11px] font-extrabold tracking-[0.12em] text-positive-ink uppercase">
					Wager locked
				</span>
			</div>
			<div class="mt-2 font-mono text-[32px] leading-none font-bold">
				{stake.agreedAmount} XP
			</div>
			<p class="mt-2 text-[13px] text-text-muted">
				Both players are risking the same. Winner takes {(stake.agreedAmount ?? 0) * 2} XP.
			</p>
		{:else if stake.myCommit != null}
			<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				Committed
			</div>
			<div class="mt-2 font-mono text-[32px] leading-none font-bold">{stake.myCommit} XP</div>
			<p class="mt-2 text-[13px] text-text-muted">
				{stake.opponentCommitted
					? 'Locking in…'
					: 'Waiting for your opponent to commit. Nothing expires — take your time.'}
			</p>
		{:else}
			<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				Your stake
			</div>
			<h3 class="mt-2 text-[22px] font-black tracking-[-0.02em]">
				Matched at {stake.tierAmount} XP
			</h3>
			<p class="mt-2 max-w-[46ch] text-[13px] text-text-muted">
				Confirm, or raise. It settles at the <strong class="text-text">lower</strong> of the two
				commits — so raising can never cost you more than you choose here.
			</p>

			<div class="mt-5 flex items-center gap-3">
				<input
					type="number"
					bind:value={amount}
					min={stake.tierAmount}
					max={stake.balance}
					step="5"
					class="w-32 rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 font-mono text-sm font-bold text-text"
				/>
				<span class="font-mono text-[12px] text-text-muted">
					min {stake.tierAmount} · you have {stake.balance}
				</span>
			</div>

			{#if !canAfford}
				<p class="mt-2 text-[13px] text-negative-ink">
					You only have {stake.balance} XP.
				</p>
			{/if}

			<label class="mt-4 flex cursor-pointer items-start gap-2.5 text-[13px] text-text-muted">
				<input type="checkbox" bind:checked={adult} class="mt-0.5 cursor-pointer" />
				<span>I confirm I am 18 or over.</span>
			</label>

			{#if error}
				<p class="mt-3 text-[13px] text-negative-ink">{error}</p>
			{/if}

			<button
				onclick={commit}
				disabled={submitting || !adult || !canAfford}
				class="mt-5 h-12 w-full cursor-pointer rounded-full bg-primary text-sm font-extrabold text-text transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
			>
				{submitting ? 'Committing…' : `Commit ${amount} XP`}
			</button>
		{/if}
	</div>
{/if}
