<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { appKit } from '$lib/appkit';
	import { SiweMessage } from 'siwe';
	import bs58 from 'bs58';

	let { user }: { user: { xpTotal?: number | null; username?: string | null } | null } = $props();

	const appkitReady = Boolean(appKit);
	let authInFlight = $state(false);
	let lastAttemptedWallet = '';
	let walletConnected = $state(false);
	let signError = $state(false);
	// Why the last sign-in failed, when the server told us. Without this a
	// database outage looked identical to a rejected signature.
	let signErrorMessage = $state('');
	let openNavGroup = $state<string | null>(null);
	let mobileMenuOpen = $state(false);
	// `user` comes from +layout.server.ts, loaded once per navigation — it goes
	// stale the moment XP changes from an in-place action (answering the
	// Gauntlet, a contest resolving, a wager settling) with no navigation
	// after it, since nothing calls invalidateAll() for those. Nav stays
	// mounted for the whole session, so it polls its own live figure instead
	// of trusting that snapshot.
	let liveXp = $state<number | null>(null);
	// A persistent way back into whatever match/lobby you're already part of,
	// visible on every page — not just the dashboard, and not requiring a
	// detour through matchmaking's picker screen hoping it silently redirects
	// you. Nav stays mounted the whole session, so this polls too.
	let activeMatch = $state<{ href: string; label: string } | null>(null);

	const NAV_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
		// Every entry here must be somewhere a user can act from a cold click.
		// `/contest/result` was removed for failing that test: a result belongs to
		// a specific contest, so browsing to it with no id rendered a fabricated
		// one. Results are reached from the contest list on the dashboard.
		{
			label: 'play',
			items: [
				{ href: '/scrimmage', label: 'scrimmage' },
				{ href: '/matchmaking', label: 'single match' },
				{ href: '/tournament', label: 'tournament' }
			]
		},
		{
			label: 'compete',
			items: [{ href: '/leaderboard', label: 'leaderboard' }]
		},
		{
			label: 'learn',
			items: [
				{ href: '/mentor', label: 'mentor' },
				{ href: '/research', label: 'knowledge base' }
			]
		},
		{
			label: 'help',
			items: [
				{ href: '/guide', label: 'how to use' },
				{ href: '/docs', label: 'documentation' }
			]
		}
	];

	function groupIsActive(group: (typeof NAV_GROUPS)[number]): boolean {
		return group.items.some((i) => page.url.pathname.startsWith(i.href));
	}

	onMount(() => {
		if (!user) return;
		async function refreshXp() {
			try {
				const res = await fetch('/api/me');
				if (res.ok) liveXp = (await res.json())?.xpTotal ?? null;
			} catch {
				/* keep whatever figure we last had rather than blank it */
			}
		}
		refreshXp();
		const t = setInterval(refreshXp, 20_000);
		return () => clearInterval(t);
	});

	onMount(() => {
		if (!user) return;
		async function refreshActiveMatch() {
			try {
				const res = await fetch('/api/contests');
				if (res.ok) {
					const contests: Array<Record<string, unknown>> = await res.json();
					const mine = contests.find((c) => c.status !== 'resolved');
					if (mine) {
						activeMatch = mine.myLineupLocked
							? { href: `/game/${mine.id}`, label: mine.status === 'live' ? 'Watch race' : 'Active match' }
							: { href: `/draft?contestId=${mine.id}&type=${mine.type ?? 'daily'}${mine.isPaper ? '&mode=paper' : ''}`, label: 'Continue draft' };
						return;
					}
				}
			} catch {
				/* fall through to checking lobbies */
			}
			try {
				const res = await fetch('/api/lobby/mine');
				if (res.ok) {
					const lobbies: Array<Record<string, unknown>> = await res.json();
					const mine = lobbies[0];
					if (mine) {
						activeMatch = mine.myLineupLocked
							? { href: `/lobby/${mine.id}/result`, label: mine.status === 'live' ? 'Watch' : 'Active match' }
							: { href: `/draft?lobbyId=${mine.id}`, label: 'Continue draft' };
						return;
					}
				}
			} catch {
				/* no active match found — that's fine, just hide the pill */
			}
			activeMatch = null;
		}
		refreshActiveMatch();
		const t = setInterval(refreshActiveMatch, 20_000);
		return () => clearInterval(t);
	});

	onMount(() => {
		function handleClickOutside(e: MouseEvent) {
			if (!(e.target as HTMLElement).closest('[data-nav-dropdown]')) {
				openNavGroup = null;
			}
			if (!(e.target as HTMLElement).closest('[data-mobile-nav]')) {
				mobileMenuOpen = false;
			}
		}
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});

	type MaybeEthereum = {
		request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
	};

	type MaybeSolana = {
		isConnected?: boolean;
		publicKey?: { toBase58: () => string };
		signMessage?: (
			message: Uint8Array,
			display?: string
		) => Promise<{ signature: Uint8Array } | Uint8Array>;
	};

	type WalletCandidate =
		| { type: 'evm'; address: string; provider: MaybeEthereum }
		| { type: 'solana'; address: string; provider: MaybeSolana };

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/';
	}

	function getAppKitProvider(): WalletCandidate | null {
		if (!appKit) return null;

		const account = appKit.getAccount?.();
		if (!account?.address) return null;

		// Use AppKit's own authorized provider — not window.ethereum/window.solana
		const walletProvider = appKit.getWalletProvider?.() as unknown;

		const w = window as Window & {
			ethereum?: MaybeEthereum;
			solana?: MaybeSolana;
		};

		// Solana
		if ((account as Record<string, unknown>).type === 'solana') {
			const sol = (walletProvider as MaybeSolana)?.signMessage
				? (walletProvider as MaybeSolana)
				: w.solana;
			if (sol?.signMessage) {
				console.log('[Auth] Found Solana wallet (AppKit):', account.address);
				return { type: 'solana', address: account.address, provider: sol };
			}
			return null;
		}

		// EVM — prefer AppKit's authorized provider, fall back to window.ethereum
		const evm = (walletProvider as MaybeEthereum)?.request
			? (walletProvider as MaybeEthereum)
			: w.ethereum;
		if (evm?.request) {
			console.log('[Auth] Found EVM wallet (AppKit):', account.address);
			return { type: 'evm', address: account.address, provider: evm };
		}

		return null;
	}

	async function signAndVerifyEvm(address: string, provider: MaybeEthereum): Promise<boolean> {
		const nonceRes = await fetch('/api/auth/nonce');
		if (!nonceRes.ok) return false;
		const { nonce } = await nonceRes.json();

		// Get chain ID from AppKit — avoids needing eth_chainId authorization on window.ethereum
		const appKitChain = appKit?.getChainId?.();
		const chainId = typeof appKitChain === 'number' ? appKitChain : 1;

		const siwe = new SiweMessage({
			domain: window.location.host,
			address,
			statement: 'Sign in to CoinDraft',
			uri: window.location.origin,
			version: '1',
			chainId,
			nonce
		});

		const message = siwe.prepareMessage();
		const signature = (await provider.request({
			method: 'personal_sign',
			params: [message, address]
		})) as string;

		const verifyRes = await fetch('/api/auth/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'evm', address, message, signature })
		});

		if (!verifyRes.ok) {
			const payload = await verifyRes.json().catch(() => ({}));
			signErrorMessage = payload?.error ?? '';
		}
		return verifyRes.ok;
	}

	async function signAndVerifySolana(address: string, provider: MaybeSolana): Promise<boolean> {
		if (!provider.signMessage) return false;

		const nonceRes = await fetch('/api/auth/nonce');
		if (!nonceRes.ok) return false;
		const { nonce } = await nonceRes.json();

		const message = `CoinDraft Sign-In\nAddress: ${address}\nNonce: ${nonce}\nURI: ${window.location.origin}`;
		const encoded = new TextEncoder().encode(message);
		const signed = await provider.signMessage(encoded, 'utf8');
		const signatureBytes = signed instanceof Uint8Array ? signed : signed.signature;
		const signature = bs58.encode(signatureBytes);

		const verifyRes = await fetch('/api/auth/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type: 'solana', address, message, signature })
		});

		if (!verifyRes.ok) {
			const payload = await verifyRes.json().catch(() => ({}));
			signErrorMessage = payload?.error ?? '';
		}
		return verifyRes.ok;
	}

	async function ensureWalletSession() {
		if (user || authInFlight) return;

		const wallet = getAppKitProvider();
		if (!wallet) {
			console.log('[Auth] No wallet detected');
			return;
		}

		const walletKey = `${wallet.type}:${wallet.address}`;
		if (lastAttemptedWallet === walletKey) {
			console.log('[Auth] Already attempted wallet:', walletKey);
			return;
		}

		authInFlight = true;
		lastAttemptedWallet = walletKey;
		console.log('[Auth] Starting sign for:', walletKey);
		try {
			const ok =
				wallet.type === 'evm'
					? await signAndVerifyEvm(wallet.address, wallet.provider)
					: await signAndVerifySolana(wallet.address, wallet.provider);

			console.log('[Auth] Sign+verify result:', ok);
			if (ok) {
				console.log('[Auth] Success! Reloading page');
				signError = false;
				await invalidateAll();
				window.location.reload();
			} else {
				signError = true;
			}
		} catch (e) {
			console.error('[Auth] Error during sign/verify:', e);
			signError = true;
		} finally {
			authInFlight = false;
		}
	}

	function retrySign() {
		signError = false;
		signErrorMessage = '';
		lastAttemptedWallet = '';
		void ensureWalletSession();
	}

	onMount(() => {
		if (user) return;

		let retryCount = 0;
		const MAX_RETRIES = 3;

		function tick() {
			walletConnected = !!getAppKitProvider();
			if (signError && retryCount < MAX_RETRIES) {
				retryCount++;
				console.log('[Auth] Auto-retry attempt', retryCount);
				lastAttemptedWallet = '';
				signError = false;
			}
			void ensureWalletSession();
		}

		// Listen to AppKit account changes
		const appKitAny = appKit as unknown as Record<string, unknown>;
		const unsubAccount =
			typeof appKitAny?.subscribe === 'function'
				? (appKitAny.subscribe as (...args: unknown[]) => unknown)('accountsChanged', tick)
				: undefined;
		const unsubChain =
			typeof appKitAny?.subscribe === 'function'
				? (appKitAny.subscribe as (...args: unknown[]) => unknown)('chainChanged', tick)
				: undefined;

		// Initial check with delay to let AppKit fully initialize
		const initTimer = window.setTimeout(tick, 500);

		// Fallback poll — less frequent to avoid race conditions
		const t = window.setInterval(tick, 3000);

		return () => {
			window.clearTimeout(initTimer);
			window.clearInterval(t);
			if (typeof unsubAccount === 'function') unsubAccount();
			if (typeof unsubChain === 'function') unsubChain();
		};
	});
