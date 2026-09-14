// Node-side wallet construction for the deploy/fund tooling. This mirrors
// src/lib/midnightWallet.ts's browser-side facade construction (same SDK,
// same derivation path) but runs under Node, with a `ws` polyfill and no
// browser storage.
//
// NEVER imported by the SvelteKit app — this is Node-only tooling
// (contracts/midnight/scripts/), run via `npm run deploy:local` / `fund:local`.

import WebSocket from 'ws';
// Required for GraphQL subscriptions under Node — the SDK expects a global
// WebSocket constructor, which browsers provide natively but Node does not.
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import {
	WalletFacade,
	WalletEntrySchema,
	type DefaultConfiguration
} from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
	UnshieldedWallet,
	createKeystore,
	PublicKey,
	type UnshieldedKeystore
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
	ADDITIONAL_FEE_OVERHEAD,
	FEE_BLOCKS_MARGIN,
	INDEXER_HTTP_URL,
	INDEXER_WS_URL,
	NETWORK_ID,
	NODE_WS_URL,
	PROOF_SERVER_URL
} from './config.js';

// Every downstream call (deployContract, findDeployedContract, transaction
// construction) reads the network id via getNetworkId() rather than taking
// it as a parameter — it must be set before any of that runs. Idempotent, so
// safe to call from every entry point that might be the first to touch the
// SDK.
setNetworkId(NETWORK_ID);

export interface WalletContext {
	readonly facade: WalletFacade;
	readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
	readonly dustSecretKey: ledger.DustSecretKey;
	readonly keystore: UnshieldedKeystore;
}

/** Derive the three role keys (Zswap, NightExternal, Dust) from a 32-byte seed. */
export function deriveRoleKeys(seed: Uint8Array): {
	zswap: Uint8Array;
	nightExternal: Uint8Array;
	dust: Uint8Array;
} {
	const hd = HDWallet.fromSeed(seed);
	if (hd.type !== 'seedOk') {
		throw new Error(`HDWallet.fromSeed failed: ${hd.type}`);
	}
	const derived = hd.hdWallet
		.selectAccount(0)
		.selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
		.deriveKeysAt(0);
	if (derived.type !== 'keysDerived') {
		hd.hdWallet.clear();
		throw new Error(`deriveKeysAt failed for roles: ${derived.roles.join(', ')}`);
	}
	hd.hdWallet.clear();
	return {
		zswap: derived.keys[Roles.Zswap],
		nightExternal: derived.keys[Roles.NightExternal],
		dust: derived.keys[Roles.Dust]
	};
}

/**
 * Build and start a WalletFacade from a 32-byte seed, against the local
 * devnet. `withFeeOverhead` should be true for any wallet that submits
 * transfers or contract calls (the genesis sender, a deploying/joining
 * player); DUST registration alone does not need it (it is self-funding).
 */
export async function buildFacade(
	seed: Uint8Array,
	withFeeOverhead: boolean
): Promise<WalletContext> {
	const keys = deriveRoleKeys(seed);

	const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys.zswap);
	const dustSecretKey = ledger.DustSecretKey.fromSeed(keys.dust);
	const keystore = createKeystore(keys.nightExternal, NETWORK_ID);

	const configuration: DefaultConfiguration = {
		networkId: NETWORK_ID,
		costParameters: withFeeOverhead
			? { feeBlocksMargin: FEE_BLOCKS_MARGIN, additionalFeeOverhead: ADDITIONAL_FEE_OVERHEAD }
			: { feeBlocksMargin: FEE_BLOCKS_MARGIN },
		relayURL: new URL(NODE_WS_URL),
		provingServerUrl: new URL(PROOF_SERVER_URL),
		indexerClientConnection: {
			indexerHttpUrl: INDEXER_HTTP_URL,
			indexerWsUrl: INDEXER_WS_URL
		},
		txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema)
	};

	const facade = await WalletFacade.init({
		configuration,
		shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
		unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
		dust: (cfg) =>
			DustWallet(cfg).startWithSecretKey(
				dustSecretKey,
				ledger.LedgerParameters.initialParameters().dust
			)
	});

	await facade.start(shieldedSecretKeys, dustSecretKey);

	return { facade, shieldedSecretKeys, dustSecretKey, keystore };
}

export function hexToSeed(hex: string): Uint8Array {
	const clean = hex.replace(/^0x/, '');
	if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
		throw new Error('Seed must be exactly 64 hex characters (32 bytes).');
	}
	return Uint8Array.from(Buffer.from(clean, 'hex'));
}
