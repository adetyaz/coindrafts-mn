// Server-only. Reads the real, on-chain KYC verification status for a
// Midnight participantId, directly from the indexer for the deployed
// KycAttestation contract — never trusts a client-supplied boolean.
//
// This is the server-side counterpart to $lib/midnight/kyc.ts's
// checkKycVerified(): same decode logic (indexerPublicDataProvider +
// the compiled contract's own `ledger()` function), but runs in the
// SvelteKit server context instead of the browser, and needs no
// wallet/signing dependency at all — queryContractState is a one-shot
// GraphQL read, and decoding it is a pure function over the returned bytes.
//
// The actual indexer-query + ledger-decode logic lives in
// contracts/midnight/src/server/kycServerRead.ts, NOT here — deliberately.
// This app's root package.json and contracts/midnight/'s own package.json
// both depend on @midnight-ntwrk/compact-runtime@0.16.0, but because
// contracts/midnight isn't an npm workspace, each tree resolved that
// package's own onchain-runtime-v3 dependency (range ^3.0.0) independently:
// the app root landed on 3.1.1, contracts/midnight's nested node_modules
// landed on 3.0.0. Calling indexerPublicDataProvider from the app root
// while decoding with the compiled contract's ledger() function mixed those
// two trees and crashed with "expected instance of ChargedState" — a real
// dual-package-instance hazard, confirmed by running the naive version
// through the actual SvelteKit dev server against a live local devnet, not
// assumed from the browser file's shape. Keeping the query+decode call
// together inside contracts/midnight/src/server/kycServerRead.ts pins both
// to the same resolved tree and avoids it. This file is just the app-side
// adapter: turns a stored hex participantId into bytes, supplies this app's
// indexer/contract-address config, and fails closed on any error.
import {
	readKycStatus,
	type ServerKycStatus
} from '../../../contracts/midnight/src/server/kycServerRead';
import {
	MIDNIGHT_INDEXER_HTTP_URL,
	MIDNIGHT_INDEXER_WS_URL,
	requireKycContractAddress
} from '$lib/midnight/config';

export type { ServerKycStatus };

const PARTICIPANT_ID_HEX_RE = /^[0-9a-fA-F]{64}$/;

function hexToParticipantId(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (!PARTICIPANT_ID_HEX_RE.test(clean)) {
		throw new Error('Invalid participantId: expected 64 hex characters (32 bytes).');
	}
	return Uint8Array.from(Buffer.from(clean, 'hex'));
}

/**
 * Reads real, confirmed on-chain state for the fixed deployed KYC contract
 * for one participant. Returns { submitted: false, isOver18: false } if the
 * contract has no record for this participant, or if the read itself fails
 * (bad hex, indexer unreachable, contract not yet deployed) — callers must
 * not treat a thrown-then-caught error path any differently than a genuine
 * "not verified" result.
 */
export async function checkKycVerifiedServer(participantIdHex: string): Promise<ServerKycStatus> {
	const contractAddress = requireKycContractAddress();
	const participantId = hexToParticipantId(participantIdHex);
	return readKycStatus(
		contractAddress,
		participantId,
		MIDNIGHT_INDEXER_HTTP_URL,
		MIDNIGHT_INDEXER_WS_URL
	);
}
