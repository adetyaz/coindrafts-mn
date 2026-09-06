<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from '$lib/toast';

	type Question = {
		id: string;
		question: string;
		options: Array<{ label: string; value: string }>;
		sector: string | null;
		xpReward: number;
		boostSector: string | null;
		category?: 'market' | 'vocab';
		term?: string | null;
		alreadyAnswered: boolean;
		previousAnswer: string | null;
		wasCorrect: boolean | null;
	};

	let question = $state<Question | null>(null);
	let selected = $state('');
	let loading = $state(true);
	let submitting = $state(false);
	let result = $state<{
		correct: boolean;
		xpEarned: number;
		boostSector: string | null;
		correctAnswer: string;
	} | null>(null);

	onMount(loadQuestion);

	async function loadQuestion() {
		loading = true;
		try {
			const res = await fetch('/api/gauntlet/today');
			if (res.ok) {
				question = await res.json();
			} else {
				question = null;
			}
		} catch {
			question = null;
		} finally {
			loading = false;
		}
	}

	async function submitAnswer() {
		if (!question || !selected) return;
		submitting = true;
		try {
			const res = await fetch('/api/gauntlet/answer', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ questionId: question.id, answer: selected })
			});
			const data = await res.json();
			if (res.ok) {
				result = data;
				if (data.correct) {
					toast(`+${data.xpEarned} XP! Boost unlocked!`, 'success');
				} else {
					toast('Not quite — come back tomorrow!', 'error');
				}
			} else {
				toast(data.error || 'Failed to submit', 'error');
			}
		} catch {
			toast('Submit failed', 'error');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="rounded-[20px] border border-border bg-surface p-[22px]">
	<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">Daily gauntlet</div>

	{#if loading}
		<div class="h-24 animate-pulse rounded-2xl bg-surface-alt"></div>
	{:else if !question}
		<p class="text-sm text-text-muted">No challenge available today. Check back tomorrow!</p>
	{:else if result}
		<div
			class="rounded-2xl p-4"
			style={result.correct ? 'background:rgba(104,194,168,0.12)' : 'background:rgba(232,112,112,0.1)'}
		>
			<p
				class="mb-1 text-sm font-extrabold"
				style="color:{result.correct ? 'var(--color-mint-ink)' : 'var(--color-red-ink)'}"
			>
				{result.correct ? 'Correct!' : 'Not quite!'}
			</p>
			<p class="text-xs text-text-muted">
				{result.correct
					? `+${result.xpEarned} XP earned${result.boostSector ? ` · ${result.boostSector.toUpperCase()} boost unlocked` : ''}`
					: `The correct answer was: ${result.correctAnswer}`}
			</p>
		</div>
	{:else if question.alreadyAnswered}
		<div class="rounded-2xl bg-surface-alt p-4">
			<p class="text-sm text-text-muted">
				You already answered today{question.wasCorrect ? ' — and got it right!' : ''}
			</p>
		</div>
	{:else}
		{#if question.category === 'vocab' && question.term}
			<div class="mb-3.5 rounded-2xl bg-surface-alt p-4">
				<p class="mb-1 font-mono text-sm font-extrabold text-primary-ink">{question.term}</p>
			</div>
		{/if}
		<p class="mb-4 text-[15px] leading-snug font-bold">{question.question}</p>
		<div class="flex flex-col gap-2">
			{#each question.options as opt (opt.value)}
				<button
					type="button"
					onclick={() => (selected = opt.value)}
					class="cursor-pointer rounded-xl border px-4 py-3 text-left text-sm font-bold transition-colors"
					style={selected === opt.value
						? 'border-color:var(--color-primary);background:var(--color-primary-muted);color:var(--color-primary-ink)'
						: 'border-color:var(--color-border);background:var(--color-surface);color:var(--color-text)'}
				>
					{opt.label}
				</button>
			{/each}
		</div>
		<button
			onclick={submitAnswer}
			disabled={!selected || submitting}
			class="mt-3.5 w-full rounded-full py-3 text-sm font-extrabold transition-colors {selected && !submitting
				? 'cursor-pointer bg-primary text-text hover:bg-primary-hover'
				: 'cursor-not-allowed bg-surface-alt text-text-muted'}"
		>
			{submitting ? 'Submitting…' : 'Submit answer'}
		</button>
		<div class="mt-3.5 font-mono text-xs font-bold text-primary-ink">+{question.xpReward} XP</div>
	{/if}
</div>
