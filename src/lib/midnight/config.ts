// Shared, client-safe constants for the Midnight KYC integration
// (contracts/midnight/src/KycAttestation.compact). Every value here is
// public — safe to import from client code, server code, or both.
//
// Supports two targets, selected via PUBLIC_MIDNIGHT_NETWORK in .env:
//   - 'undeployed' (default): the local devnet, via Lace-free local scripts
//     (see src/lib/midnightWallet.ts for why there's no Lace in this flow).
//   - 'preview': Midnight's public preview testnet — real node, real
//     indexer. Proof generation is still LOCAL either way: the proof server
//     is a local prover, not a network endpoint, so it never changes with
//     the target (see contracts/midnight/scripts/lib/config.ts, which this
//     mirrors on the Node-tooling side).
//
// Defaulting to 'undeployed' keeps local-devnet iteration working exactly as
// before for anyone who hasn't opted in to preview — flipping
// PUBLIC_MIDNIGHT_NETWORK=preview in .env (and restarting the dev server) is
// the only thing that switches targets.
import {
	PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS_LOCAL,
	PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS_PREVIEW,
	PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR,
	PUBLIC_MIDNIGHT_NETWORK
} from '$env/static/public';

export type MidnightNetworkId = 'undeployed' | 'preview';

export const MIDNIGHT_NETWORK_ID: MidnightNetworkId =
	PUBLIC_MIDNIGHT_NETWORK === 'preview' ? 'preview' : 'undeployed';

export const MIDNIGHT_NODE_WS_URL =
	MIDNIGHT_NETWORK_ID === 'preview' ? 'wss://rpc.preview.midnight.network' : 'ws://127.0.0.1:9944';
export const MIDNIGHT_INDEXER_HTTP_URL =
	MIDNIGHT_NETWORK_ID === 'preview'
		? 'https://indexer.preview.midnight.network/api/v4/graphql'
		: 'http://127.0.0.1:8088/api/v4/graphql';
export const MIDNIGHT_INDEXER_WS_URL =
	MIDNIGHT_NETWORK_ID === 'preview'
		? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws'
		: 'ws://127.0.0.1:8088/api/v4/graphql/ws';

// Always local — see the file-level comment above.
export const MIDNIGHT_PROOF_SERVER_URL = 'http://127.0.0.1:6300';

// Forces a non-zero DUST fee — see contracts/midnight/scripts/lib/config.ts
// for the full explanation (idle-devnet zero-fee txs are rejected as
// NotNormalized). Registration itself doesn't need this; contract calls do.
// Harmless on preview too (it only pads the fee upward).
export const MIDNIGHT_ADDITIONAL_FEE_OVERHEAD = 1_000_000n;
export const MIDNIGHT_FEE_BLOCKS_MARGIN = 5;

// Written by `npm run deploy:local` / `npm run deploy:preview`
// (contracts/midnight/scripts/deploy-{local,preview}.ts) into the repo root
// .env, one var per target so switching PUBLIC_MIDNIGHT_NETWORK never loses
// the other target's address. Empty until that target has been deployed.
export const KYC_CONTRACT_ADDRESS =
	(MIDNIGHT_NETWORK_ID === 'preview'
		? PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS_PREVIEW
		: PUBLIC_MIDNIGHT_KYC_CONTRACT_ADDRESS_LOCAL) || '';
export const KYC_ADULT_BIRTH_YEAR_CUTOFF = PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR
	? BigInt(PUBLIC_MIDNIGHT_KYC_CUTOFF_BIRTH_YEAR)
	: null;

export function requireKycContractAddress(): string {
	if (!KYC_CONTRACT_ADDRESS) {
		const cmd = MIDNIGHT_NETWORK_ID === 'preview' ? 'npm run deploy:preview' : 'npm run deploy:local';
		throw new Error(
			`No KYC contract address configured for network "${MIDNIGHT_NETWORK_ID}" — run \`${cmd}\` in contracts/midnight/ first, then restart the dev server.`
		);
	}
	return KYC_CONTRACT_ADDRESS;
}
