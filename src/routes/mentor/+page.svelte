<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { toast } from '$lib/toast';
	import Toast from '$lib/components/Toast.svelte';

	type Role = 'user' | 'assistant';
	type Message = { role: Role; content: string };
	type Token = { currency_id: string; symbol?: string; name?: string };

	let messages = $state<Message[]>([]);
	let input = $state('');
	let streaming = $state(false);
	let error = $state('');
	let tokens = $state<Token[]>([]);
	let scrollEl: HTMLDivElement | null = null;

	const SUGGESTIONS = [
		'Should I pick ETH or SOL right now?',
		"What's the strongest sector today?",
		'Explain what a good Wildcard pick looks like',
		'What does 24h volume tell me about a token?'
	];

	onMount(async () => {
		try {
			const res = await fetch('/api/tokens');
			if (res.ok) tokens = await res.json();
		} catch {
			/* token-linking is a nice-to-have; chat still works without it */
		}
	});

	const tokenBySymbol = $derived.by(() => {
		const map = new Map<string, Token>();
		for (const t of tokens) {
			if (t.symbol) map.set(t.symbol.toUpperCase(), t);
		}
		return map;
	});

	function extractMentionedTokens(text: string): Token[] {
		const found = new Map<string, Token>();
		const words = text.match(/\b[A-Z]{2,10}\b/g) ?? [];
		for (const w of words) {
			const t = tokenBySymbol.get(w);
			if (t && !found.has(t.currency_id)) found.set(t.currency_id, t);
		}
		return [...found.values()];
	}

	async function scrollToBottom() {
		await tick();
		scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
	}

	async function send(question?: string) {
		const text = (question ?? input).trim();
		if (!text || streaming) return;

		error = '';
		input = '';
		messages = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
		streaming = true;
		scrollToBottom();

		try {
			const res = await fetch('/api/mentor', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: messages.slice(0, -1) })
			});

			if (!res.ok || !res.body) {
				if (res.status === 401) {
					window.location.href = '/?auth=required';
					return;
				}
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload?.error ?? 'Mentor is unavailable right now');
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let acc = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				acc += decoder.decode(value, { stream: true });
				messages[messages.length - 1] = { role: 'assistant', content: acc };
				scrollToBottom();
			}
			if (!acc.trim()) {
				messages[messages.length - 1] = {
					role: 'assistant',
					content: "Sorry, I didn't get a response that time — try asking again."
				};
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Mentor is unavailable right now';
			messages = messages.slice(0, -1);
			toast(error, 'error');
		} finally {
			streaming = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="mx-auto flex h-[calc(100vh-92px)] max-w-[1100px] flex-col px-7 pt-7 pb-7">
	<div class="mb-4.5 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">AI Mentor</h1>
			<p class="mt-2 text-sm text-text-muted">Ask about sectors, tokens, or your last contest</p>
		</div>
		<span class="font-mono text-xs text-text-muted"
			>{messages.filter((m) => m.role === 'user').length} messages this session</span
		>
	</div>

	<div
		bind:this={scrollEl}
		class="frost-panel flex flex-1 flex-col gap-4.5 overflow-y-auto rounded-[24px] p-6.5"
	>
		{#if messages.length === 0}
			<div class="flex h-full flex-col items-center justify-center gap-5 text-center">
				<p class="text-sm text-text-muted">
					Ask about a token, a sector, or how to build your lineup.
				</p>
				<div class="flex flex-wrap justify-center gap-2">
					{#each SUGGESTIONS as s (s)}
						<button
							class="cursor-pointer rounded-full px-3.5 py-2 text-xs font-bold transition hover:-translate-y-0.5"
							style="background:var(--color-primary-muted);border:1px solid var(--color-primary);color:var(--color-primary-ink)"
							onclick={() => send(s)}
						>
							{s}
						</button>
					{/each}
				</div>
			</div>
		{:else}
			{#each messages as msg, i (i)}
				{#if msg.role === 'user'}
					<div class="flex justify-end">
						<div
							class="max-w-[70%] rounded-[18px_18px_4px_18px] bg-primary px-4.5 py-3.5 text-sm leading-relaxed font-medium whitespace-pre-wrap text-text"
						>
							{msg.content}
						</div>
					</div>
				{:else}
					<div class="flex gap-3">
						<div class="h-8 w-8 shrink-0 rounded-[9px] border border-border bg-surface-alt"></div>
						<div class="max-w-[76%]">
							<div
								class="rounded-[18px_18px_18px_4px] border border-border bg-surface px-4.5 py-4 text-sm leading-relaxed whitespace-pre-wrap text-text-body"
							>
								{#if msg.content === '' && streaming && i === messages.length - 1}
									<span class="inline-flex items-center gap-1.5 py-1">
										<span class="anim-bounce h-[7px] w-[7px] rounded-full bg-primary"></span>
										<span
											class="anim-bounce h-[7px] w-[7px] rounded-full bg-primary"
											style="animation-delay:0.16s"
										></span>
										<span
											class="anim-bounce h-[7px] w-[7px] rounded-full bg-primary"
											style="animation-delay:0.32s"
										></span>
									</span>
								{:else}
									{msg.content}
								{/if}
							</div>
							{#if msg.content && (i < messages.length - 1 || !streaming)}
								{@const mentioned = extractMentionedTokens(msg.content)}
								{#if mentioned.length > 0}
									<div class="mt-3 flex flex-wrap gap-2">
										{#each mentioned as t (t.currency_id)}
											<a
												href={`/draft?highlight=${t.currency_id}`}
												class="rounded-full px-3.5 py-1.5 text-xs font-bold no-underline transition hover:-translate-y-0.5"
												style="background:rgba(95,168,216,0.12);border:1px solid var(--color-blue);color:var(--color-blue-ink)"
											>
												{(t.symbol ?? '').toUpperCase()}
											</a>
										{/each}
										<a
											href="/draft"
											class="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-text no-underline transition hover:-translate-y-0.5"
											>Open in draft</a
										>
									</div>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		{/if}
	</div>

	<div
		class="mt-3.5 flex items-center gap-2.5 rounded-full border border-border bg-surface p-2 pl-5"
	>
		<input
			bind:value={input}
			onkeydown={handleKeydown}
			disabled={streaming}
			placeholder="Ask the mentor…"
			class="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
		/>
		<button
			onclick={() => send()}
			disabled={streaming || !input.trim()}
			class="cursor-pointer rounded-full bg-primary px-6.5 py-3 text-sm font-extrabold text-text transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
		>
			Send
		</button>
	</div>
</div>

<Toast />
