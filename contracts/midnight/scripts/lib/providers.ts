// The 6-provider assembly for the Node-side deploy/fund tooling. Mirrors
// src/lib/midnightWallet.ts's browser provider assembly, but uses
// NodeZkConfigProvider (filesystem) and a LevelDB private-state store instead
// of FetchZkConfigProvider / an in-memory Map.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import type { ContractProviders } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as Rx from 'rxjs';
import { INDEXER_HTTP_URL, INDEXER_WS_URL, PROOF_SERVER_URL, STATE_DIR, ZK_CONFIG_PATH } from './config.js';
import type { KycContract } from './contract.js';

export type Providers = ContractProviders<KycContract>;

export async function createWalletProvider(
	facade: WalletFacade,
	shieldedSecretKeys: ledger.ZswapSecretKeys,
	dustSecretKey: ledger.DustSecretKey
): Promise<WalletProvider & MidnightProvider> {
	const state = await Rx.firstValueFrom(facade.state().pipe(Rx.filter((s) => s.isSynced)));
	const coinPublicKey = state.shielded.coinPublicKey.toHexString();
	const encryptionPublicKey = state.shielded.encryptionPublicKey.toHexString();

	// Contract-call balancing spends DUST (proven via ZK), not unshielded NIGHT
	// UTXOs — no separate unshielded signature step is needed here (unlike a
	// direct NIGHT transfer; see scripts/lib/funding.ts).
	return {
		getCoinPublicKey: () => coinPublicKey,
		getEncryptionPublicKey: () => encryptionPublicKey,
		async balanceTx(tx, ttl) {
			const recipe = await facade.balanceUnboundTransaction(
				tx,
				{ shieldedSecretKeys, dustSecretKey },
				{ ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) }
			);
			return facade.finalizeRecipe(recipe);
		},
		submitTx: (tx) => facade.submitTransaction(tx)
	};
}

export async function createProviders(
	facade: WalletFacade,
	shieldedSecretKeys: ledger.ZswapSecretKeys,
	dustSecretKey: ledger.DustSecretKey,
	keystore: UnshieldedKeystore,
	privateStateStoreName: string
): Promise<Providers> {
	const walletProvider = await createWalletProvider(facade, shieldedSecretKeys, dustSecretKey);

	const zkConfigProvider = new NodeZkConfigProvider<ProvableCircuitId<KycContract>>(ZK_CONFIG_PATH);

	return {
		privateStateProvider: levelPrivateStateProvider({
			privateStateStoreName,
			// Local-devnet-only throwaway store — a fixed dev password is fine.
			// Needs 3+ of {upper, lower, digit, special} — a throwaway local-devnet
			// constant is fine here, but it still has to clear that bar.
			privateStoragePasswordProvider: () => 'Midnight-Local-Devnet!2026',
			accountId: keystore.getBech32Address().toString()
		}),
		publicDataProvider: indexerPublicDataProvider(INDEXER_HTTP_URL, INDEXER_WS_URL),
		zkConfigProvider,
		proofProvider: httpClientProofProvider(PROOF_SERVER_URL, zkConfigProvider),
		walletProvider,
		midnightProvider: walletProvider
	};
}

export { STATE_DIR };
