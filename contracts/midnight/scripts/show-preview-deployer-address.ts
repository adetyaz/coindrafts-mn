#!/usr/bin/env tsx
// Prints the (generated-if-needed, then persisted) preview deployer address,
// plus faucet instructions. Does NOT touch the network or proof server —
// safe to run any time, even before either is reachable.
//
// Usage: MIDNIGHT_NETWORK=preview npm run preview:address

import { TARGET } from './lib/config.js';
import { deployerBech32Address, loadOrCreatePreviewDeployerSeed } from './lib/previewDeployer.js';

if (TARGET !== 'preview') {
	console.error('Set MIDNIGHT_NETWORK=preview (use `npm run preview:address`).');
	process.exit(1);
}

const { seed, isNew } = loadOrCreatePreviewDeployerSeed();
const address = deployerBech32Address(seed);

console.log(isNew ? 'Generated a new preview deployer identity.' : 'Using the existing preview deployer identity.');
console.log(`\n  Address: ${address}\n`);
console.log('This is a HUMAN/BROWSER step — the public faucet is gated by a Cloudflare');
console.log('Turnstile captcha, so it cannot be requested from a script:');
console.log('\n  https://midnight-tmnight-preview.nethermind.dev/\n');
console.log('Paste the address above into the form, solve the captcha, and click "Request tokens".');
console.log('\nOnce funded, run:  MIDNIGHT_NETWORK=preview npm run deploy:preview');
