<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SECTORS } from '$lib/constants';
	import { sectorTheme } from '$lib/sectorTheme';
	import { classifySector } from '$lib/sectors';
	import Toast from '$lib/components/Toast.svelte';
	import DraftAgent from '$lib/components/DraftAgent.svelte';
	import TokenIcon from '$lib/components/TokenIcon.svelte';
	import TokenHover from '$lib/components/TokenHover.svelte';
	import { toast } from '$lib/toast';

	type Token = {
		currency_id: string;
		symbol?: string;
		name?: string;
		price: number | null;
		change24h: number | null;
		volume24h: number | null;
		rank: number | null;
	};

	type SectorInfo = { id: string; name: string; change: number | null };

	type Pick = {
		currencyId: string;
		symbol: string;
		name: string;
		sector: string;
	};

	// ── State ──────────────────────────────────────────────────────────
	let contestId = $state('');
	let lobbyId = $state('');

	// Token hover overlay (G-07). Anchored to the hovered card's rect so the
	// overlay can place itself beside it and flip near the viewport edge.
	let hoverToken = $state<{ currencyId: string; symbol: string } | null>(null);
	let hoverRect = $state<DOMRect | null>(null);
	// Now that the overlay is clickable (Stats/News tabs), leaving the card
	// can't close it immediately — the mouse has to cross the gap to the
	// overlay itself first. Close is delayed and cancellable so hovering
	// either the card OR the overlay keeps it open; it only actually closes
	// once the pointer has left both.
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	function openHover(e: MouseEvent, currencyId: string, symbol: string) {
		if (closeTimer) {
			clearTimeout(closeTimer);
			closeTimer = null;
		}
		hoverRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		hoverToken = { currencyId, symbol };
	}
	function scheduleCloseHover() {
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			hoverToken = null;
			hoverRect = null;
			closeTimer = null;
		}, 150);
	}
	function cancelCloseHover() {
		if (closeTimer) {
			clearTimeout(closeTimer);
			closeTimer = null;
		}
	}
	function closeHover() {
		cancelCloseHover();
		hoverToken = null;
		hoverRect = null;
	}

	// The anchor rect is captured once, so any scroll invalidates it. Dismissing
	// is better than letting the overlay drift away from its card.
	$effect(() => {
		if (!hoverToken) return;
		window.addEventListener('scroll', closeHover, { passive: true, once: true });
		return () => window.removeEventListener('scroll', closeHover);
	});
	let tokens = $state<Token[]>([]);
	let sectorChanges = $state<Map<string, number | null>>(new Map());
	let lineup = $state<Pick[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let submitting = $state(false);
	let activeSector = $state(SECTORS[0].id);
	let search = $state('');
	let timeLeft = $state(45 * 60);
	let timer: ReturnType<typeof setInterval> | null = null;
	let activeBoosts = $state<Map<string, boolean>>(new Map());
	let highlightId = $state('');
	let contestType = $state<'daily' | 'weekly'>('daily');
	let isPaper = $state(false);
	let sectorRestriction = $state<string | null>(null);

	// ── Lifecycle ──────────────────────────────────────────────────────
	onMount(() => {
		const p = new URLSearchParams(window.location.search);
		contestId = p.get('contestId') ?? '';
		lobbyId = p.get('lobbyId') ?? '';
		highlightId = p.get('highlight') ?? '';
		contestType = p.get('type') === 'weekly' ? 'weekly' : 'daily';
		isPaper = p.get('mode') === 'paper';
		loadData();
		timer = setInterval(() => {
			timeLeft = Math.max(0, timeLeft - 1);
		}, 1000);
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	async function loadData() {
		loading = true;
		loadError = '';
		try {
			if (lobbyId) {
				const lRes = await fetch(`/api/lobby/${lobbyId}`);
				if (lRes.ok) {
					const lobbyInfo = await lRes.json();
					sectorRestriction = lobbyInfo.sectorRestriction ?? null;
				}
			}

			const tokensUrl = sectorRestriction ? `/api/tokens?sector=${sectorRestriction}` : '/api/tokens';
			const [tRes, sRes, meRes] = await Promise.all([
				fetch(tokensUrl),
				fetch('/api/sectors'),
				fetch('/api/me')
			]);
			if (!tRes.ok) throw new Error('Failed to load tokens');
			tokens = await tRes.json();
			if (highlightId) {
				const match = tokens.find((t) => t.currency_id === highlightId);
				if (match?.symbol) {
					search = match.symbol;
					// The pool is now sector-filtered by activeSector — without this,
					// a highlighted token outside the default L1 tab would search for
					// nothing found.
					activeSector = tokenSector(match);
					queueMicrotask(() =>
						document.getElementById('token-pool')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
					);
				}
			}
			if (sRes.ok) {
				const secs: SectorInfo[] = await sRes.json();
				sectorChanges = new Map(secs.map((s) => [s.id, s.change]));
			}
			if (meRes.ok) {
				const me = await meRes.json();
				const boosts: Array<{ sector: string; expiresAt: string }> = me.activeBoosts || [];
				const now = new Date().toISOString();
				const validBoosts = boosts.filter((b) => b.expiresAt > now);
				activeBoosts = new Map(validBoosts.map((b) => [b.sector, true]));
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			loading = false;
		}
	}

	// ── Derived ────────────────────────────────────────────────────────
	const tokenMap = $derived(new Map(tokens.map((t) => [t.currency_id, t])));

	function tokenSector(t: { symbol?: string }): string {
		return classifySector([t.symbol ?? '']);
	}

	// Only Wildcard accepts any chain — every other slot only shows/accepts
	// tokens actually classified into that sector.
	const filteredTokens = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const inSector = activeSector === 'wildcard' ? tokens : tokens.filter((t) => tokenSector(t) === activeSector);
		if (!q) return inSector.slice(0, 50);
		return inSector
			.filter((t) => t.symbol?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q))
			.slice(0, 50);
	});

	const slotsFilledCount = $derived(lineup.length);

	const timerStr = $derived.by(() => {
		const m = Math.floor(timeLeft / 60)
			.toString()
			.padStart(2, '0');
		const s = (timeLeft % 60).toString().padStart(2, '0');
		return `${m}:${s}`;
	});

	// Real, derived from the actual lineup + live 24h changes + active boosts —
	// not a fabricated number. Matches the scoring formula on the Guide page:
	// score = Σ(move% × boost) × 100.
	const projectedScore = $derived(
		Math.round(
			lineup.reduce((sum, p) => {
				const t = tokenMap.get(p.currencyId);
				const chg = t?.change24h ?? 0;
				const boosted = activeBoosts.get(p.sector) ? chg * 1.25 : chg;
				return sum + boosted;
			}, 0) * 100
		)
	);

	// ── Helpers ────────────────────────────────────────────────────────
	function pickForSector(id: string): Pick | undefined {
		return lineup.find((p) => p.sector === id);
	}

	function isInLineup(currencyId: string): boolean {
		return lineup.some((p) => p.currencyId === currencyId);
	}

	function selectSector(id: string) {
		activeSector = id;
		document.getElementById('token-pool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function addToken(token: Token) {
		const sym = (token.symbol ?? token.currency_id).toUpperCase();
		if (isInLineup(token.currency_id)) {
			toast(`${sym} is already in your lineup`, 'error');
			return;
		}
		// Belt-and-suspenders: filteredTokens already excludes mismatches, but
		// this guards any other path that could call addToken directly.
		if (activeSector !== 'wildcard' && tokenSector(token) !== activeSector) {
			toast(`${sym} doesn't belong in the ${SECTORS.find((s) => s.id === activeSector)?.name} slot`, 'error');
			return;
		}
		lineup = [
			...lineup.filter((p) => p.sector !== activeSector),
			{
				currencyId: token.currency_id,
				symbol: token.symbol ?? token.currency_id,
				name: token.name ?? '',
				sector: activeSector
			}
		];
		toast(`${sym} added to ${SECTORS.find((s) => s.id === activeSector)?.name} slot`, 'success');
		const next = SECTORS.find((s) => !lineup.some((p) => p.sector === s.id));
		if (next) activeSector = next.id;
	}

	function removePick(sectorId: string) {
		lineup = lineup.filter((p) => p.sector !== sectorId);
		activeSector = sectorId;
	}

	const emptySectors = $derived(SECTORS.filter((s) => !lineup.some((p) => p.sector === s.id)).map((s) => s.id));

	// Applies AI Draft Agent picks the same way a manual click would — normal
	// draft flow (addToken/removePick above) is completely unchanged, this is
	// purely additive.
	function applyAgentPicks(picks: { sector: string; symbol: string; name: string; currencyId: string }[]) {
		for (const p of picks) {
			lineup = [...lineup.filter((x) => x.sector !== p.sector), p];
		}
	}

	function fmtChg(v: number | null): string {
		if (v == null) return '—';
		return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
	}

	function fmtVol(v: number | null): string {
		if (v == null) return '—';
		if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
		if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
		if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
		return '$' + v.toFixed(2);
	}

	function fmtPrice(v: number | null): string {
		if (v == null) return '';
		if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
		if (v >= 1) return '$' + v.toFixed(2);
		return '$' + v.toPrecision(4);
	}

	// ── Submit ─────────────────────────────────────────────────────────
	async function submitLineup() {
		if (lineup.length !== 5) {
			toast('Select all 5 slots first — one per sector', 'error');
			return;
		}
		submitting = true;
		try {
			if (lobbyId) {
				const r2 = await fetch(`/api/lobby/${lobbyId}/lineup`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ picks: lineup })
				});
				if (!r2.ok) {
					const errData = await r2.json().catch(() => ({}));
					throw new Error((errData as { error?: string }).error ?? 'Failed to submit lineup');
				}
				window.location.href = `/lobby/${lobbyId}/result`;
				return;
			}

			if (!contestId) {
				const r = await fetch('/api/contests', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: 'daily' })
				});
				if (!r.ok) throw new Error('Failed to create contest');
				contestId = (await r.json()).id;
			}

			const r2 = await fetch(`/api/contest/${contestId}/lineup`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ picks: lineup })
			});
			if (!r2.ok) {
				const errData = await r2.json().catch(() => ({}));
				throw new Error((errData as { error?: string }).error ?? 'Failed to submit lineup');
			}
			// Goes to the game, not the result. Landing on the result page straight
			// from a lock is what used to settle contests seconds after they began.
			window.location.href = `/game/${contestId}`;
		} catch (e) {
			toast(e instanceof Error ? e.message : 'Submit failed', 'error');
		} finally {
			submitting = false;
		}
	}

	const TILTS = ['-1.6deg', '1.2deg', '-0.8deg', '1.6deg', '-1.2deg'];
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<!-- ── Header ──────────────────────────────────────────────────── -->
	<div class="mb-6 flex flex-wrap items-end justify-between gap-6">
		<div>
			<div
				class="mb-2.5 font-mono text-[11px] font-bold tracking-[0.14em] uppercase"
				style="color:{lobbyId ? 'var(--color-coral-ink)' : 'var(--color-text-muted)'}"
			>
				{lobbyId
					? 'Ranked Lobby'
					: contestType === 'weekly'
						? 'Weekly Contest · 7D · 2× XP'
						: 'Head-to-head'}
				{#if isPaper}&middot; Scrimmage{/if}
				{#if sectorRestriction}&middot; {sectorRestriction.toUpperCase()}-only tournament{/if}
			</div>
			<h1 class="text-[40px] leading-none font-black tracking-[-0.04em] sm:text-[46px]">
				Build your lineup
			</h1>
			<p class="mt-2 text-sm text-text-muted">
				{#if sectorRestriction}
					Only {sectorRestriction.toUpperCase()} tokens are in the pool for this tournament
				{:else if lobbyId}
					One token per sector · you place against the whole room, not one opponent
				{:else}
					One token per sector · scoring runs {contestType === 'weekly' ? '7 days' : '24h'} from lock
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-2.5 rounded-full border border-border bg-surface px-[18px] py-2.5">
			<span class="anim-blink h-[7px] w-[7px] rounded-full bg-primary"></span>
			<span class="font-mono text-sm font-bold">{timerStr} to lock</span>
		</div>
	</div>

	{#if loading}
		<div class="flex flex-col gap-3.5">
			<div class="grid grid-cols-5 gap-3.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="h-40 animate-pulse rounded-[20px] bg-surface-alt"></div>
				{/each}
			</div>
			<div class="h-96 animate-pulse rounded-[20px] bg-surface-alt"></div>
		</div>
	{:else if loadError}
		<div
			class="flex items-center gap-3 rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative-ink"
		>
			<span>{loadError}</span>
			<button onclick={loadData} class="ml-auto cursor-pointer font-bold underline">Retry</button>
		</div>
	{:else}
		<!-- ── Sector slots ────────────────────────────────────────── -->
		<div class="mb-9 grid grid-cols-5 gap-3.5 pt-1.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
			{#each SECTORS as sector, i (sector.id)}
				{@const pick = pickForSector(sector.id)}
				{@const theme = sectorTheme(sector.id)}
				{@const isActive = activeSector === sector.id && !pick}
				{@const sectorChg = sectorChanges.get(sector.id) ?? null}
				{@const hasBoost = pick ? activeBoosts.get(sector.id) : false}

				<button
					type="button"
					onclick={() => selectSector(sector.id)}
					class="group relative overflow-hidden rounded-[20px] text-left transition-transform duration-200"
					style="transform:rotate({TILTS[i]});background:var(--color-surface);border:2px {pick
						? 'solid ' + theme.color
						: 'dashed var(--color-border-strong)'};{pick
						? `box-shadow:0 12px 34px ${theme.color}22`
						: ''}"
				>
					<div class="h-1.5" style="background:{pick ? theme.color : 'var(--color-border)'}"></div>
					<div class="flex flex-col items-center gap-3 px-4 pt-4.5 pb-5 text-center">
						<span
							class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase"
							style="background:{pick
								? theme.color + '24'
								: 'var(--color-surface-alt)'};color:{pick ? theme.ink : 'var(--color-text-muted)'}"
						>
							{sector.name} sector
						</span>

						{#if pick}
							{@const tkn = tokenMap.get(pick.currencyId)}
							<div
								class="grid h-[54px] w-[54px] place-items-center rounded-full"
								style="background:{theme.color};box-shadow:0 0 26px {theme.color}66"
							>
								<TokenIcon symbol={pick.symbol} size={38} bg="transparent" fg="var(--color-ink)" />
							</div>
							<div class="text-[17px] font-black tracking-[-0.02em]">{pick.symbol.toUpperCase()}</div>
							<div class="font-mono text-[11px] text-text-muted">
								{tkn?.change24h != null ? fmtChg(tkn.change24h) : (pick.name ?? '')}
							</div>
							{#if hasBoost}
								<span class="rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold text-text uppercase"
									>⚡ boost</span
								>
							{/if}
							<span
								role="button"
								tabindex="0"
								onclick={(e) => {
									e.stopPropagation();
									removePick(sector.id);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.stopPropagation();
										removePick(sector.id);
									}
								}}
								class="absolute top-2.5 right-2.5 grid h-5 w-5 cursor-pointer place-items-center rounded-full text-base leading-none text-text-muted hover:bg-hover"
								>×</span
							>
						{:else}
							<div
								class="grid h-[54px] w-[54px] place-items-center rounded-full text-[26px] font-black"
								style={isActive
									? `border:2px dashed ${theme.color};color:${theme.color}`
									: 'border:2px dashed var(--color-border-strong);color:var(--color-text-muted)'}
							>
								+
							</div>
							<div class="text-[15px] font-extrabold tracking-[-0.02em] text-text-muted">Empty</div>
							<div class="font-mono text-[11px]" style={sectorChg != null ? `color:${sectorChg >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'}` : 'color:var(--color-text-muted)'}>
								{sectorChg != null ? fmtChg(sectorChg) : `${sector.id === 'wildcard' ? 'any token' : 'draft a token'}`}
							</div>
						{/if}
					</div>
					<div
						class="absolute top-3.5 -right-6 w-24 rotate-[38deg] py-0.5 text-center font-mono text-[9px] font-bold tracking-[0.14em] uppercase"
						style="background:{pick ? theme.color : 'var(--color-surface-alt)'};color:{pick
							? 'var(--color-ink)'
							: 'var(--color-text-muted)'}"
					>
						{pick ? 'Picked' : 'Open'}
					</div>
				</button>
			{/each}
		</div>

		<!-- ── Pool + sidebar ──────────────────────────────────────── -->
		<div class="flex flex-wrap gap-4.5">
			<div class="min-w-0 flex-[1_1_520px]">
				<div class="mb-3.5 flex flex-wrap items-center gap-2.5">
					<div class="relative min-w-[180px] flex-1">
						<input
							type="text"
							placeholder="Search tokens…"
							bind:value={search}
							class="h-[42px] w-full rounded-full border border-border bg-surface px-[18px] text-[13px] text-text outline-none transition focus:border-primary"
						/>
					</div>
					{#each SECTORS as sector (sector.id)}
						{@const theme = sectorTheme(sector.id)}
						{@const isActive = activeSector === sector.id}
						{@const filled = !!pickForSector(sector.id)}
						<button
							type="button"
							onclick={() => (activeSector = sector.id)}
							class="relative flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition-all"
							style={isActive
								? `background:${theme.color};color:var(--color-ink)`
								: 'background:var(--color-surface-alt);color:var(--color-text-muted)'}
						>
							{sector.name}
							{#if filled}
								<span
									class="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold"
									style="background:{isActive ? 'rgba(26,36,33,0.25)' : theme.color};color:{isActive
										? 'var(--color-ink)'
										: 'var(--color-ink)'}">✓</span
								>
							{/if}
						</button>
					{/each}
				</div>

				<div id="token-pool" class="grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
					{#if filteredTokens.length === 0}
						<div class="col-span-full py-10 text-center text-sm text-text-muted">
							No tokens match "{search}"
						</div>
					{/if}
					{#each filteredTokens as token (token.currency_id)}
						{@const inLineup = isInLineup(token.currency_id)}
						{@const isHighlighted = token.currency_id === highlightId}
						{@const activeTheme = sectorTheme(activeSector)}
						<div
							role="group"
							onmouseenter={(e) => openHover(e, token.currency_id, token.symbol ?? '')}
							onmouseleave={scheduleCloseHover}
							class="rounded-[20px] p-4.5 transition-transform duration-200 hover:-translate-y-1.5"
							style="background:{inLineup
								? 'var(--color-primary-muted)'
								: 'var(--color-surface)'};border:2px solid {inLineup
								? 'var(--color-primary)'
								: 'var(--color-border)'};{isHighlighted ? 'outline:2px solid var(--color-primary)' : ''}"
						>
							<div class="mb-4 flex items-start justify-between gap-2.5">
								<div
									class="grid h-[46px] w-[46px] place-items-center rounded-full"
									style="background:{activeTheme.color};box-shadow:0 0 24px {activeTheme.color}55"
								>
									<TokenIcon symbol={token.symbol} size={32} bg="transparent" fg="var(--color-ink)" />
								</div>
								{#if token.rank}
									<span class="rounded-full bg-surface-alt px-2 py-1 text-[10px] font-bold text-text-muted"
										>#{token.rank}</span
									>
								{/if}
							</div>
							<div class="text-[22px] leading-none font-black tracking-[-0.03em]">
								{(token.symbol ?? '').toUpperCase()}
							</div>
							<div class="mt-1 mb-3.5 truncate text-[13px] text-text-muted">{token.name}</div>
							<div class="mb-4 flex items-center justify-between gap-2">
								<span class="font-mono text-[13px]">{fmtPrice(token.price)}</span>
								{#if token.change24h != null}
									<span
										class="rounded-full px-2.5 py-1 font-mono text-xs font-bold"
										style="background:{token.change24h >= 0
											? 'rgba(104,194,168,0.14)'
											: 'rgba(232,112,112,0.14)'};color:{token.change24h >= 0
											? 'var(--color-mint-ink)'
											: 'var(--color-red-ink)'}">{fmtChg(token.change24h)}</span
									>
								{/if}
							</div>
							<button
								type="button"
								disabled={inLineup}
								onclick={() => addToken(token)}
								class="w-full rounded-full py-3 text-[13px] font-extrabold {inLineup
									? 'cursor-default bg-primary text-text'
									: 'cursor-pointer bg-transparent'}"
								style={inLineup ? '' : `border:1.5px solid ${activeTheme.color};color:${activeTheme.ink}`}
							>
								{inLineup ? 'In your lineup' : `Drop into ${sectorTheme(activeSector).label}`}
							</button>
							<div class="mt-2 flex justify-between font-mono text-[10px] text-text-muted">
								<span>vol {fmtVol(token.volume24h)}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
				<div class="frost-panel rounded-[20px] p-[22px]">
					<div class="mb-4.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
						Projected score
					</div>
					<div
						class="font-mono text-[44px] leading-none font-bold tracking-[-0.03em]"
						style="color:{projectedScore >= 0 ? 'var(--color-coral-ink)' : 'var(--color-red-ink)'}"
					>
						{projectedScore >= 0 ? '+' : ''}{projectedScore}
					</div>
					<div class="mt-2 mb-4 text-xs text-text-muted">
						Live estimate from your {slotsFilledCount} filled sector{slotsFilledCount === 1 ? '' : 's'}
					</div>
					<div class="h-2 overflow-hidden rounded-full bg-surface-alt">
						<div
							class="h-full rounded-full bg-primary transition-[width] duration-500"
							style="width:{Math.min(100, (slotsFilledCount / 5) * 100)}%;box-shadow:0 0 18px rgba(247,142,121,0.8)"
						></div>
					</div>
				</div>

				{#if [...activeBoosts.keys()].length > 0}
					<div class="rounded-[20px] border border-warning bg-surface p-[22px] shadow-[0_0_40px_rgba(247,201,120,0.14)]">
						<div class="mb-3.5 text-[11px] font-extrabold tracking-[0.12em] text-warning-ink uppercase">
							Boost active
						</div>
						<div class="flex flex-col gap-2.5">
							{#each [...activeBoosts.keys()] as sid (sid)}
								{@const t = sectorTheme(sid)}
								<div class="flex items-center gap-3">
									<div class="h-9.5 w-9.5 shrink-0 rounded-[10px]" style="background:{t.color}29;border:1px solid {t.color}"></div>
									<div>
										<div class="text-sm font-extrabold">{t.label} &times;1.25</div>
										<div class="text-xs text-text-muted">From Knowledge Base</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<button
					type="button"
					onclick={submitLineup}
					disabled={slotsFilledCount !== 5 || submitting}
					class="w-full rounded-full py-4.5 text-base font-extrabold tracking-wide transition-transform active:scale-[0.98] {slotsFilledCount ===
					5
						? 'cursor-pointer bg-primary text-text shadow-[0_0_40px_rgba(247,142,121,0.4)] hover:-translate-y-0.5'
						: 'cursor-not-allowed bg-surface-alt text-text-muted'}"
				>
					{submitting ? 'Submitting…' : 'Lock lineup'}
				</button>
				<div class="text-center text-xs text-text-muted">{slotsFilledCount} of 5 sectors filled</div>
			</div>
		</div>
	{/if}
</div>

{#if hoverToken}
	<TokenHover
		currencyId={hoverToken.currencyId}
		symbol={hoverToken.symbol}
		anchor={hoverRect}
		onenter={cancelCloseHover}
		onleave={scheduleCloseHover}
	/>
{/if}

<Toast />
<DraftAgent {emptySectors} {isPaper} onPicks={applyAgentPicks} />
