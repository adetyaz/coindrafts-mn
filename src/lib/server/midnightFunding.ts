// Server-only. Backs the dev-only funding endpoint
// (src/routes/api/dev/midnight-fund/+server.ts): sends NIGHT from the local
// devnet's genesis wallet to a freshly-derived player identity so it can pay
// DUST registration and, later, contract-call fees.
//
// LOCAL DEVNET ONLY — this is not a faucet for any real network, and the
// route that calls this is gated to `dev` (see the route file). Mirrors
// contracts/midnight/scripts/fund-player.ts (same SDK, same genesis seed);
// duplicated rather than imported across packages so this app's browser
// bundle and contracts/midnight's Node tooling stay on fully independent
// dependency trees (see the root-level version-pinning notes in package.json
// for why that isolation matters here).

import WebSocket from 'ws';
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;

// Only TYPE-ONLY imports of the Midnight SDK live at module scope here —
// every runtime VALUE is loaded lazily below. This is server-only code (this
// module is only ever imported by the dev-faucet +server.ts route), but that
// doesn't exempt it: SvelteKit's postbuild route-analysis step
// (`analyse.js`) statically imports EVERY route module — pages and API
// endpoints alike — from inside its own worker_thread, purely to read
// config exports like `prerender`. @midnight-ntwrk/wallet-sdk-dust-wallet
// transitively pulls in wallet-sdk-capabilities -> wallet-sdk-prover-client
// -> web-worker@1.5.0 (confirmed via `npm ls web-worker` — the only path to
// that package in the whole tree), whose own module runs
// `threads.isMainThread ? mainThread() : workerThread()` at import time.
// Since analyse.js's worker_thread already has isMainThread === false,
// web-worker wrongly concludes it's a spawned worker instance and crashes
// reading `workerData` (belongs to SvelteKit's own fork mechanism, not this
// package) — see $lib/midnightWallet.ts's identical comment for the fuller
// trace. Fix: never let these packages' top-level code run at import time —
// only inside the functions that actually build the genesis facade.
import type { DefaultConfiguration } from '@midnight-ntwrk/wallet-sdk-facade';
import {
	MIDNIGHT_ADDITIONAL_FEE_OVERHEAD,
	MIDNIGHT_FEE_BLOCKS_MARGIN,
	MIDNIGHT_INDEXER_HTTP_URL,
	MIDNIGHT_INDEXER_WS_URL,
	MIDNIGHT_NETWORK_ID,
	MIDNIGHT_NODE_WS_URL,
	MIDNIGHT_PROOF_SERVER_URL
} from '$lib/midnight/config';

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
const loadAddressFormat = memoizedImport(() => import('@midnight-ntwrk/wallet-sdk-address-format'));

const GENESIS_SEED_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const DEFAULT_AIRDROP_NIGHT = 100_000_000n; // 100 NIGHT (6 decimals)

let networkIdSet = false;
async function setNetworkIdOnce(): Promise<void> {
	if (networkIdSet) return;
	const { setNetworkId } = await loadNetworkId();
	setNetworkId(MIDNIGHT_NETWORK_ID);
	networkIdSet = true;
}

function hexToSeed(hex: string): Uint8Array {
	return Uint8Array.from(Buffer.from(hex, 'hex'));
}

async function buildGenesisFacade() {
	await setNetworkIdOnce();
	const seed = hexToSeed(GENESIS_SEED_HEX);

	const [
		{ HDWallet, Roles },
		ledgerMod,
		{ WalletFacade, WalletEntrySchema },
		{ ShieldedWallet },
		{ UnshieldedWallet, createKeystore, PublicKey },
		{ DustWallet },
		{ InMemoryTransactionHistoryStorage }
	] = await Promise.all([
		loadHdWallet(),
		loadLedger(),
		loadWalletFacade(),
		loadShieldedWallet(),
		loadUnshieldedWallet(),
		loadDustWallet(),
		loadAbstractions()
	]);

	const hd = HDWallet.fromSeed(seed);
	if (hd.type !== 'seedOk') throw new Error(`Genesis seed derivation failed: ${hd.type}`);
	const derived = hd.hdWallet
		.selectAccount(0)
		.selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
		.deriveKeysAt(0);
	if (derived.type !== 'keysDerived') throw new Error('Genesis key derivation failed');
	hd.hdWallet.clear();

	const shieldedSecretKeys = ledgerMod.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
	const dustSecretKey = ledgerMod.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
	const keystore = createKeystore(derived.keys[Roles.NightExternal], MIDNIGHT_NETWORK_ID);

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

	return { facade, shieldedSecretKeys, dustSecretKey, keystore };
}

/** Sends NIGHT from the genesis wallet to `recipientBech32`. Local devnet only. */
export async function fundPlayerFromGenesis(
	recipientBech32: string,
	amountNight: bigint = DEFAULT_AIRDROP_NIGHT
): Promise<{ txId: string }> {
	await setNetworkIdOnce();
	const [{ getNetworkId }, { MidnightBech32m, UnshieldedAddress }, ledgerMod] = await Promise.all([
		loadNetworkId(),
		loadAddressFormat(),
		loadLedger()
	]);
	const recipient = MidnightBech32m.parse(recipientBech32).decode(UnshieldedAddress, getNetworkId());

	const genesis = await buildGenesisFacade();
	try {
		await genesis.facade.waitForSyncedState();

		const ttl = new Date(Date.now() + 10 * 60 * 1000);
		const recipe = await genesis.facade.transferTransaction(
			[
				{
					type: 'unshielded',
					outputs: [{ type: ledgerMod.nativeToken().raw, receiverAddress: recipient, amount: amountNight }]
				}
			],
			{ shieldedSecretKeys: genesis.shieldedSecretKeys, dustSecretKey: genesis.dustSecretKey },
			{ ttl, payFees: true }
		);

		const signed = await genesis.facade.signRecipe(recipe, (data) => genesis.keystore.signData(data));
		const finalized = await genesis.facade.finalizeRecipe(signed);
		const txId = await genesis.facade.submitTransaction(finalized);
		return { txId };
	} finally {
		await genesis.facade.stop();
	}
}
