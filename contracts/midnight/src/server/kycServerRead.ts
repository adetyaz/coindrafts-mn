// Server-side (Node/SvelteKit) KYC read logic, deliberately kept INSIDE this
// package rather than in the app's own src/lib/server/ tree.
//
// Why: this package pins its own toolchain separately from the app's root
// package.json (compiler 0.31.0 -> compact-runtime 0.16.0 — see the repo-root
// AGENTS.md / package.json comments on why that pin is load-bearing). Both
// trees declare the SAME compact-runtime version (0.16.0) and the same
// onchain-runtime-v3 range (^3.0.0), but because this package is not an npm
// workspace, each `npm install` resolved that range independently — the app
// root ended up with onchain-runtime-v3@3.1.1, this package's own
// node_modules ended up with 3.0.0.
//
// Calling `@midnight-ntwrk/midnight-js-indexer-public-data-provider` from the
// app root while decoding the result with THIS package's compiled `ledger()`
// function mixes those two trees: the indexer provider constructs its
// ContractState.data as a `ChargedState` from the root's onchain-runtime-v3
// (3.1.1), but the compiled contract's ledger() function checks it against
// the nested onchain-runtime-v3 (3.0.0)'s own `ChargedState` class — a
// different constructor despite being "the same" version range. That produced
// a hard runtime crash: "expected instance of ChargedState" — reproduced by
// actually running the naive version through the SvelteKit dev server against
// a live local devnet, not assumed.
//
// The fix is this file: both the indexer provider import AND the compiled
// contract import happen from code that physically lives inside
// contracts/midnight/, so Node/Vite's module resolution walks up from *this*
// file's directory and finds contracts/midnight/node_modules first for both —
// guaranteeing they share the same onchain-runtime-v3 instance. See
// src/lib/server/midnightKyc.ts (the app-side caller) for the other half.
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from '../managed/kyc/contract/index.js';

export interface ServerKycStatus {
	readonly submitted: boolean;
	readonly isOver18: boolean;
}

/**
 * Reads real, confirmed on-chain state for the deployed KYC contract for one
 * participant. Returns { submitted: false, isOver18: false } if the contract
 * has no record for this participant. Throws only on a genuine
 * infrastructure failure (indexer unreachable, contract address not found on
 * this network) — callers must treat that the same as "not verified" (fail
 * closed), never as a default-allow.
 */
export async function readKycStatus(
	contractAddress: string,
	participantId: Uint8Array,
	indexerHttpUrl: string,
	indexerWsUrl: string
): Promise<ServerKycStatus> {
	const publicDataProvider = indexerPublicDataProvider(indexerHttpUrl, indexerWsUrl);
	const state = await publicDataProvider.queryContractState(contractAddress);
	if (!state) return { submitted: false, isOver18: false };

	const decoded = ledger(state.data);
	const submitted = decoded.records.member(participantId);
	return {
		submitted,
		isOver18: submitted ? decoded.records.lookup(participantId).isOver18 : false
	};
}
