// Shared, client-safe constants for the Midnight KYC integration
// (contracts/midnight/src/KycAttestation.compact). Every value here is
// public — safe to import from client code, server code, or both.
//
// LOCAL DEVNET ONLY, deliberately. This whole integration targets the
// `undeployed` network exclusively — not preview, not mainnet — so the
// endpoints are plain constants rather than something Lace's
// getConfiguration() would hand us (there is no Lace in this flow; see
// src/lib/midnightWallet.ts for why).
import { PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS, PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR } from '$env/static/public';

export const MIDNIGHT_NETWORK_ID = 'undeployed' as const;

export const MIDNIGHT_NODE_WS_URL = 'ws://127.0.0.1:9944';
export const MIDNIGHT_INDEXER_HTTP_URL = 'http://127.0.0.1:8088/api/v4/graphql';
export const MIDNIGHT_INDEXER_WS_URL = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
export const MIDNIGHT_PROOF_SERVER_URL = 'http://127.0.0.1:6300';

// Forces a non-zero DUST fee — see contracts/midnight/scripts/lib/config.ts
// for the full explanation (idle-devnet zero-fee txs are rejected as
// NotNormalized). Registration itself doesn't need this; contract calls do.
export const MIDNIGHT_ADDITIONAL_FEE_OVERHEAD = 1_000_000n;
export const MIDNIGHT_FEE_BLOCKS_MARGIN = 5;

// Written by `npm run deploy:local` (contracts/midnight/scripts/deploy-local.ts)
// into the repo root .env. Empty until a deploy has happened.
export const KYC_CONTRACT_ADDRESS = PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS || '';
export const KYC_ADULT_BIRTH_YEAR_CUTOFF = PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR
	? BigInt(PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR)
	: null;

export function requireKycContractAddress(): string {
	if (!KYC_CONTRACT_ADDRESS) {
		throw new Error(
			'PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS is not set — run `npm run deploy:local` in contracts/midnight/ first, then restart the dev server.'
		);
	}
	return KYC_CONTRACT_ADDRESS;
}
