<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/toast';
	import { resolve } from '$app/paths';

	import { DURATION_OPTIONS, DEFAULT_DURATION_MINUTES, durationLabel } from '$lib/constants';
	import { STAKE_TIERS } from '$lib/stakes';

	const NO_OPPONENT_SUGGEST_MS = 20_000;

	// Terms are chosen before matching, and players are matched on them — so the
	// page opens on a picker rather than searching immediately.
	let status = $state<'idle' | 'searching' | 'matched' | 'error'>('idle');
	let durationMinutes = $state(DEFAULT_DURATION_MINUTES);
	// Stake tier. Matching on it IS the agreement to that stake, so there's
	// nothing to negotiate later. 0 = play for nothing.
	let stakeTier = $state(0);
	let xpBalance = $state<number | null>(null);
	let errorMessage = $state('');
	let contestId = $state('');
	let _opponentId = $state('');
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let searchStartTime = $state(0);
	let elapsed = $state(0);
	let noOpponentYet = $state(false);
	let startingScrimmage = $state(false);

	const elapsedStr = $derived.by(() => {
		const s = Math.floor(elapsed / 1000);
		const m = Math.floor(s / 60);
		return `${m}:${(s % 60).toString().padStart(2, '0')}`;
	});

	// No auto-search: the player picks terms first. Previously this page joined
	// the queue the moment it loaded, which is incompatible with choosing a
	// duration to be matched on.

	onMount(async () => {
		// Needed to grey out tiers the player can't cover — offering a stake they
		// can't fund would fail only after they'd committed to it.
		try {
			const res = await fetch('/api/me');
			if (res.ok) xpBalance = (await res.json())?.xpTotal ?? 0;
		} catch {
			/* balance is a nicety; the server enforces affordability anyway */
		}
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});

	async function startSearch() {
		status = 'searching';
		searchStartTime = Date.now();
		elapsed = 0;
		noOpponentYet = false;

		// Poll elapsed time
		const elapsedTimer = setInterval(() => {
			elapsed = Date.now() - searchStartTime;
			if (elapsed > NO_OPPONENT_SUGGEST_MS) noOpponentYet = true;
		}, 1000);

		// Join queue
		const res = await fetch('/api/matchmaking/join', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'daily', durationMinutes, stakeTier })
		});

		if (res.status === 401) {
			window.location.href = '/?auth=required';
			return;
		}
		if (!res.ok) {
			clearInterval(elapsedTimer);
			status = 'error';
			errorMessage = 'Could not join matchmaking. Please try again.';
			return;
		}

		const data = await res.json();
		if (data.status === 'matched') {
			clearInterval(elapsedTimer);
			contestId = data.contestId;
			_opponentId = data.opponentId;
			status = 'matched';
			toast('Opponent found!', 'success');
			setTimeout(() => goto(resolve(`/draft?contestId=${contestId}`)), 1500);
			return;
		}

		// Poll for a real opponent every 3s — no bot fallback, ever (Single Match is real-opponents-only)
		pollTimer = setInterval(async () => {
			const pollRes = await fetch('/api/matchmaking/status');
			if (pollRes.status === 401) {
				clearInterval(elapsedTimer);
				if (pollTimer) clearInterval(pollTimer);
				pollTimer = null;
				window.location.href = '/?auth=required';
				return;
			}
			if (!pollRes.ok) return; // transient — let the next 3s tick retry
			const pollData = await pollRes.json();
			if (pollData.status === 'matched') {
				clearInterval(elapsedTimer);
				if (pollTimer) clearInterval(pollTimer);
				pollTimer = null;
				contestId = pollData.contestId;
				_opponentId = pollData.opponentId;
				status = 'matched';
				toast('Opponent found!', 'success');
				setTimeout(() => goto(resolve(`/draft?contestId=${contestId}`)), 1500);
			}
		}, 3000);
	}

	async function cancelSearch() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		await fetch('/api/matchmaking/leave', { method: 'POST' });
		goto(resolve('/dashboard'));
	}

	async function startScrimmage() {
		startingScrimmage = true;
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		await fetch('/api/matchmaking/leave', { method: 'POST' });
		try {
			const res = await fetch('/api/contests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'daily', mode: 'paper', durationMinutes })
			});
			if (res.status === 401) {
				window.location.href = '/?auth=required';
				return;
			}
			if (!res.ok) throw new Error('Could not start Scrimmage. Please try again.');
			const contest = await res.json();
			window.location.href = `/draft?contestId=${contest.id}&type=${contest.type}&mode=paper`;
		} catch (error) {
			startingScrimmage = false;
			status = 'error';
			errorMessage = (error as Error)?.message ?? 'Could not start Scrimmage. Please try again.';
		}
	}
