<script lang="ts">
	// Update your info — public display name (a normal field, updated directly),
	// plus the three private fields KycAttestation.compact's submitKyc circuit
	// needs (contracts/midnight/src/KycAttestation.compact): full name, birth
	// year, country. No ID number — dropped; this is a lightweight age gate for
	// a game, not identity verification, and nothing here ever validated an ID
	// number against anything anyway.
	//
	// Submission is real: it derives a Midnight identity from your connected
	// wallet's signature (src/lib/midnightWallet.ts — no Lace involved), funds
	// and DUST-registers that identity if needed (local devnet only), then
	// submits a real submitKyc transaction against the deployed contract —
	// real proof generation, real network round-trip. None of this is instant;
	// see the stage copy below for what's actually happening and roughly how
	// long each part takes.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { toast } from '$lib/toast';
	import { COUNTRIES } from '$lib/countries';
	import { deriveMidnightSeed, openMidnightWallet, ensureFundedAndRegistered, type FundingStage } from '$lib/midnightWallet';
	import { submitKyc } from '$lib/midnight/kyc';

	const CURRENT_YEAR = new Date().getFullYear();
	const MIN_BIRTH_YEAR = CURRENT_YEAR - 120;
	const MAX_BIRTH_YEAR = CURRENT_YEAR - 13;

	// Public — updates immediately via PATCH /api/me.
	let username = $state('');
	let usernameSaved = $state('');
	let savingUsername = $state(false);

	// Private — goes into the Midnight commitment, never to our servers.
	let fullName = $state('');
	let birthYear = $state<number | ''>('');
	let country = $state('');

	onMount(async () => {
		const res = await fetch('/api/me');
		if (res.ok) {
			const me = await res.json();
			username = me.username ?? '';
			usernameSaved = username;
		}
	});

	async function saveUsername() {
		if (username.trim() === usernameSaved || username.trim().length < 2) return;
		savingUsername = true;
		try {
			const res = await fetch('/api/me', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: username.trim() })
			});
			const data = await res.json();
			if (!res.ok) {
				toast(data?.error ?? 'Could not update display name', 'error');
				return;
			}
			usernameSaved = data.username;
			toast('Display name updated', 'success');
		} catch {
			toast('Could not reach the server', 'error');
		} finally {
			savingUsername = false;
		}
	}

	const errors = $derived.by(() => {
		const e: Partial<Record<'fullName' | 'birthYear', string>> = {};
		if (fullName.trim().length > 0 && fullName.trim().length < 2) e.fullName = 'Too short.';
		if (birthYear !== '' && (birthYear < MIN_BIRTH_YEAR || birthYear > MAX_BIRTH_YEAR)) {
			e.birthYear = `Enter a year between ${MIN_BIRTH_YEAR} and ${MAX_BIRTH_YEAR}.`;
		}
		return e;
	});

	const isValid = $derived(
		fullName.trim().length >= 2 &&
			birthYear !== '' &&
			birthYear >= MIN_BIRTH_YEAR &&
			birthYear <= MAX_BIRTH_YEAR &&
			country.length > 0 &&
			Object.keys(errors).length === 0
	);

	// ── Submission ─────────────────────────────────────────────────────────

	type SubmitStage = 'idle' | 'deriving-identity' | FundingStage | 'submitting' | 'done' | 'error';

	let submitStage = $state<SubmitStage>('idle');
	let submitError = $state('');
	let submitTxId = $state('');

	const submitting = $derived(submitStage !== 'idle' && submitStage !== 'done' && submitStage !== 'error');

	// Real, measured stage copy — proof generation is not instant (observed
	// ~20-30s for the local devnet's constructor call; submitKyc is a
	// comparable single-circuit call). DUST accrual after registration is the
	// slower, more variable part on a freshly-derived identity.
	const stageLabel = $derived.by(() => {
		switch (submitStage) {
			case 'deriving-identity':
				return 'Setting up your private identity — check your wallet for a signature request…';
			case 'checking':
				return 'Checking your Midnight identity…';
			case 'requesting-funds':
				return 'Requesting devnet network fees for this identity…';
			case 'waiting-for-funds':
				return 'Waiting for funds to arrive on-chain…';
			case 'registering-dust':
				return 'Registering this identity to generate network fees…';
			case 'waiting-for-dust':
				return 'Waiting for network fees to become available — this can take up to a couple of minutes the first time…';
			case 'ready':
				return 'Ready — starting submission…';
			case 'submitting':
				return 'Generating your proof and submitting — real zero-knowledge proof generation, typically well under a minute on the local network. Do not close this tab.';
			default:
				return '';
		}
	});

	async function handleSubmit() {
		if (!isValid || submitting) return;
		submitError = '';
		submitTxId = '';
		submitStage = 'deriving-identity';

		let session: Awaited<ReturnType<typeof openMidnightWallet>> | null = null;
		try {
			const { seed } = await deriveMidnightSeed();
			session = await openMidnightWallet(seed);

			await ensureFundedAndRegistered(session, (stage) => (submitStage = stage));

			submitStage = 'submitting';
			const result = await submitKyc(session, seed, {
				fullName: fullName.trim(),
				birthYear: birthYear as number,
				country
			});

			submitTxId = result.txId;
			submitStage = 'done';
			toast('Verification submitted and confirmed on-chain.', 'success');
		} catch (e) {
			submitError = e instanceof Error ? e.message : 'Submission failed.';
			submitStage = 'error';
			toast(submitError, 'error');
		} finally {
			await session?.stop();
		}
	}
