<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { appKit } from '$lib/appkit';
	import { sectorTheme } from '$lib/sectorTheme';
	import { classifySector } from '$lib/sectors';
	import { resolve } from '$app/paths';

	const appkitReady = Boolean(appKit);

	type Token = { symbol?: string; name?: string; price?: number; change24h?: number };

	let stats = $state<{ players: number; liveContests: number } | null>(null);
	let tokens = $state<Token[]>([]);

	// Everything on this page that reads as a fact is fetched. When a fetch
	// fails the figure renders as an em-dash — an unavailable number must never
	// fall back to an invented one, which is exactly what this page used to do.
	onMount(async () => {
		const [statsRes, tokensRes] = await Promise.allSettled([
			fetch('/api/stats'),
			fetch('/api/tokens')
		]);
		if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
			stats = await statsRes.value.json();
		}
		if (tokensRes.status === 'fulfilled' && tokensRes.value.ok) {
			tokens = await tokensRes.value.json();
		}
	});

	const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());

	// The hero mockup is a labelled product illustration inside a browser frame,
	// not a claim about a real contest — but it costs nothing to drive it from
	// live prices, so the movements shown are real when the feed is up.
	const heroSlots = $derived.by(() => {
		const bySector: Record<string, Token[]> = {};
		for (const t of tokens) {
			if (!t.symbol) continue;
			const s = classifySector([t.symbol]);
			(bySector[s] ??= []).push(t);
		}
		return ['l1', 'l2', 'defi']
			.map((sector) => {
				const pick = bySector[sector]?.[0];
				return {
					sector,
					ticker: pick?.symbol?.toUpperCase() ?? '',
					change:
						pick?.change24h != null
							? `${pick.change24h >= 0 ? '+' : ''}${pick.change24h.toFixed(1)}%`
							: '',
					filled: Boolean(pick)
				};
			})
			.concat([
				{ sector: 'meme', ticker: '', change: '', filled: false },
				{ sector: 'wildcard', ticker: '', change: '', filled: false }
			]);
	});

	const STEPS = [
		{
			num: '01',
			title: 'Draft five',
			desc: 'One token per sector. Picks are locked for the full window — no swaps once the clock starts.'
		},
		{
			num: '02',
			title: 'Get matched',
			desc: 'Paired with a player inside your rating band, or bring your own crowd into a private league.'
		},
		{
			num: '03',
			title: 'Score for 24h',
			desc: 'Each sector is scored on relative return. Win the sector, take the points, climb the ladder.'
		}
	];

	// Blurbs are editorial description of how each sector plays — they make no
	// numeric claim, so they stay. Token lists and counts are now live.
	const SECTOR_PAGES = [
		{
			id: 'l1',
			blurb:
				'Base-layer chains. The slowest sector on the board and the hardest to fake — conviction usually beats reaction here.'
		},
		{
			id: 'l2',
			blurb:
				'Rollups trade on fee news and little else. A timing sector: the right pick on the wrong day still loses.'
		},
		{
			id: 'defi',
			blurb:
				'Governance tokens follow deposits with a lag. The sector that rewards reading flows before they show up in price.'
		},
		{
			id: 'meme',
			blurb:
				'Highest variance on the board. One slot holds all the noise, which is exactly why it decides close contests.'
		},
		{
			id: 'wildcard',
			blurb:
				'Everything that fits nowhere else — infra, compute, oracles. Thin liquidity, sharp moves, frequent upsets.'
		}
	];

	let activeSector = $state(0);
	const curSector = $derived(SECTOR_PAGES[activeSector]);
	const curTheme = $derived(sectorTheme(curSector.id));

	const priceFmt = (p: number | undefined) => {
		if (p == null) return '—';
		if (p >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
		if (p >= 1) return `$${p.toFixed(2)}`;
		if (p >= 0.01) return `$${p.toFixed(3)}`;
		return `$${p.toPrecision(2)}`;
	};

	const sectorTokens = $derived(
		tokens.filter((t) => t.symbol && classifySector([t.symbol]) === curSector.id)
	);
	const curSectorSwing = $derived.by(() => {
		const moves = sectorTokens.map((t) => Math.abs(t.change24h ?? 0)).filter((m) => m > 0);
		if (moves.length === 0) return '—';
		return `${(moves.reduce((a, b) => a + b, 0) / moves.length).toFixed(1)}%`;
	});

	const FOOTER_COLS = [
		{
			title: 'Product',
			links: [
				{ label: 'Draft', href: '/draft' },
				{ label: 'Dashboard', href: '/dashboard' },
				{ label: 'Leagues', href: '/leagues' },
				{ label: 'Knowledge Base', href: '/research' }
			]
		},
		{
			title: 'Compete',
			links: [
				{ label: 'Leaderboard', href: '/leaderboard' },
				{ label: 'Tournaments', href: '/tournament' },
				{ label: 'Find a match', href: '/matchmaking' },
				{ label: 'AI Mentor', href: '/mentor' }
			]
		},
		{
			title: 'Learn',
			links: [
				{ label: 'How to play', href: '/guide' },
				{ label: 'Documentation', href: '/docs' }
			]
		}
	];
</script>

<div>
	<section class="dot-grid relative overflow-hidden bg-bg px-6 pt-16 pb-10 max-md:pt-10">
		<div
			class="pointer-events-none absolute top-[-260px] left-1/2 h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-primary opacity-20 blur-3xl"
		></div>

		<div class="relative mx-auto flex max-w-6xl flex-wrap items-center gap-12">
			<div class="min-w-0 flex-[1_1_420px]">
				<div
					class="mb-6.5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 font-mono text-[11px] font-bold tracking-[0.1em] text-text-muted uppercase"
				>
					<span class="anim-blink h-1.5 w-1.5 rounded-full bg-positive"></span>
					{stats ? `${fmt(stats.liveContests)} contests live` : 'Live market drafting'}
				</div>

				<h1
					class="text-[72px] leading-[0.9] font-black tracking-[-0.05em] max-lg:text-[52px] max-md:text-[38px]"
				>
					Draft coins.
				</h1>
				<h1
					class="text-[72px] leading-[0.9] font-black tracking-[-0.05em] text-primary-ink max-lg:text-[52px] max-md:text-[38px]"
				>
					Beat people.
				</h1>
				<p class="mt-6.5 text-lg leading-relaxed text-text-muted max-md:text-base">
					One token per sector, five sectors, twenty-four hours. No leverage, no liquidations — your
					read against theirs, scored on relative return.
				</p>

				<div class="mt-8 flex flex-wrap items-center gap-3">
					{#if page.data.user}
						<a
							href={resolve('/dashboard')}
							class="inline-flex h-13 cursor-pointer items-center gap-2 rounded-full bg-primary px-8 text-sm font-extrabold text-text no-underline shadow-[0_14px_44px_rgba(247,142,121,0.34)] transition hover:-translate-y-0.5 hover:bg-primary-hover"
						>
							Go to dashboard &rarr;
						</a>
					{:else if appkitReady}
						<div class="*:h-13 *:rounded-full *:px-8">
							<appkit-button></appkit-button>
						</div>
						<a
							href={resolve('/dashboard')}
							class="inline-flex h-13 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-8 text-sm font-bold text-text-muted no-underline transition hover:border-primary"
						>
							Watch a live contest
						</a>
					{:else}
						<button
							class="inline-flex h-13 cursor-not-allowed items-center rounded-full bg-primary/50 px-8 text-sm font-extrabold text-text/50"
							disabled>Loading wallet…</button
						>
					{/if}
				</div>

				{#if page.url.searchParams.get('auth') === 'required'}
					<p class="mt-4 text-xs text-negative-ink">
						Sign in with your wallet to access draft and contest routes.
					</p>
				{/if}

				{#if stats && stats.players > 0}
					<div class="mt-8.5 flex items-center gap-3.5">
						<div class="flex">
							<div class="h-7.5 w-7.5 rounded-full border-2 border-bg bg-surface-alt"></div>
							<div class="-ml-2.5 h-7.5 w-7.5 rounded-full border-2 border-bg bg-border"></div>
							<div class="-ml-2.5 h-7.5 w-7.5 rounded-full border-2 border-bg bg-border"></div>
							<div class="-ml-2.5 h-7.5 w-7.5 rounded-full border-2 border-bg bg-primary"></div>
						</div>
						<span class="text-[13px] text-text-muted">
							{fmt(stats.players)}
							{stats.players === 1 ? 'player has' : 'players have'} joined
						</span>
					</div>
				{/if}
			</div>

			<div class="relative min-w-0 flex-[1_1_400px]">
				<div
					class="anim-float relative overflow-hidden rounded-3xl border border-border bg-surface-alt shadow-[0_40px_90px_rgba(26,36,33,0.18)]"
				>
					<div class="flex items-center gap-1.5 border-b border-border px-4 py-3.5">
						<div class="h-2.5 w-2.5 rounded-full bg-border"></div>
						<div class="h-2.5 w-2.5 rounded-full bg-border"></div>
						<div class="h-2.5 w-2.5 rounded-full bg-border"></div>
						<span class="ml-2.5 font-mono text-[10px] text-text-muted">coindraft.app/draft</span>
					</div>
					<div class="p-5.5">
						<div
							class="mb-4 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase"
						>
							Your lineup &middot; locks in 00:42
						</div>
						<div class="flex flex-col gap-2.5">
							{#each heroSlots as slot (slot.sector)}
								{@const theme = sectorTheme(slot.sector)}
								<div
									class="flex items-center gap-3 rounded-2xl p-3.5"
									style={slot.filled
										? `background:var(--color-surface);border:1px solid ${theme.color}66`
										: 'background:var(--color-surface);border:1px dashed var(--color-border)'}
								>
									<div
										class="grid h-8.5 w-8.5 shrink-0 place-items-center rounded-full text-sm font-black"
										style={slot.filled
											? `background:${theme.color};color:var(--color-ink);box-shadow:0 0 20px ${theme.color}55`
											: 'border:1px dashed var(--color-border-strong);color:var(--color-text-muted)'}
									>
										{slot.filled ? slot.ticker.charAt(0) : '+'}
									</div>
									<div class="min-w-0 flex-1">
										<div
											class="text-[15px] font-extrabold"
											style={slot.filled ? '' : 'color:var(--color-text-muted)'}
										>
											{slot.filled ? slot.ticker : 'Empty'}
										</div>
										<div
											class="text-[10px] font-extrabold tracking-[0.1em] uppercase"
											style="color:{theme.ink}"
										>
											{theme.label}
										</div>
									</div>
									{#if slot.filled}
										<span
											class="font-mono text-xs"
											style="color:{slot.change.startsWith('-')
												? 'var(--color-red-ink)'
												: 'var(--color-mint-ink)'}">{slot.change}</span
										>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</div>
				<div
					class="anim-float2 absolute -right-1.5 bottom-1.5 rounded-2xl bg-primary p-5 text-text shadow-[0_24px_60px_rgba(247,142,121,0.4)]"
				>
					<div class="text-[10px] font-extrabold tracking-[0.12em] opacity-75">Example result</div>
					<div class="text-[28px] leading-tight font-black tracking-[-0.03em]">You won</div>
					<div class="font-mono text-[13px] font-bold">742 / 689 &middot; +140 XP</div>
				</div>
			</div>
		</div>

		{#if tokens.length > 0}
			<div class="relative mt-16 overflow-hidden border-y border-border py-4">
				<div class="anim-marquee flex w-max gap-10">
					{#each [...tokens.slice(0, 12), ...tokens.slice(0, 12)] as t, i (i)}
						<span class="font-mono text-xs whitespace-nowrap text-text-muted">
							{t.symbol?.toUpperCase()}
							<span
								style="color:{(t.change24h ?? 0) >= 0
									? 'var(--color-mint-ink)'
									: 'var(--color-red-ink)'}"
							>
								{(t.change24h ?? 0) >= 0 ? '+' : ''}{(t.change24h ?? 0).toFixed(1)}%
							</span>
						</span>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<section class="bg-bg px-6 py-20 max-md:py-14">
		<div class="mx-auto max-w-5xl">
			<div class="mb-10 flex flex-wrap items-end justify-between gap-6">
				<div>
					<p
						class="mb-3.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase"
					>
						01 &mdash; The format
					</p>
					<h2 class=" text-[46px] leading-[0.95] font-black tracking-[-0.045em] max-md:text-[30px]">
						Three minutes to enter. A day to find out.
					</h2>
				</div>
				<p class="text-[15px] leading-relaxed text-text-muted">
					Contests settle on relative sector return, so a flat market still produces a winner.
				</p>
			</div>

			<div class="grid grid-cols-3 gap-0 border-t border-border max-md:grid-cols-1">
				{#each STEPS as step (step.num)}
					<div class="border-r border-border py-8.5 pr-7 last:border-r-0">
						<div class="mb-6.5 font-mono text-sm font-bold text-primary-ink">{step.num}</div>
						<h3 class="mb-3 text-2xl font-extrabold tracking-[-0.03em]">{step.title}</h3>
						<p class="text-sm leading-relaxed text-text-muted">{step.desc}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<section class="bg-bg px-6 py-20 max-md:py-14">
		<div class="mx-auto max-w-5xl">
			<p
				class="mb-3.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase"
			>
				02 &mdash; The board
			</p>
			<h2 class="mb-7 text-[46px] leading-[0.95] font-black tracking-[-0.045em] max-md:text-[30px]">
				Five sectors. Five very different games.
			</h2>

			<div class="mb-5.5 flex flex-wrap gap-2.5">
				{#each SECTOR_PAGES as s, i (s.id)}
					{@const theme = sectorTheme(s.id)}
					<button
						type="button"
						onclick={() => (activeSector = i)}
						class="cursor-pointer rounded-full px-5.5 py-2.5 text-[13px] font-extrabold whitespace-nowrap transition-all"
						style={i === activeSector
							? `background:${theme.color};color:var(--color-ink)`
							: 'background:var(--color-surface-alt);color:var(--color-text-muted)'}
					>
						{theme.label}
					</button>
				{/each}
			</div>

			<div
				class="rounded-[24px] p-11 transition-colors max-md:p-6"
				style="background:{curTheme.color};color:var(--color-ink)"
			>
				<div class="flex flex-wrap items-center gap-10">
					<div class="min-w-0 flex-[1_1_300px]">
						<div class="mb-3.5 text-4xl leading-tight font-black tracking-[-0.04em]">
							{curTheme.label}
						</div>
						<p class="text-[15px] leading-relaxed opacity-75">{curSector.blurb}</p>
						<div class="mt-7 flex gap-6.5">
							<div>
								<div class="font-mono text-[26px] font-bold">{sectorTokens.length || '—'}</div>
								<div class="text-[10px] font-extrabold tracking-[0.1em] uppercase opacity-60">
									Tokens
								</div>
							</div>
							<div>
								<div class="font-mono text-[26px] font-bold">{curSectorSwing}</div>
								<div class="text-[10px] font-extrabold tracking-[0.1em] uppercase opacity-60">
									Avg 24h move
								</div>
							</div>
						</div>
					</div>
					<div
						class="grid min-w-0 flex-[1_1_340px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5"
					>
						{#if sectorTokens.length === 0}
							<p class="text-[13px] opacity-70">Live prices unavailable right now.</p>
						{:else}
							{#each sectorTokens.slice(0, 4) as t (t.symbol)}
								<div class="flex items-center justify-between gap-2.5 rounded-2xl bg-black/5 p-4">
									<span class="text-base font-black tracking-[-0.02em]"
										>{t.symbol?.toUpperCase()}</span
									>
									<span class="font-mono text-xs opacity-70">{priceFmt(t.price)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="bg-bg px-6 py-20 max-md:py-14">
		<div class="mx-auto max-w-5xl">
			<div
				class="grid grid-cols-4 gap-0 overflow-hidden rounded-[20px] border border-border max-sm:grid-cols-2"
			>
				<div class="border-r border-border bg-surface p-6.5 max-sm:[&:nth-child(2)]:border-r-0">
					<div class="font-mono text-[34px] font-bold tracking-[-0.03em]">
						{stats ? fmt(stats.players) : '—'}
					</div>
					<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
						Players
					</div>
				</div>
				<div class="border-r border-border bg-surface p-6.5 max-sm:[&:nth-child(2)]:border-r-0">
					<div class="font-mono text-[34px] font-bold tracking-[-0.03em]">
						{stats ? fmt(stats.liveContests) : '—'}
					</div>
					<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
						Live contests
					</div>
				</div>
				<div class="border-r border-border bg-surface p-6.5">
					<div class="font-mono text-[34px] font-bold tracking-[-0.03em]">5</div>
					<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
						Sectors per lineup
					</div>
				</div>
				<div class="bg-surface p-6.5">
					<div class="font-mono text-[34px] font-bold tracking-[-0.03em]">24H</div>
					<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">
						Contest length
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="bg-surface px-6 py-20 text-center max-md:py-14">
		<div class="mx-auto max-w-2xl">
			<h2 class="mb-3 text-[38px] font-black tracking-[-0.03em] max-md:text-[28px]">
				Ready to draft?
			</h2>
			<p class="mb-8 text-[15px] text-text-muted">
				Free to play. Your first contest takes about two minutes.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<a
					href={resolve('/dashboard')}
					class="inline-flex h-13 items-center rounded-full bg-primary px-8 text-sm font-extrabold text-text no-underline transition hover:-translate-y-0.5 hover:bg-primary-hover"
					>Start drafting</a
				>
				<a
					href={resolve('/leaderboard')}
					class="inline-flex h-13 items-center rounded-full border border-border bg-transparent px-8 text-sm font-bold text-text-muted no-underline transition hover:bg-hover"
					>View leaderboard</a
				>
			</div>
		</div>
	</section>

	<footer class="bg-bg px-6 pt-16 pb-8">
		<div class="mx-auto max-w-5xl">
			<div class="flex flex-wrap gap-8 border-b border-border pb-9">
				<div class="min-w-0 flex-[1_1_280px]">
					<div class="mb-3.5 flex items-center gap-2.5">
						<span class="relative h-6 w-6 shrink-0">
							<span class="absolute inset-0 rounded-md bg-primary" style="transform:rotate(45deg)"
							></span>
							<span
								class="absolute top-2 left-2 h-2 w-2 rounded-[2px] bg-text"
								style="transform:rotate(45deg)"
							></span>
						</span>
						<span class="text-lg font-black tracking-[-0.03em]">CoinDraft</span>
					</div>
					<p class="text-[13px] text-text-muted">
						Fantasy drafting for crypto markets. Play money, real reads.
					</p>
				</div>
				{#each FOOTER_COLS as col (col.title)}
					<div class="min-w-0 flex-[1_1_140px]">
						<div
							class="mb-3.5 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase"
						>
							{col.title}
						</div>
						<div class="flex flex-col gap-2.5">
							{#each col.links as link (link.href)}
								<a
									href={resolve(link.href)}
									class="text-[13px] text-text-muted no-underline transition hover:text-primary-ink"
									>{link.label}</a
								>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<div class="flex flex-wrap justify-between gap-3 pt-6">
				<span class="font-mono text-[11px] text-text-muted"
					>&copy; 2026 COINDRAFT &middot; NOT INVESTMENT ADVICE</span
				>
				<a
					href={resolve('/guide')}
					class="font-mono text-[11px] text-text-muted no-underline hover:text-primary-ink"
					>HOW IT WORKS &rarr;</a
				>
			</div>
		</div>
	</footer>
</div>
