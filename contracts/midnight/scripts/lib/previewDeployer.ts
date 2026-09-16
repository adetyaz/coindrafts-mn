// Preview-testnet deployer identity: generated once, persisted locally
// (throwaway testnet-only key material — never committed), and reused across
// runs so the same address can be funded once via the public faucet and then
// deployed against repeatedly.
//
// Deriving the address is pure local computation (HD derivation + bech32
// encoding) — it touches neither the node/indexer nor the proof server, so
// this can run and print a fundable address even when neither is reachable.

import fs from 'node:fs';
import path from 'node:path';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NETWORK_ID, PREVIEW_DEPLOYER_SEED_FILE, STATE_DIR } from './config.js';
import { hexToSeed } from './wallet.js';

function seedFilePath(): string {
	return path.join(STATE_DIR, PREVIEW_DEPLOYER_SEED_FILE);
}

/** Loads the persisted preview deployer seed, generating and saving one if none exists yet. */
export function loadOrCreatePreviewDeployerSeed(): { seed: Uint8Array; isNew: boolean } {
	const filePath = seedFilePath();
	if (fs.existsSync(filePath)) {
		const hex = fs.readFileSync(filePath, 'utf-8').trim();
		return { seed: hexToSeed(hex), isNew: false };
	}
	const seed = generateRandomSeed();
	if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
	fs.writeFileSync(filePath, Buffer.from(seed).toString('hex'));
	return { seed, isNew: true };
}

/** Derives the bech32 unshielded address for a seed, without touching the network. */
export function deployerBech32Address(seed: Uint8Array): string {
	setNetworkId(NETWORK_ID);
	const hd = HDWallet.fromSeed(seed);
	if (hd.type !== 'seedOk') {
		throw new Error(`HDWallet.fromSeed failed: ${hd.type}`);
	}
	const derived = hd.hdWallet
		.selectAccount(0)
		.selectRoles([Roles.NightExternal] as const)
		.deriveKeysAt(0);
	if (derived.type !== 'keysDerived') {
		hd.hdWallet.clear();
		throw new Error(`deriveKeysAt failed for roles: ${derived.roles.join(', ')}`);
	}
	const keystore = createKeystore(derived.keys[Roles.NightExternal], NETWORK_ID);
	hd.hdWallet.clear();
	return keystore.getBech32Address().toString();
}