</script>

<div class="mx-auto max-w-[720px] px-7 py-14">
	{#if status === 'idle'}
		<div class="rounded-[24px] border border-border bg-surface p-11 max-sm:p-6">
			<div class="font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase">
				Single Match
			</div>
			<h1 class="mt-3 text-[38px] leading-none font-black tracking-[-0.04em] max-sm:text-[28px]">
				How long should it run?
			</h1>
			<p class="mt-3 text-[15px] text-text-muted">
				You'll be matched with someone who picked the same length, so prices are read over the same
				window. Shorter games fill more slowly — there are fewer people waiting on them.
			</p>

			<div class="mt-7 flex flex-wrap gap-2.5">
				{#each DURATION_OPTIONS as opt (opt.minutes)}
					<button
						type="button"
						onclick={() => (durationMinutes = opt.minutes)}
						aria-pressed={durationMinutes === opt.minutes}
						class="cursor-pointer rounded-full border-[1.5px] px-5 py-3 text-sm font-bold transition"
						style={durationMinutes === opt.minutes
							? 'background:var(--color-text);color:var(--color-primary);border-color:var(--color-text)'
							: 'background:transparent;color:var(--color-text-muted);border-color:var(--color-border)'}
					>
						{opt.label}
					</button>
				{/each}
			</div>

			<div class="mt-7">
				<div class="mb-3 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
					Play for something?
				</div>
				<div class="flex flex-wrap gap-2.5">
					{#each STAKE_TIERS as tier (tier)}
						{@const tooRich = tier > 0 && xpBalance != null && xpBalance < tier}
						<button
							type="button"
							disabled={tooRich}
							onclick={() => (stakeTier = tier)}
							aria-pressed={stakeTier === tier}
							title={tooRich ? `You have ${xpBalance} XP` : undefined}
							class="cursor-pointer rounded-full border-[1.5px] px-5 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-35"
							style={stakeTier === tier
								? 'background:var(--color-text);color:var(--color-primary);border-color:var(--color-text)'
								: 'background:transparent;color:var(--color-text-muted);border-color:var(--color-border)'}
						>
							{tier === 0 ? 'No stake' : `${tier} XP`}
						</button>
					{/each}
				</div>
				{#if stakeTier > 0}
					<p class="mt-3 text-[13px] text-text-muted">
						You'll be matched with someone who chose the same stake. Before the game starts you can
						raise — but it always settles at the <strong class="text-text">lower</strong> of the two,
						so you can never be pushed above your own number.
					</p>
				{/if}
				{#if xpBalance != null}
					<p class="mt-2 font-mono text-[12px] text-text-muted">Balance: {xpBalance} XP</p>
				{/if}
			</div>

			<button
				onclick={startSearch}
				class="mt-8 h-13 w-full cursor-pointer rounded-full bg-primary text-sm font-extrabold text-text transition hover:bg-primary-hover"
			>
				Find an opponent · {durationLabel(durationMinutes)}{stakeTier > 0
					? ` · ${stakeTier} XP`
					: ''}
			</button>

			<!-- Offered up front, not just after 20s of waiting. Someone who'd rather
			     not wait for a real opponent shouldn't have to wait to find that out. -->
			<div class="mt-5 border-t border-border pt-5 text-center">
				<p class="text-[13px] text-text-muted">Don't want to wait for a real opponent?</p>
				<button
					onclick={startScrimmage}
					disabled={startingScrimmage}
					class="mt-2.5 cursor-pointer rounded-full border-[1.5px] border-border bg-transparent px-6 py-2.5 text-sm font-bold text-text transition hover:border-primary disabled:opacity-60"
				>
					{startingScrimmage ? 'Starting…' : 'Play a Scrimmage instead'}
				</button>
			</div>
		</div>
	{:else if status === 'searching'}
		<div
			class="hero-coral dot-grid relative flex min-h-[440px] flex-col justify-between overflow-hidden rounded-[24px] p-11"
		>
			<div
				class="pointer-events-none absolute top-[70px] right-[-70px] flex h-80 w-80 items-center justify-center"
			>
				<div
					class="anim-pulse absolute h-52 w-52 rounded-full border-2 border-[rgba(26,36,33,0.28)]"
				></div>
				<div
					class="anim-pulse absolute h-52 w-52 rounded-full border-2 border-[rgba(26,36,33,0.28)]"
					style="animation-delay:0.85s"
				></div>
				<div
					class="anim-pulse absolute h-52 w-52 rounded-full border-2 border-[rgba(26,36,33,0.28)]"
					style="animation-delay:1.7s"
				></div>
				<div class="h-[74px] w-[74px] rounded-full bg-text"></div>
			</div>
			<div class="relative flex items-start justify-between">
				<span
					class="flex items-center gap-2 rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
				>
					<span class="anim-blink h-1.5 w-1.5 rounded-full bg-primary"></span>Searching
				</span>
			</div>
			<div class="relative">
				<div class="text-[54px] leading-[0.94] font-black tracking-[-0.045em]">
					Finding your rival
				</div>
				<p class="mt-4 text-[15px] opacity-80">
					Scanning for a real, currently-available opponent. No bots here — if no one's around,
					you'll get the option to Scrimmage instead while we keep looking.
				</p>
			</div>
			<div class="relative flex items-end justify-between gap-6">
				<div class="font-mono text-[42px] leading-none font-bold tracking-[-0.03em]">
					{elapsedStr}
				</div>
				<button
					onclick={cancelSearch}
					class="cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-[26px] py-3.5 text-sm font-bold text-text"
				>
					Cancel search
				</button>
			</div>
		</div>
		{#if noOpponentYet}
			<div
				class="mt-4.5 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border bg-surface p-5"
			>
				<div>
					<div class="text-sm font-extrabold text-text">No one's online right now</div>
					<p class="mt-1 text-[13px] text-text-muted">
						We'll keep searching in the background — or jump into Scrimmage while you wait.
					</p>
				</div>
				<button
					onclick={startScrimmage}
					disabled={startingScrimmage}
					class="cursor-pointer rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-text disabled:opacity-60"
				>
					{startingScrimmage ? 'Starting…' : 'Try Scrimmage instead'}
				</button>
			</div>
		{/if}
	{:else if status === 'matched'}
		<div
			class="hero-coral dot-grid flex min-h-[300px] flex-col justify-between rounded-[24px] p-11"
		>
			<span
				class="w-fit rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
				>Matched</span
			>
			<div>
				<div class="text-[44px] leading-none font-black tracking-[-0.045em]">Opponent found</div>
				<p class="mt-3 text-[15px] opacity-80">Redirecting to the draft…</p>
			</div>
		</div>
	{:else if status === 'error'}
		<div class="rounded-[24px] border border-border bg-surface p-11 text-center">
			<div class="text-[28px] font-black tracking-[-0.03em]">Something went wrong</div>
			<p class="mt-3 text-[15px] text-text-muted">{errorMessage}</p>
			<button
				onclick={startSearch}
				class="mt-6 cursor-pointer rounded-full bg-primary px-9 py-3.5 text-sm font-extrabold text-text"
			>
				Try again
			</button>
		</div>
	{/if}
</div>

<Toast />
