<script lang="ts">
	// Scrimmage is a real mode, so it gets a real page. It used to be reachable
	// only from a dashboard button or after waiting 20s in matchmaking, which
	// made the mode meant for brand-new players the hardest one to find.
	import { DURATION_OPTIONS, DEFAULT_DURATION_MINUTES, durationLabel } from '$lib/constants';
	import Toast from '$lib/components/Toast.svelte';
	import { resolve } from '$app/paths';

	let durationMinutes = $state(DEFAULT_DURATION_MINUTES);
	let starting = $state(false);
	let errorMessage = $state('');

	async function startScrimmage() {
		starting = true;
		errorMessage = '';
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
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload?.error ?? 'Could not start a Scrimmage. Please try again.');
			}
			const contest = await res.json();
			window.location.href = `/draft?contestId=${contest.id}&type=${contest.type}&mode=paper`;
		} catch (error) {
			starting = false;
			errorMessage = (error as Error)?.message ?? 'Could not start a Scrimmage. Please try again.';
		}
	}
</script>

<div class="mx-auto max-w-[720px] px-7 py-14">
	<div class="rounded-[24px] border border-border bg-surface p-11 max-sm:p-6">
		<div class="font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase">
			Scrimmage
		</div>
		<h1 class="mt-3 text-[38px] leading-none font-black tracking-[-0.04em] max-sm:text-[28px]">
			Play a bot, keep your rank
		</h1>
		<p class="mt-3 text-[15px] text-text-muted">
			Draft against a bot opponent and earn Scrimmage XP. Same board, same scoring, same result
			screen — but nothing here touches your real rank, win rate, or badges. No waiting for an
			opponent: the bot drafts a full lineup the moment you lock yours.
		</p>

		<div class="mt-7">
			<div class="mb-3 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
				How long?
			</div>
			<div class="flex flex-wrap gap-2.5">
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
		</div>

		{#if errorMessage}
			<p class="mt-4 text-sm text-negative-ink">{errorMessage}</p>
		{/if}

		<button
			onclick={startScrimmage}
			disabled={starting}
			class="mt-8 h-13 w-full cursor-pointer rounded-full bg-primary text-sm font-extrabold text-text transition hover:bg-primary-hover disabled:opacity-60"
		>
			{starting ? 'Starting…' : `Start Scrimmage · ${durationLabel(durationMinutes)}`}
		</button>

		<p class="mt-4 text-center text-[13px] text-text-muted">
			Want a real opponent instead? <a
				href={resolve('/matchmaking')}
				class="font-bold text-primary-ink">Find a match</a
			>
		</p>
	</div>
</div>

<Toast />
