#!/usr/bin/env tsx
// Copies the compiled contract's ZK artifacts (keys/, zkir/) into the
// SvelteKit app's static/ folder, where src/lib/midnight/kyc.ts's
// FetchZkConfigProvider expects to find them (it fetches
// {origin}/keys/{circuitId}.{prover,verifier} and {origin}/zkir/{circuitId}.bzkir
// — see @midnight-ntwrk/midnight-js-fetch-zk-config-provider). Run this any
// time the contract is recompiled (keys/zkir content changes with the
// circuit). Deploying (npm run deploy:local) runs this automatically.

import fs from 'node:fs';
import path from 'node:path';

const MANAGED_DIR = new URL('../src/managed/kyc', import.meta.url).pathname;
const STATIC_DIR = new URL('../../../static', import.meta.url).pathname;

function copyDir(name: 'keys' | 'zkir') {
	const src = path.join(MANAGED_DIR, name);
	const dest = path.join(STATIC_DIR, name);
	fs.mkdirSync(dest, { recursive: true });
	for (const file of fs.readdirSync(src)) {
		fs.copyFileSync(path.join(src, file), path.join(dest, file));
	}
}

export function syncStaticAssets(): void {
	copyDir('keys');
	copyDir('zkir');
	console.log(`  Synced keys/ and zkir/ to ${path.relative(process.cwd(), STATIC_DIR)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	syncStaticAssets();
}
