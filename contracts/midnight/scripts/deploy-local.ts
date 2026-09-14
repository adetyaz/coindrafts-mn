#!/usr/bin/env tsx
// Deploys KycAttestation.compact to the local devnet using the genesis
// wallet (seed 0000...0001) as the deployer, then:
//   1. prints the resulting contract address, tx id, and block height
//   2. records it in .dapp-state/deployed-contracts.local.json
//   3. writes PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS into the repo root .env so
//      the SvelteKit app picks it up on next dev-server restart
//
// Usage: npm run deploy:local  (from contracts/midnight/)

import fs from 'node:fs';
import path from 'node:path';
import { GENESIS_SEED_HEX } from './lib/config.js';
import { buildFacade, hexToSeed } from './lib/wallet.js';
import { createProviders } from './lib/providers.js';
import { deploy } from './lib/contract.js';
import { createKycPrivateState, randomBytes32 } from '../src/witnesses/KycWitnesses.js';
import { syncStaticAssets } from './sync-static-assets.js';

const ROOT_ENV_PATH = new URL('../../../.env', import.meta.url).pathname;
const ENV_KEY = 'PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS';

function upsertRootEnv(key: string, value: string): void {
	const existing = fs.existsSync(ROOT_ENV_PATH) ? fs.readFileSync(ROOT_ENV_PATH, 'utf-8') : '';
	const line = `${key}=${value}`;
	const pattern = new RegExp(`^${key}=.*$`, 'm');
	const next = pattern.test(existing)
		? existing.replace(pattern, line)
		: `${existing.replace(/\n*$/, '\n')}${existing ? '' : ''}${line}\n`;
	fs.writeFileSync(ROOT_ENV_PATH, next);
	console.log(`  Wrote ${key} to ${path.relative(process.cwd(), ROOT_ENV_PATH)}`);
}

async function main() {
	const currentYear = new Date().getUTCFullYear();
	const cutoffBirthYear = BigInt(currentYear - 18);
	console.log(`Deploying KycAttestation — adultBirthYearCutoff = ${cutoffBirthYear} (18+ as of ${currentYear})`);

	console.log('Building genesis wallet...');
	const genesis = await buildFacade(hexToSeed(GENESIS_SEED_HEX), true);

	try {
		console.log('Waiting for genesis wallet to sync...');
		await genesis.facade.waitForSyncedState();

		const providers = await createProviders(
			genesis.facade,
			genesis.shieldedSecretKeys,
			genesis.dustSecretKey,
			genesis.keystore,
			'kyc-deployer-private-state'
		);

		// The deployer isn't necessarily a KYC participant — this private state is
		// never used by the constructor (it takes no witness-backed arguments) and
		// exists only to satisfy the framework's storage requirement.
		const deployerPrivateState = createKycPrivateState(
			{ fullName: '', birthYear: 0, country: '' },
			randomBytes32(),
			randomBytes32()
		);

		console.log('Submitting deploy transaction (this generates a real proof — may take 30-90s)...');
		const start = Date.now();
		const result = await deploy(providers, cutoffBirthYear, deployerPrivateState);
		const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

		console.log('\nDeployed!');
		console.log(`  Contract address: ${result.contractAddress}`);
		console.log(`  Tx id:            ${result.txId}`);
		console.log(`  Block height:     ${result.blockHeight}`);
		console.log(`  Elapsed:          ${elapsedSec}s`);

		upsertRootEnv(ENV_KEY, result.contractAddress);
		upsertRootEnv('PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR', cutoffBirthYear.toString());
		syncStaticAssets();
	} finally {
		await genesis.facade.stop();
	}
}

main().catch((e) => {
	console.error('Deploy failed:', e);
	process.exit(1);
});
