#!/usr/bin/env tsx
// Sends NIGHT from the genesis wallet to a player's unshielded address on the
// local devnet. Local-devnet-only — not a real faucet, not for any other
// network. DUST registration is NOT done here: that requires signing with the
// recipient's own keys, so it happens client-side (src/lib/midnightWallet.ts)
// once the NIGHT arrives.
//
// Usage: npm run fund:local -- <bech32-unshielded-address> [amountNight]

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { DEFAULT_PLAYER_AIRDROP, GENESIS_SEED_HEX, NETWORK_ID } from './lib/config.js';
import { buildFacade, hexToSeed } from './lib/wallet.js';

export async function fundPlayer(
	recipientBech32: string,
	amountNight: bigint = DEFAULT_PLAYER_AIRDROP
): Promise<{ txId: string }> {
	setNetworkId(NETWORK_ID);
	const recipient = MidnightBech32m.parse(recipientBech32).decode(UnshieldedAddress, getNetworkId());

	const genesis = await buildFacade(hexToSeed(GENESIS_SEED_HEX), true);
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

		// Unshielded (NIGHT) spends need an explicit signature over the spend,
		// separate from the ZK proof — unlike a pure contract-call balancing,
		// which only spends DUST. See scripts/lib/providers.ts's comment.
		const signed = await genesis.facade.signRecipe(recipe, (data) => genesis.keystore.signData(data));
		const finalized = await genesis.facade.finalizeRecipe(signed);
		const txId = await genesis.facade.submitTransaction(finalized);
		return { txId };
	} finally {
		await genesis.facade.stop();
	}
}

async function main() {
	const [recipientBech32, amountArg] = process.argv.slice(2);
	if (!recipientBech32) {
		console.error('Usage: npm run fund:local -- <bech32-unshielded-address> [amountNight]');
		process.exit(1);
	}
	const amount = amountArg ? BigInt(amountArg) : DEFAULT_PLAYER_AIRDROP;

	console.log(`Funding ${recipientBech32} with ${amount} (smallest units) NIGHT from genesis...`);
	const { txId } = await fundPlayer(recipientBech32, amount);
	console.log(`Submitted: ${txId}`);
}

// Only run as a CLI when invoked directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((e) => {
		console.error('Funding failed:', e);
		process.exit(1);
	});
}
