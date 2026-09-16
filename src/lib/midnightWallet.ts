// Client-only. Derives a Midnight identity from the player's already-connected
// EVM or Solana wallet (via Reown AppKit — see $lib/appkit.ts) instead of
// requiring a separate Lace install: one signature, hashed to a 32-byte seed,
// fed into @midnight-ntwrk/wallet-sdk-hd's HDWallet.fromSeed(). No Lace
// involved anywhere in this flow.
//
// ZERO SERVER-SIDE IMPORTS. Same discipline as $lib/evmWallet.ts and
// $lib/appkit.ts — a past incident (see docs-project/status/whats-next.md #4)
// had wallet code leak into the server bundle via a shared import and crash
// the dev server. Every exported function here calls assertBrowser() first as
// a fail-fast guard, on top of never doing browser-only work at module scope.
//
// The raw signature is used exactly once, in-memory, to derive the seed, and
// is never logged, stored, or sent anywhere. Only the derived 32-byte seed is
// cached (in localStorage, keyed by wallet address) so the player isn't asked
// to re-sign every session — signing determinism isn't guaranteed for every
// wallet/provider, so re-deriving via a fresh signature on every use would be
// fragile; caching after first derivation avoids that.

// NOTE on the import shape below: only TYPE-ONLY imports of the Midnight SDK
// live at module scope. Every runtime VALUE from these packages is loaded via
// the memoized dynamic-import loaders further down instead of a top-level
// `import`. This is load-bearing, not style — see the "Lazy SDK loaders"
// comment below for why.
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { WalletFacade, DefaultConfiguration } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';
import { appKit } from '$lib/appkit';
import {
	MIDNIGHT_ADDITIONAL_FEE_OVERHEAD,
	MIDNIGHT_FEE_BLOCKS_MARGIN,
	MIDNIGHT_INDEXER_HTTP_URL,
	MIDNIGHT_INDEXER_WS_URL,
	MIDNIGHT_NETWORK_ID,
	MIDNIGHT_NODE_WS_URL,
	MIDNIGHT_PROOF_SERVER_URL
} from '$lib/midnight/config';

function assertBrowser(fnName: string): void {
	if (typeof window === 'undefined') {
		throw new Error(`midnightWallet.${fnName}() is client-only and must not run during SSR.`);
	}
}

// ── Lazy SDK loaders ─────────────────────────────────────────────────────
// @midnight-ntwrk/wallet-sdk-dust-wallet transitively depends on
// wallet-sdk-capabilities -> wallet-sdk-prover-client -> web-worker@1.5.0
// (confirmed via `npm ls web-worker` — this is the ONLY path to that package
// in the whole dependency tree). web-worker's own module runs, at EVALUATION
// TIME (not when a Worker is instantiated):
//   typeof Worker === 'function' ? Worker : threads.isMainThread ? mainThread() : workerThread()
// SvelteKit's postbuild route-analysis step (analyse.js) already runs inside
// its OWN worker_thread (see sveltekit's fork.js), so `isMainThread` is
// already false there. When analyse.js statically imports a route module
// (every route, to inspect prerender/config exports) that transitively
// imports web-worker, web-worker wrongly concludes it's a spawned worker
// instance and crashes reading `workerData`, which was never meant for it.
//
// Fix: never let these packages' top-level code run during static/module
// analysis — only import them once a player actually triggers wallet
// functionality in the browser. Each loader is memoized so repeated calls
// across different functions don't re-run the dynamic import.
function memoizedImport<T>(loader: () => Promise<T>): () => Promise<T> {
	let promise: Promise<T> | null = null;
	return () => {
		if (!promise) promise = loader();
		return promise;
	};
}

const loadLedger = memoizedImport(() => import('@midnight-ntwrk/ledger-v8'));
const loadHdWallet = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-hd'));
const loadWalletFacade = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-facade'));
const loadShieldedWallet = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-shielded'));
const loadUnshieldedWallet = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-unshielded-wallet'));
const loadDustWallet = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-dust-wallet'));
const loadAbstractions = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-abstractions'));
const loadNetworkId = memoizedImport(() => import('@midnight-ntwrk/midnight-js-network-id'));

