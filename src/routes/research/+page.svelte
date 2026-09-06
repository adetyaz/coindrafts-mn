<script lang="ts">
	import { onMount } from 'svelte';
	import { SECTORS } from '$lib/constants';
	import { sectorTheme } from '$lib/sectorTheme';
	import { toast } from '$lib/toast';
	import Toast from '$lib/components/Toast.svelte';
	import TermOfDay from '$lib/components/TermOfDay.svelte';

	type NewsCategory = 'regulation' | 'security' | 'defi' | 'nfts' | 'markets' | 'business' | 'general';

	type Article = {
		id: string;
		title: string;
		content: string;
		source: string;
		date: string | null;
		url: string | null;
		symbols: string[];
		category: NewsCategory;
		// Draft-sector mapping — used only to award the right sector boost when
		// an article is read, never shown to the reader as a filter/label.
		sector: string;
	};

	// Industry-standard news topics, matching how real crypto news sites
	// categorize (CoinDesk, The Block, Decrypt) — not this app's own
	// L1/L2/DeFi/Meme/Wildcard draft-sector taxonomy, which was being reused
	// here and didn't mean anything as a news filter.
	const CATEGORY_META: Record<NewsCategory, { label: string; color: string; ink: string }> = {
		markets: { label: 'Markets', color: 'var(--color-mint)', ink: 'var(--color-mint-ink)' },
		defi: { label: 'DeFi', color: 'var(--color-blue)', ink: 'var(--color-blue-ink)' },
		regulation: { label: 'Regulation', color: 'var(--color-red)', ink: 'var(--color-red-ink)' },
		security: { label: 'Security', color: 'var(--color-amber)', ink: 'var(--color-amber-ink)' },
		nfts: { label: 'NFTs', color: 'var(--color-coral)', ink: 'var(--color-coral-ink)' },
		business: { label: 'Business', color: 'var(--color-sky)', ink: 'var(--color-blue-ink)' },
		general: { label: 'General', color: 'var(--color-border-strong)', ink: 'var(--color-text-muted)' }
	};

	type ActiveBoost = { sector: string; expiresAt: string };

	let articles = $state<Article[]>([]);
	let loading = $state(true);
	let activeFilter = $state('all');
	let expandedId = $state('');
	let boostClaimedToday = $state(false);
	let claiming = $state(false);
	let activeBoosts = $state<ActiveBoost[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/api/news');
			if (res.ok) {
				const data = await res.json();
				articles = Array.isArray(data) ? data : [];
			}
		} catch {
			/* leave articles empty, UI shows the empty state */
		} finally {
			loading = false;
		}
		try {
			const meRes = await fetch('/api/me');
			if (meRes.ok) {
				const me = await meRes.json();
				const now = new Date().toISOString();
				activeBoosts = (me.activeBoosts ?? []).filter((b: ActiveBoost) => b.expiresAt > now);
			}
		} catch {
			/* boosts sidebar is a nice-to-have */
		}
	});

	function hoursLeft(expiresAt: string): string {
		const ms = new Date(expiresAt).getTime() - Date.now();
		const h = Math.max(0, Math.round(ms / 3_600_000));
		return h <= 1 ? '<1h left' : `${h}h left`;
	}

	const filtered = $derived(
		activeFilter === 'all' ? articles : articles.filter((a) => a.category === activeFilter)
	);

	// The feed isn't evenly spread across topics day to day. A filter tab for
	// a category with zero loaded articles is a dead end (click it, see
	// nothing, every time), so only categories actually present get a tab.
	const availableCategories = $derived(
		(Object.keys(CATEGORY_META) as NewsCategory[]).filter((c) => articles.some((a) => a.category === c))
	);

	// Game-sector display name — used only for the boost-award toast and the
	// "Boosts ready" sidebar, both of which are about draft sectors, not the
	// news categories above.
	function sectorName(id: string): string {
		return SECTORS.find((s) => s.id === id)?.name ?? 'Wildcard';
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	async function expand(article: Article) {
		const wasExpanded = expandedId === article.id;
		expandedId = wasExpanded ? '' : article.id;
		if (wasExpanded || boostClaimedToday || claiming) return;

		claiming = true;
		try {
			const res = await fetch('/api/research/read', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ articleId: article.id, sector: article.sector })
			});
			if (res.status === 401) {
				window.location.href = '/?auth=required';
				return;
			}
			const data = await res.json();
			if (data.awarded) {
				boostClaimedToday = true;
				toast(`+${data.xp} XP · ${sectorName(data.sector)} boost active for 24h`, 'success');
				activeBoosts = [
					...activeBoosts.filter((b) => b.sector !== data.sector),
					{ sector: data.sector, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString() }
				];
			} else {
				boostClaimedToday = true;
			}
		} catch {
			/* boost claiming is a bonus, not critical — fail silently */
		} finally {
			claiming = false;
		}
	}
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<div class="mb-4.5 flex flex-wrap items-end justify-between gap-6">
		<div>
			<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">Knowledge Base</h1>
			<p class="mt-2 text-sm text-text-muted">
				News, filtered the way real crypto news sites do — read one, claim the boost, take it into the draft
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<button
				class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition"
				style={activeFilter === 'all'
					? 'background:var(--color-primary);border:1px solid var(--color-primary);color:var(--color-ink)'
					: 'background:var(--color-surface);border:1px solid var(--color-border);color:var(--color-text-muted)'}
				onclick={() => (activeFilter = 'all')}>All</button
			>
			{#each availableCategories as c (c)}
				<button
					class="cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition"
					style={activeFilter === c
						? `background:${CATEGORY_META[c].color};border:1px solid ${CATEGORY_META[c].color};color:var(--color-ink)`
						: 'background:var(--color-surface);border:1px solid var(--color-border);color:var(--color-text-muted)'}
					onclick={() => (activeFilter = c)}>{CATEGORY_META[c].label}</button
				>
			{/each}
		</div>
	</div>

	<div class="mb-3 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">News</div>

	<div class="flex flex-wrap gap-4.5">
		<div class="min-w-0 flex-[1_1_520px]">
			{#if loading}
				<p class="py-10 text-center text-sm text-text-muted">Loading research feed…</p>
			{:else if filtered.length === 0}
				<p class="py-10 text-center text-sm text-text-muted">No articles available right now.</p>
			{:else}
				<div class="flex flex-col gap-3.5">
					{#each filtered as article (article.id)}
						{@const cat = CATEGORY_META[article.category]}
						{@const isOpen = expandedId === article.id}
						<div class="rounded-[20px] border border-border bg-surface p-6">
							<button
								type="button"
								class="flex w-full cursor-pointer items-start justify-between gap-4 text-left"
								onclick={() => expand(article)}
							>
								<div class="min-w-0 flex-1">
									<div class="mb-2.5 flex flex-wrap items-center gap-2.5">
										<span
											class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase"
											style="background:{cat.color}24;border:1px solid {cat.color};color:{cat.ink}"
											>{cat.label}</span
										>
										<span class="font-mono text-[11px] text-text-muted"
											>{article.source}{article.date ? ` · ${fmtDate(article.date)}` : ''}</span
										>
									</div>
									<p class="text-lg leading-snug font-extrabold tracking-[-0.01em]">{article.title}</p>
								</div>
								<svg
									class="mt-1.5 h-4 w-4 shrink-0 text-text-muted transition-transform {isOpen
										? 'rotate-180'
										: ''}"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</button>
							{#if isOpen}
								<div class="mt-4 border-t border-border pt-4">
									<p class="text-sm leading-[1.7] whitespace-pre-line text-text-body">{article.content}</p>
									{#if article.url}
										<a
											href={article.url}
											target="_blank"
											rel="noopener noreferrer"
											class="mt-2.5 inline-block text-xs font-bold text-primary-ink hover:underline"
											>Read full source &rarr;</a
										>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
			<TermOfDay />
			<div class="rounded-[20px] border border-border bg-surface p-[22px]">
				<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
					Boosts ready
				</div>
				{#if activeBoosts.length === 0}
					<p class="text-xs text-text-muted">No active boosts — expand an article to claim one.</p>
				{:else}
					<div class="flex flex-col gap-3.5">
						{#each activeBoosts as b (b.sector)}
							{@const theme = sectorTheme(b.sector)}
							<div class="flex items-center justify-between gap-3">
								<div class="flex items-center gap-2.5">
									<div class="h-2.5 w-2.5 rounded-[3px]" style="background:{theme.color}"></div>
									<span class="text-[13px] font-bold">{theme.label} &times;1.25</span>
								</div>
								<span class="font-mono text-xs text-text-muted">{hoursLeft(b.expiresAt)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<a
				href="/draft"
				class="w-full rounded-full bg-primary py-3.5 text-center text-sm font-extrabold text-text no-underline"
				>Take boosts to draft</a
			>
		</div>
	</div>
</div>

<Toast />
