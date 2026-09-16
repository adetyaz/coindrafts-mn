#!/usr/bin/env tsx
// Deploys KycAttestation.compact to Midnight's public preview testnet, then
// immediately runs the same submit -> confirm -> independent read-back
// rehearsal as test-full-flow.ts — using the SAME deployer identity as the
// submitting participant, deliberately, so this only requires funding ONE
// address through the faucet's human/captcha step instead of two.
//
// Differences from deploy-local.ts:
//   - No genesis wallet exists on preview. The deployer identity is
//     generated once and persisted locally (lib/previewDeployer.ts); it must
//     be funded via the public faucet (a human/browser step — Cloudflare
//     Turnstile captcha — this script cannot do it for you). Run
//     `npm run preview:address` first to get the address to fund.
//   - Node + indexer are the real public preview network. Proof generation
//     is still LOCAL (same proof server container as local-devnet work) —
//     only the chain endpoints differ.
//
// Usage:
//   npm run preview:address     # get the deployer address, fund it manually
//   npm run deploy:preview      # once funded, deploy + rehearse + verify

import fs from 'node:fs';
import path from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { INDEXER_HTTP_URL, INDEXER_WS_URL, PROOF_SERVER_URL, TARGET } from './lib/config.js';
import { buildFacade } from './lib/wallet.js';
import { createProviders } from './lib/providers.js';
import { deploy, join } from './lib/contract.js';
import { createKycPrivateState, randomBytes32 } from '../src/witnesses/KycWitnesses.js';
import { syncStaticAssets } from './sync-static-assets.js';
import { deployerBech32Address, loadOrCreatePreviewDeployerSeed } from './lib/previewDeployer.js';
import { ledger as decodeLedger, pureCircuits } from '../src/managed/kyc/contract/index.js';

const ROOT_ENV_PATH = new URL('../../../.env', import.meta.url).pathname;
const ADDRESS_ENV_KEY = 'PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS_PREVIEW';
const CUTOFF_ENV_KEY = 'PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR';

function upsertRootEnv(key: string, value: string): void {
	const existing = fs.existsSync(ROOT_ENV_PATH) ? fs.readFileSync(ROOT_ENV_PATH, 'utf-8') : '';
	const line = `${key}=${value}`;
	const pattern = new RegExp(`^${key}=.*$`, 'm');
	const next = pattern.test(existing) ? existing.replace(pattern, line) : `${existing.replace(/\n*$/, '\n')}${line}\n`;
	fs.writeFileSync(ROOT_ENV_PATH, next);
	console.log(`  Wrote ${key} to ${path.relative(process.cwd(), ROOT_ENV_PATH)}`);
}

async function assertProofServerReachable(): Promise<void> {
	try {
		await fetch(PROOF_SERVER_URL, { method: 'GET' });
	} catch (e) {
		throw new Error(
			`Local proof server at ${PROOF_SERVER_URL} is unreachable. Preview deploys still generate ` +
				`proofs locally, so it must be running (the same Docker container used for local-devnet ` +
				`work) before this script can proceed. Underlying error: ${(e as Error).message}`
		);
	}
}

