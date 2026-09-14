#!/usr/bin/env tsx
// End-to-end rehearsal of the exact submit/read mechanics the browser app
// (src/lib/midnight/kyc.ts) uses — same packages, same pinned versions, same
// CompiledContract binding — but driven from Node with a throwaway seed
// instead of a wallet signature (the one piece this script doesn't exercise;
// that's thin glue code — see midnightWallet.ts's signWithConnectedWallet).
//
// Real fund -> real DUST registration -> real submitKyc (real proof) -> real
// on-chain read-back via the indexer. Not a simulation.

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { buildFacade } from './lib/wallet.js';
import { createProviders } from './lib/providers.js';
import { join, loadDeployedContracts } from './lib/contract.js';
import { fundPlayer } from './fund-player.js';
import { createKycPrivateState } from '../src/witnesses/KycWitnesses.js';
import { ledger as decodeLedger, pureCircuits } from '../src/managed/kyc/contract/index.js';
import { INDEXER_HTTP_URL, INDEXER_WS_URL } from './lib/config.js';

async function main() {
	const contracts = loadDeployedContracts();
	const contractAddress = contracts.KycAttestation?.address;
	if (!contractAddress) {
		throw new Error('No deployed KycAttestation found — run `npm run deploy:local` first.');
	}
	console.log(`Target contract: ${contractAddress}`);

	// ── A throwaway "player" identity — stands in for a wallet-derived seed ──
	const seed = generateRandomSeed();
	const hd = HDWallet.fromSeed(seed);
	if (hd.type !== 'seedOk') throw new Error('seed derivation failed');
	const roleKeys = hd.hdWallet
		.selectAccount(0)
		.selectRoles([Roles.NightExternal] as const)
		.deriveKeysAt(0);
	if (roleKeys.type !== 'keysDerived') throw new Error('role key derivation failed');
	hd.hdWallet.clear();

	const player = await buildFacade(seed, true);
	const playerBech32 = player.keystore.getBech32Address().toString();
	console.log(`Player address: ${playerBech32}`);

	try {
		console.log('Syncing player wallet...');
		await player.facade.waitForSyncedState();

		// ── Fund from genesis (mirrors the dev-only /api/dev/midnight-fund route) ──
		console.log('Funding from genesis...');
		await fundPlayer(playerBech32);

		console.log('Waiting for funds to arrive...');
		let state = await player.facade.waitForSyncedState();
		const NIGHT = ledger.nativeToken().raw;
		const start = Date.now();
		while ((state.unshielded.balances[NIGHT] ?? 0n) === 0n) {
			if (Date.now() - start > 90_000) throw new Error('Timed out waiting for funds');
			await new Promise((r) => setTimeout(r, 3000));
			state = await player.facade.waitForSyncedState();
		}
		console.log(`  NIGHT balance: ${state.unshielded.balances[NIGHT]}`);

		// ── Register for DUST generation ──
		console.log('Registering for DUST generation...');
		const nightUtxos = state.unshielded.availableCoins.filter(
			(c) => c.utxo.type === NIGHT && c.meta.registeredForDustGeneration === false
		);
		const recipe = await player.facade.registerNightUtxosForDustGeneration(
			nightUtxos,
			player.keystore.getPublicKey(),
			(payload) => player.keystore.signData(payload)
		);
		const finalizedReg = await player.facade.finalizeRecipe(recipe);
		await player.facade.submitTransaction(finalizedReg);

		console.log('Waiting for DUST to accrue...');
		const dustStart = Date.now();
		let dustBalance = 0n;
		while (dustBalance === 0n) {
			if (Date.now() - dustStart > 120_000) throw new Error('Timed out waiting for DUST');
			await new Promise((r) => setTimeout(r, 5000));
			const s = await player.facade.waitForSyncedState();
			dustBalance = s.dust.balance(new Date());
		}
		console.log(`  DUST balance: ${dustBalance} (took ${((Date.now() - dustStart) / 1000).toFixed(1)}s)`);

		// ── Real submitKyc ──
		// Same domain-separated derivation as midnightWallet.ts's
		// kycSecretKeyFromSeed(), applied to this script's throwaway seed.
		const domainTag = Buffer.from('coindraft:midnight:kyc-secret:v1');
		const digest = await crypto.subtle.digest('SHA-256', Buffer.concat([domainTag, Buffer.from(seed)]));
		const secretKey = new Uint8Array(digest);
		const salt = crypto.getRandomValues(new Uint8Array(32));
		const identity = { fullName: 'Full Flow Test', birthYear: 1990, country: 'Nigeria' };
		const privateState = createKycPrivateState(identity, secretKey, salt);

		const providers = await createProviders(
			player.facade,
			player.shieldedSecretKeys,
			player.dustSecretKey,
			player.keystore,
			'kyc-fullflow-private-state'
		);

		console.log('Joining deployed contract...');
		const found = await join(providers, contractAddress, privateState);

		console.log('Submitting submitKyc (real proof generation)...');
		const submitStart = Date.now();
		const callResult = await found.callTx.submitKyc();
		const submitElapsed = ((Date.now() - submitStart) / 1000).toFixed(1);
		console.log(`  Submitted! txId=${callResult.public.txId} blockHeight=${callResult.public.blockHeight} elapsed=${submitElapsed}s`);

		// ── Independent on-chain read-back via the indexer (not trusting the call result) ──
		const participantId = pureCircuits.deriveParticipantId(secretKey);
		const publicDataProvider = indexerPublicDataProvider(INDEXER_HTTP_URL, INDEXER_WS_URL);
		const onChainState = await publicDataProvider.queryContractState(contractAddress);
		if (!onChainState) throw new Error('queryContractState returned null after a confirmed submission');
		const decoded = decodeLedger(onChainState.data);
		const submitted = decoded.records.member(participantId);
		const record = submitted ? decoded.records.lookup(participantId) : null;

		console.log('\n── Independent on-chain read-back ──');
		console.log(`  participantId:   ${Buffer.from(participantId).toString('hex')}`);
		console.log(`  member:          ${submitted}`);
		console.log(`  isOver18:        ${record?.isOver18}`);
		console.log(`  adultBirthYearCutoff: ${decoded.adultBirthYearCutoff}`);
		console.log(`  submissionCount: ${decoded.submissionCount}`);

		if (!submitted || record?.isOver18 !== true) {
			throw new Error('FAIL: on-chain record missing or isOver18 not true for a 1990-born identity');
		}
		console.log('\nPASS: full submit -> confirm -> independent read-back cycle succeeded.');
	} finally {
		await player.facade.stop();
	}
}

main().catch((e) => {
	console.error('test-full-flow failed:', e);
	process.exit(1);
});