let networkIdSet = false;
async function setNetworkIdOnce(): Promise<void> {
	// No longer runs at module scope (that used to eagerly import
	// midnight-js-network-id — harmless on its own, but kept lazy for
	// consistency with everything else in this section). Idempotent: every
	// entry point below calls this first, and only the first call actually
	// imports and invokes setNetworkId. Every downstream SDK call reads the
	// network id via getNetworkId() rather than taking it as a parameter.
	if (networkIdSet) return;
	const { setNetworkId } = await loadNetworkId();
	try {
		setNetworkId(MIDNIGHT_NETWORK_ID);
	} catch {
		/* already set — fine */
	}
	networkIdSet = true;
}

// ── Connected wallet (EVM or Solana), via AppKit ────────────────────────────
// Mirrors the pattern already used in Nav.svelte / $lib/evmWallet.ts.

type MaybeEthereum = {
	request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type MaybeSolana = {
	publicKey?: { toBase58: () => string };
	signMessage?: (
		message: Uint8Array,
		display?: string
	) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

type ConnectedWallet =
	| { kind: 'evm'; address: string; provider: MaybeEthereum }
	| { kind: 'solana'; address: string; provider: MaybeSolana };

export function getConnectedWallet(): ConnectedWallet | null {
	if (!appKit) return null;
	const account = appKit.getAccount?.();
	if (!account?.address) return null;

	const walletProvider = appKit.getWalletProvider?.() as unknown;
	const w = window as Window & { ethereum?: MaybeEthereum; solana?: MaybeSolana };

	if ((account as Record<string, unknown>).type === 'solana') {
		const sol = (walletProvider as MaybeSolana)?.signMessage ? (walletProvider as MaybeSolana) : w.solana;
		if (!sol?.signMessage) return null;
		return { kind: 'solana', address: account.address, provider: sol };
	}

	const evm = (walletProvider as MaybeEthereum)?.request ? (walletProvider as MaybeEthereum) : w.ethereum;
	if (!evm?.request) return null;
	return { kind: 'evm', address: account.address, provider: evm };
}

// ── Signature -> 32-byte seed ───────────────────────────────────────────────

const SIGNING_MESSAGE_PREFIX =
	'Sign this message to enable private verification features on CoinDraft.\n' +
	'This does not cost gas or move funds.\n\n' +
	'This signature is used only on this device, to derive a private key for\n' +
	'a separate Midnight identity. It is never sent to CoinDraft or anyone else.\n\n' +
	'Wallet: ';

function buildSigningMessage(address: string): string {
	return `${SIGNING_MESSAGE_PREFIX}${address}`;
}

async function signWithConnectedWallet(wallet: ConnectedWallet, message: string): Promise<Uint8Array> {
	if (wallet.kind === 'evm') {
		const hex = (await wallet.provider.request({
			method: 'personal_sign',
			params: [message, wallet.address]
		})) as string;
		const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
		return Uint8Array.from(Buffer.from(clean, 'hex'));
	}

	if (!wallet.provider.signMessage) {
		throw new Error('Connected Solana wallet does not support message signing.');
	}
	const encoded = new TextEncoder().encode(message);
	const signed = await wallet.provider.signMessage(encoded, 'utf8');
	return signed instanceof Uint8Array ? signed : signed.signature;
}

/** SHA-256 of the raw signature bytes, as a 32-byte seed. The signature itself is discarded immediately after. */
async function hashSignatureToSeed(signature: Uint8Array): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest('SHA-256', signature.buffer as ArrayBuffer);
	return new Uint8Array(digest);
}

const SEED_CACHE_PREFIX = 'coindraft:midnight:seed:v1:';

function seedCacheKey(address: string): string {
	return `${SEED_CACHE_PREFIX}${address.toLowerCase()}`;
}

function readCachedSeed(address: string): Uint8Array | null {
	try {
		const stored = window.localStorage.getItem(seedCacheKey(address));
		if (!stored) return null;
		return Uint8Array.from(Buffer.from(stored, 'hex'));
	} catch {
		return null;
	}
}

function writeCachedSeed(address: string, seed: Uint8Array): void {
	try {
		window.localStorage.setItem(seedCacheKey(address), Buffer.from(seed).toString('hex'));
	} catch {
		/* localStorage unavailable (private browsing, quota) — session still works, just re-signs next time */
	}
}

export function hasMidnightIdentity(address: string): boolean {
	assertBrowser('hasMidnightIdentity');
	return readCachedSeed(address) !== null;
}

/**
 * Get or create this wallet's Midnight seed. Uses the cached seed if one
 * exists for the connected address; otherwise prompts a signature, derives,
 * and caches it. Requires a connected EVM or Solana wallet (via AppKit).
 */
export async function deriveMidnightSeed(): Promise<{ seed: Uint8Array; address: string }> {
	assertBrowser('deriveMidnightSeed');

	const wallet = getConnectedWallet();
	if (!wallet) {
		throw new Error('Connect a wallet first — Midnight identity is derived from your connected wallet.');
	}

	const cached = readCachedSeed(wallet.address);
	if (cached) return { seed: cached, address: wallet.address };

	const message = buildSigningMessage(wallet.address);
	const signature = await signWithConnectedWallet(wallet, message);
	const seed = await hashSignatureToSeed(signature);
	writeCachedSeed(wallet.address, seed);
	return { seed, address: wallet.address };
}

// ── KYC identity secret key ──────────────────────────────────────────────
// Domain-separated from the seed itself, rather than reusing an HD role key
// directly — keeps the on-chain KYC identity secret (kycSecretKey witness,
// see KycAttestation.compact) cryptographically independent of the wallet's
// spending keys, even though both trace back to the same signature-derived
// seed.

export async function kycSecretKeyFromSeed(seed: Uint8Array): Promise<Uint8Array> {
	const domainTag = new TextEncoder().encode('coindraft:midnight:kyc-secret:v1');
	const combined = new Uint8Array(domainTag.length + seed.length);
	combined.set(domainTag, 0);
	combined.set(seed, domainTag.length);
	const digest = await crypto.subtle.digest('SHA-256', combined.buffer as ArrayBuffer);
	return new Uint8Array(digest);
}

// ── Wallet facade (browser) ─────────────────────────────────────────────
// Same shape as contracts/midnight/scripts/lib/wallet.ts's Node-side builder
// (same SDK, same derivation path), but no `ws` polyfill needed — the
// browser provides WebSocket natively — and nothing is written to disk.

export interface MidnightWalletSession {
	readonly facade: WalletFacade;
	readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
	readonly dustSecretKey: ledger.DustSecretKey;
	readonly keystore: UnshieldedKeystore;
	stop(): Promise<void>;
}

async function deriveRoleKeys(seed: Uint8Array): Promise<{
	zswap: Uint8Array;
	nightExternal: Uint8Array;
	dust: Uint8Array;
}> {
	const { HDWallet, Roles } = await loadHdWallet();
	const hd = HDWallet.fromSeed(seed);
	if (hd.type !== 'seedOk') throw new Error(`HDWallet.fromSeed failed: ${hd.type}`);
	const derived = hd.hdWallet
		.selectAccount(0)
		.selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
		.deriveKeysAt(0);
	if (derived.type !== 'keysDerived') {
		hd.hdWallet.clear();
		throw new Error(`Key derivation failed for roles: ${derived.roles.join(', ')}`);
	}
	hd.hdWallet.clear();
	return {
		zswap: derived.keys[Roles.Zswap],
		nightExternal: derived.keys[Roles.NightExternal],
		dust: derived.keys[Roles.Dust]
	};
}

/** Build and start a WalletFacade from a derived seed, against the local devnet. */
export async function openMidnightWallet(seed: Uint8Array): Promise<MidnightWalletSession> {
	assertBrowser('openMidnightWallet');
	await setNetworkIdOnce();

	const keys = await deriveRoleKeys(seed);
	const [
		ledgerMod,
		{ WalletFacade, WalletEntrySchema },
		{ ShieldedWallet },
		{ UnshieldedWallet, createKeystore, PublicKey },
		{ DustWallet },
		{ InMemoryTransactionHistoryStorage }
	] = await Promise.all([
		loadLedger(),
		loadWalletFacade(),
		loadShieldedWallet(),
		loadUnshieldedWallet(),
		loadDustWallet(),
		loadAbstractions()
	]);

	const shieldedSecretKeys = ledgerMod.ZswapSecretKeys.fromSeed(keys.zswap);
	const dustSecretKey = ledgerMod.DustSecretKey.fromSeed(keys.dust);
	const keystore = createKeystore(keys.nightExternal, MIDNIGHT_NETWORK_ID);

	const configuration: DefaultConfiguration = {
		networkId: MIDNIGHT_NETWORK_ID,
		costParameters: {
			feeBlocksMargin: MIDNIGHT_FEE_BLOCKS_MARGIN,
			additionalFeeOverhead: MIDNIGHT_ADDITIONAL_FEE_OVERHEAD
		},
		relayURL: new URL(MIDNIGHT_NODE_WS_URL),
		provingServerUrl: new URL(MIDNIGHT_PROOF_SERVER_URL),
		indexerClientConnection: {
			indexerHttpUrl: MIDNIGHT_INDEXER_HTTP_URL,
			indexerWsUrl: MIDNIGHT_INDEXER_WS_URL
		},
		txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema)
	};

	const facade = await WalletFacade.init({
		configuration,
		shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
		unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
		dust: (cfg) =>
			DustWallet(cfg).startWithSecretKey(dustSecretKey, ledgerMod.LedgerParameters.initialParameters().dust)
	});

	await facade.start(shieldedSecretKeys, dustSecretKey);

	return {
		facade,
		shieldedSecretKeys,
		dustSecretKey,
		keystore,
		stop: () => facade.stop()
	};
}