async function main() {
	if (TARGET !== 'preview') {
		throw new Error('Set MIDNIGHT_NETWORK=preview before running this script (use `npm run deploy:preview`).');
	}

	console.log('Checking local proof server...');
	await assertProofServerReachable();
	console.log('  Reachable.');

	const { seed, isNew } = loadOrCreatePreviewDeployerSeed();
	const address = deployerBech32Address(seed);
	console.log(`${isNew ? 'Generated new' : 'Using existing'} preview deployer identity: ${address}`);

	const deployer = await buildFacade(seed, true);
	try {
		console.log('Syncing deployer wallet against the real public preview indexer/node...');
		let syncStart = Date.now();
		let state = await deployer.facade.waitForSyncedState();
		console.log(`  Synced in ${((Date.now() - syncStart) / 1000).toFixed(1)}s`);

		const NIGHT = ledger.nativeToken().raw;
		const nightBalance = state.unshielded.balances[NIGHT] ?? 0n;

		if (nightBalance === 0n) {
			console.log('\nDeployer wallet has 0 NIGHT on preview.');
			console.log('Fund it at the public faucet (human/browser step — cannot be scripted):');
			console.log('\n  https://midnight-tmnight-preview.nethermind.dev/\n');
			console.log(`  Address: ${address}`);
			console.log('Paste the address, solve the Cloudflare Turnstile captcha, click "Request tokens".');
			console.log('Then re-run:  MIDNIGHT_NETWORK=preview npm run deploy:preview');
			process.exit(1);
		}
		console.log(`  NIGHT balance: ${nightBalance}`);

		const nightUtxos = state.unshielded.availableCoins.filter(
			(c) => c.utxo.type === NIGHT && c.meta.registeredForDustGeneration === false
		);
		if (nightUtxos.length > 0) {
			console.log('Registering NIGHT UTXOs for DUST generation...');
			const recipe = await deployer.facade.registerNightUtxosForDustGeneration(
				nightUtxos,
				deployer.keystore.getPublicKey(),
				(payload) => deployer.keystore.signData(payload)
			);
			const finalized = await deployer.facade.finalizeRecipe(recipe);
			await deployer.facade.submitTransaction(finalized);
		} else {
			console.log('NIGHT UTXOs already registered for DUST generation.');
		}

		console.log('Waiting for DUST to accrue...');
		const dustStart = Date.now();
		let dustBalance = 0n;
		while (dustBalance === 0n) {
			if (Date.now() - dustStart > 180_000) {
				throw new Error('Timed out (180s) waiting for DUST to accrue on preview.');
			}
			await new Promise((r) => setTimeout(r, 5000));
			state = await deployer.facade.waitForSyncedState();
			dustBalance = state.dust.balance(new Date());
		}
		console.log(`  DUST balance: ${dustBalance} (took ${((Date.now() - dustStart) / 1000).toFixed(1)}s)`);

		const providers = await createProviders(
			deployer.facade,
			deployer.shieldedSecretKeys,
			deployer.dustSecretKey,
			deployer.keystore,
			'kyc-preview-deployer-private-state'
		);

		const currentYear = new Date().getUTCFullYear();
		const cutoffBirthYear = BigInt(currentYear - 18);
		const deployerPrivateState = createKycPrivateState(
			{ fullName: '', birthYear: 0, country: '' },
			randomBytes32(),
			randomBytes32()
		);

		console.log(`\nDeploying KycAttestation to preview — adultBirthYearCutoff = ${cutoffBirthYear}`);
		console.log('Submitting deploy transaction (real proof generation, real public-network submission)...');
		let start = Date.now();
		const result = await deploy(providers, cutoffBirthYear, deployerPrivateState);
		const deployElapsedSec = ((Date.now() - start) / 1000).toFixed(1);

		console.log('\nDeployed to preview!');
		console.log(`  Contract address: ${result.contractAddress}`);
		console.log(`  Tx id:            ${result.txId}`);
		console.log(`  Block height:     ${result.blockHeight}`);
		console.log(`  Elapsed:          ${deployElapsedSec}s`);

		upsertRootEnv(ADDRESS_ENV_KEY, result.contractAddress);
		upsertRootEnv(CUTOFF_ENV_KEY, cutoffBirthYear.toString());
		syncStaticAssets();

		// ── Full-flow rehearsal: submit real KYC as this same deployer, then
		// independently read it back via a FRESH indexer query — not trusting
		// the call result. Reuses the deployer identity as the participant
		// instead of funding a second one, so the faucet's human step is only
		// needed once. ──
		const domainTag = Buffer.from('coindraft:midnight:kyc-secret:v1');
		const digest = await crypto.subtle.digest('SHA-256', Buffer.concat([domainTag, Buffer.from(seed)]));
		const secretKey = new Uint8Array(digest);
		const salt = crypto.getRandomValues(new Uint8Array(32));
		const identity = { fullName: 'Preview Rehearsal', birthYear: 1990, country: 'Nigeria' };
		const participantPrivateState = createKycPrivateState(identity, secretKey, salt);

		console.log('\nJoining the just-deployed contract as the same identity...');
		const found = await join(providers, result.contractAddress, participantPrivateState);

		console.log('Submitting submitKyc (real proof generation)...');
		start = Date.now();
		const callResult = await found.callTx.submitKyc();
		const submitElapsedSec = ((Date.now() - start) / 1000).toFixed(1);
		console.log(
			`  Submitted! txId=${callResult.public.txId} blockHeight=${callResult.public.blockHeight} elapsed=${submitElapsedSec}s`
		);

		console.log('\nIndependent on-chain read-back via the preview indexer...');
		start = Date.now();
		const publicDataProvider = indexerPublicDataProvider(INDEXER_HTTP_URL, INDEXER_WS_URL);
		const onChainState = await publicDataProvider.queryContractState(result.contractAddress);
		const readElapsedSec = ((Date.now() - start) / 1000).toFixed(1);
		if (!onChainState) throw new Error('queryContractState returned null after a confirmed submission');

		const decoded = decodeLedger(onChainState.data);
		const participantId = pureCircuits.deriveParticipantId(secretKey);
		const submitted = decoded.records.member(participantId);
		const record = submitted ? decoded.records.lookup(participantId) : null;

		console.log(`  participantId:        ${Buffer.from(participantId).toString('hex')}`);
		console.log(`  member:               ${submitted}`);
		console.log(`  isOver18:             ${record?.isOver18}`);
		console.log(`  adultBirthYearCutoff: ${decoded.adultBirthYearCutoff}`);
		console.log(`  submissionCount:      ${decoded.submissionCount}`);
		console.log(`  read-back elapsed:    ${readElapsedSec}s`);

		if (!submitted || record?.isOver18 !== true) {
			throw new Error('FAIL: on-chain record missing or isOver18 not true for a 1990-born identity');
		}

		console.log('\n=== PASS: full deploy -> submit -> independent read-back cycle succeeded on preview. ===');
		console.log(`\nTiming summary: deploy=${deployElapsedSec}s submit=${submitElapsedSec}s read-back=${readElapsedSec}s`);
	} finally {
		await deployer.facade.stop();
	}
}

main().catch((e) => {
	console.error('Preview deploy failed:', e);
	process.exit(1);
});