</script>

<div class="mx-auto max-w-[640px] px-7 pt-7 pb-18">
	<a
		href={resolve('/profile')}
		class="mb-6 inline-flex items-center gap-1.5 text-xs font-bold text-text-muted no-underline hover:text-text"
	>
		&larr; Back to profile
	</a>

	<h1 class="text-[28px] font-black tracking-[-0.02em]">Update your info</h1>
	<p class="mt-2 max-w-[52ch] text-[14px] text-text-muted">
		Your display name is public. The rest is only ever used to prove you're 18+ for wagering — it
		never reaches our servers.
	</p>

	<!-- Public -->
	<div class="mt-6 rounded-[20px] border border-border bg-surface p-6">
		<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
			Display name
		</div>
		<p class="mt-1 mb-3 text-[13px] text-text-muted">Shown on leaderboards and match results.</p>
		<div class="flex items-center gap-3">
			<input
				type="text"
				bind:value={username}
				maxlength={24}
				class="flex-1 rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-bold text-text"
			/>
			<button
				onclick={saveUsername}
				disabled={savingUsername || username.trim() === usernameSaved || username.trim().length < 2}
				class="h-11 shrink-0 cursor-pointer rounded-full bg-primary px-5 text-xs font-extrabold text-text transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
			>
				{savingUsername ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>

	<!-- Private, Midnight-committed -->
	<div class="mt-4.5 rounded-[20px] border border-border bg-surface p-6">
		<div class="text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
			Age verification
		</div>
		<p class="mt-1 mb-4 text-[13px] text-text-muted">
			Required before wagering. Only "18 or over: yes/no" is ever made public — never your name,
			birth year, or location.
		</p>

		<div class="flex flex-col gap-4">
			<div>
				<label for="fullName" class="mb-1.5 block text-[12px] font-extrabold text-text">
					Full name
				</label>
				<input
					id="fullName"
					type="text"
					bind:value={fullName}
					autocomplete="name"
					placeholder="Jane Doe"
					class="w-full rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-medium text-text"
				/>
				{#if errors.fullName}
					<p class="mt-1.5 text-[12px] text-negative-ink">{errors.fullName}</p>
				{/if}
			</div>

			<div>
				<label for="birthYear" class="mb-1.5 block text-[12px] font-extrabold text-text">
					Age
				</label>
				<input
					id="birthYear"
					type="number"
					bind:value={birthYear}
					min={MIN_BIRTH_YEAR}
					max={MAX_BIRTH_YEAR}
					placeholder="Birth year, e.g. 1995"
					class="w-full rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 font-mono text-sm font-bold text-text"
				/>
				{#if errors.birthYear}
					<p class="mt-1.5 text-[12px] text-negative-ink">{errors.birthYear}</p>
				{/if}
			</div>

			<div>
				<label for="country" class="mb-1.5 block text-[12px] font-extrabold text-text">
					Location
				</label>
				<select
					id="country"
					bind:value={country}
					class="w-full rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-medium text-text"
				>
					<option value="" disabled selected>Select your country</option>
					{#each COUNTRIES as c (c)}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</div>
		</div>

		<button
			type="button"
			onclick={handleSubmit}
			disabled={!isValid || submitting || submitStage === 'done'}
			class="mt-5 h-12 w-full rounded-full bg-primary text-sm font-extrabold text-text transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if submitStage === 'done'}
				Verified
			{:else if submitting}
				Submitting…
			{:else}
				Submit for verification
			{/if}
		</button>

		{#if submitting}
			<p class="mt-3 text-center text-[12px] text-text-muted">{stageLabel}</p>
		{:else if submitStage === 'error'}
			<p class="mt-3 text-center text-[12px] text-negative-ink">{submitError}</p>
		{:else if submitStage === 'done'}
			<p class="mt-3 text-center text-[12px] text-text-muted">
				Confirmed on-chain — tx <span class="font-mono">{submitTxId.slice(0, 18)}…</span>
			</p>
		{:else if isValid}
			<p class="mt-2 text-center text-[12px] text-text-muted">
				Submitting will ask your wallet to sign once (to derive a private Midnight identity), then
				generate and submit a real proof. Not instant — see the button for progress.
			</p>
		{/if}
	</div>
</div>