// ── Funding + DUST registration ─────────────────────────────────────────
// A freshly-derived identity has zero NIGHT and thus zero DUST, so it can't
// pay for anything. Local-devnet-only: asks the dev-only funding endpoint
// (server-side, genesis-wallet-backed — see src/lib/server/midnightFunding.ts)
// for a NIGHT airdrop, then registers that NIGHT for DUST generation itself
// (registration needs the player's own signing key, so it can't be done by
// the funding endpoint on the player's behalf).

export type FundingStage =
	| 'checking'
	| 'requesting-funds'
	| 'waiting-for-funds'
	| 'registering-dust'
	| 'waiting-for-dust'
	| 'ready';

async function waitForCondition<T>(
	source: Rx.Observable<T>,
	predicate: (value: T) => boolean,
	timeoutMs: number
): Promise<T> {
	return Rx.firstValueFrom(source.pipe(Rx.filter(predicate), Rx.timeout(timeoutMs)));
}

export async function ensureFundedAndRegistered(
	session: MidnightWalletSession,
	onProgress?: (stage: FundingStage) => void
): Promise<void> {
	assertBrowser('ensureFundedAndRegistered');
	const { facade, keystore } = session;
	const { nativeToken } = await loadLedger();
	const NIGHT_TOKEN_TYPE = nativeToken().raw;

	onProgress?.('checking');
	let state = await facade.waitForSyncedState();

	if (state.dust.balance(new Date()) > 0n) {
		onProgress?.('ready');
		return;
	}

	if ((state.unshielded.balances[NIGHT_TOKEN_TYPE] ?? 0n) === 0n) {
		onProgress?.('requesting-funds');
		const res = await fetch('/api/dev/midnight-fund', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ address: keystore.getBech32Address().toString() })
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body?.error ?? 'Could not fund this identity — is the dev-only faucet endpoint available?');
		}

		onProgress?.('waiting-for-funds');
		state = await waitForCondition(
			facade.state(),
			(s) => (s.unshielded.balances[NIGHT_TOKEN_TYPE] ?? 0n) > 0n,
			90_000
		);
	}

	onProgress?.('registering-dust');
	const nightUtxos = state.unshielded.availableCoins.filter(
		(coin) => coin.utxo.type === NIGHT_TOKEN_TYPE && coin.meta.registeredForDustGeneration === false
	);
	if (nightUtxos.length > 0) {
		const recipe = await facade.registerNightUtxosForDustGeneration(
			nightUtxos,
			keystore.getPublicKey(),
			(payload) => keystore.signData(payload)
		);
		const finalized = await facade.finalizeRecipe(recipe);
		await facade.submitTransaction(finalized);
	}

	onProgress?.('waiting-for-dust');
	await waitForCondition(facade.state(), (s) => s.dust.balance(new Date()) > 0n, 120_000);

	onProgress?.('ready');
}