</script>

<nav
	class="sticky top-0 z-50 flex items-center justify-between gap-6 border-b border-border bg-surface px-7 py-3.5"
>
	<a href="/" class="flex shrink-0 items-center gap-2.5 no-underline">
		<svg
			class="h-6 w-6 shrink-0 drop-shadow-[0_0_14px_rgba(247,142,121,0.45)]"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="11" class="fill-text" />
			<polyline
				points="6,14.5 9.5,10.5 12,12.5 17.5,6.5"
				stroke="var(--color-surface)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<circle cx="17.5" cy="6.5" r="1.8" class="fill-primary" />
		</svg>
		<span class="text-[19px] font-black tracking-[-0.03em] text-text">CoinDraft</span>
	</a>

	<button
		type="button"
		onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
		data-mobile-nav
		aria-label="Toggle menu"
		class="hidden shrink-0 items-center justify-center rounded-full border border-border bg-surface-alt p-2 text-text-muted max-md:flex"
	>
		<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
			{#if mobileMenuOpen}
				<path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
			{:else}
				<path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16" />
			{/if}
		</svg>
	</button>

	<div
		class="frost-panel flex min-w-0 flex-wrap items-center justify-center gap-0.5 rounded-full p-1 max-md:hidden"
	>
		<a
			href="/"
			class="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-text-muted no-underline transition"
			class:bg-surface-alt={page.url.pathname === '/'}
			class:font-bold={page.url.pathname === '/'}
			class:text-text={page.url.pathname === '/'}>Home</a
		>
		<a
			href="/dashboard"
			class="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-text-muted no-underline transition"
			class:bg-surface-alt={page.url.pathname.startsWith('/dashboard')}
			class:font-bold={page.url.pathname.startsWith('/dashboard')}
			class:text-text={page.url.pathname.startsWith('/dashboard')}>Dashboard</a
		>
		{#each NAV_GROUPS as group (group.label)}
			<div class="relative shrink-0" data-nav-dropdown>
				<button
					type="button"
					onclick={() => (openNavGroup = openNavGroup === group.label ? null : group.label)}
					class="flex cursor-pointer items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-text-muted transition"
					class:bg-surface-alt={groupIsActive(group)}
					class:font-bold={groupIsActive(group)}
					class:text-text={groupIsActive(group)}
				>
					{group.label.charAt(0).toUpperCase() + group.label.slice(1)}
					<svg
						class="h-3 w-3 transition-transform {openNavGroup === group.label ? 'rotate-180' : ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2.5"
					>
						<polyline points="6 9 12 15 18 9" />
					</svg>
				</button>
				{#if openNavGroup === group.label}
					<div
						class="absolute top-full left-0 z-50 mt-2 min-w-36 rounded-xl border border-border bg-surface p-1 shadow-[0_12px_34px_rgba(26,36,33,0.14)]"
					>
						{#each group.items as item (item.href)}
							<a
								href={item.href}
								onclick={() => (openNavGroup = null)}
								class="block rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-muted no-underline transition hover:bg-hover hover:text-text"
								class:bg-primary-muted={page.url.pathname.startsWith(item.href)}
								class:text-primary-ink={page.url.pathname.startsWith(item.href)}
								>{item.label.charAt(0).toUpperCase() + item.label.slice(1)}</a
							>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="flex shrink-0 items-center gap-2.5">
		{#if user && activeMatch}
			<a
				href={activeMatch.href}
				class="flex items-center gap-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-extrabold whitespace-nowrap text-text no-underline transition hover:bg-primary-hover"
			>
				<span class="anim-blink h-1.5 w-1.5 rounded-full bg-text"></span>
				{activeMatch.label}
			</a>
		{/if}
		{#if user}
			<span class="font-mono text-xs whitespace-nowrap text-text-muted">{liveXp ?? user.xpTotal ?? 0} XP</span
			>
			<a
				href="/profile"
				class="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-alt no-underline transition hover:border-primary"
			>
				{user.username?.[0]?.toUpperCase() ?? '?'}
			</a>
			<button
				onclick={logout}
				class="cursor-pointer rounded-full border border-border bg-transparent px-3 py-1.5 text-xs font-bold whitespace-nowrap text-text-muted transition hover:bg-hover hover:text-text"
				>Log out</button
			>
		{:else if walletConnected}
			{#if authInFlight}
				<span class="text-xs whitespace-nowrap text-text-muted">Signing...</span>
			{:else if signError}
				<span
					class="max-w-[34ch] truncate text-xs text-negative-ink"
					title={signErrorMessage || 'Signature failed.'}
				>
					{signErrorMessage || 'Signature failed.'}
				</span>
				<button
					onclick={retrySign}
					class="cursor-pointer rounded-full border-none bg-primary px-3.5 py-1.5 text-xs font-bold whitespace-nowrap text-text transition hover:bg-primary-hover"
					>Try again</button
				>
			{:else}
				<span class="text-xs whitespace-nowrap text-text-muted">Wallet connected —</span>
				<button
					onclick={retrySign}
					class="cursor-pointer rounded-full border-none bg-primary px-3.5 py-1.5 text-xs font-bold whitespace-nowrap text-text transition hover:bg-primary-hover"
					>Sign to verify</button
				>
			{/if}
		{:else if appkitReady}
			<appkit-button></appkit-button>
		{:else}
			<button
				class="cursor-not-allowed rounded-full border border-border bg-transparent px-3.5 py-1.5 text-xs whitespace-nowrap text-text-muted"
				disabled>loading wallet...</button
			>
		{/if}
	</div>
</nav>

{#if mobileMenuOpen}
	<div
		data-mobile-nav
		class="hidden flex-col gap-0.5 border-b border-border bg-surface px-4 py-3 max-md:flex"
	>
		<a
			href="/"
			onclick={() => (mobileMenuOpen = false)}
			class="rounded-lg px-3 py-2 text-sm font-medium text-text-muted no-underline"
			class:bg-surface-alt={page.url.pathname === '/'}
			class:font-bold={page.url.pathname === '/'}
			class:text-text={page.url.pathname === '/'}>Home</a
		>
		<a
			href="/dashboard"
			onclick={() => (mobileMenuOpen = false)}
			class="rounded-lg px-3 py-2 text-sm font-medium text-text-muted no-underline"
			class:bg-surface-alt={page.url.pathname.startsWith('/dashboard')}
			class:font-bold={page.url.pathname.startsWith('/dashboard')}
			class:text-text={page.url.pathname.startsWith('/dashboard')}>Dashboard</a
		>
		{#each NAV_GROUPS as group (group.label)}
			<div class="mt-1.5 border-t border-border pt-1.5">
				<div class="px-3 py-1 text-[10px] font-bold tracking-[0.1em] text-text-muted uppercase">
					{group.label}
				</div>
				{#each group.items as item (item.href)}
					<a
						href={item.href}
						onclick={() => (mobileMenuOpen = false)}
						class="block rounded-lg px-3 py-2 text-sm font-medium text-text-muted no-underline"
						class:bg-primary-muted={page.url.pathname.startsWith(item.href)}
						class:font-bold={page.url.pathname.startsWith(item.href)}
						class:text-primary-ink={page.url.pathname.startsWith(item.href)}
						>{item.label.charAt(0).toUpperCase() + item.label.slice(1)}</a
					>
				{/each}
			</div>
		{/each}
	</div>
{/if}
