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

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import {
	WalletFacade,
	WalletEntrySchema,
	type DefaultConfiguration
} from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { UnshieldedWallet, createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import {
	MIDNIGHT_ADDITIONAL_FEE_OVERHEAD,
	MIDNIGHT_FEE_BLOCKS_MARGIN,
	MIDNIGHT_INDEXER_HTTP_URL,
	MIDNIGHT_INDEXER_WS_URL,
	MIDNIGHT_NETWORK_ID,
	MIDNIGHT_NODE_WS_URL,
	MIDNIGHT_PROOF_SERVER_URL
} from '$lib/midnight/config';

const GENESIS_SEED_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const DEFAULT_AIRDROP_NIGHT = 100_000_000n; // 100 NIGHT (6 decimals)

setNetworkId(MIDNIGHT_NETWORK_ID);

function hexToSeed(hex: string): Uint8Array {
	return Uint8Array.from(Buffer.from(hex, 'hex'));
}

async function buildGenesisFacade() {
	const seed = hexToSeed(GENESIS_SEED_HEX);
	const hd = HDWallet.fromSeed(seed);
	if (hd.type !== 'seedOk') throw new Error(`Genesis seed derivation failed: ${hd.type}`);
	const derived = hd.hdWallet
		.selectAccount(0)
		.selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
		.deriveKeysAt(0);
	if (derived.type !== 'keysDerived') throw new Error('Genesis key derivation failed');
	hd.hdWallet.clear();

	const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
	const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
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
			DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust)
	});
	await facade.start(shieldedSecretKeys, dustSecretKey);

	return { facade, shieldedSecretKeys, dustSecretKey, keystore };
}

/** Sends NIGHT from the genesis wallet to `recipientBech32`. Local devnet only. */
export async function fundPlayerFromGenesis(
	recipientBech32: string,
	amountNight: bigint = DEFAULT_AIRDROP_NIGHT
): Promise<{ txId: string }> {
	const recipient = MidnightBech32m.parse(recipientBech32).decode(UnshieldedAddress, getNetworkId());

	const genesis = await buildGenesisFacade();
	try {
		await genesis.facade.waitForSyncedState();

		const ttl = new Date(Date.now() + 10 * 60 * 1000);
		const recipe = await genesis.facade.transferTransaction(
			[
				{
					type: 'unshielded',
					outputs: [{ type: ledger.nativeToken().raw, receiverAddress: recipient, amount: amountNight }]
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
