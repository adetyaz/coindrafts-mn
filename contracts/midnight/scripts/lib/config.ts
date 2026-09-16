// Network configuration for the KYC deploy/fund tooling. Supports two
// targets, selected via the MIDNIGHT_NETWORK env var:
//   - 'local' (default): the `undeployed` local devnet via Docker.
//   - 'preview': Midnight's public preview testnet — real node, real
//     indexer. Proof generation is still LOCAL either way (see
//     PROOF_SERVER_URL below): the proof server is a local prover, not a
//     network endpoint, so it doesn't change with the target.
//
// Every existing local-only script (deploy-local.ts, fund-player.ts) does
// not set MIDNIGHT_NETWORK, so TARGET defaults to 'local' and their behavior
// is unchanged. Preview-only tooling (deploy-preview.ts) sets it via its npm
// script (`MIDNIGHT_NETWORK=preview tsx scripts/deploy-preview.ts`).

export type MidnightTarget = 'local' | 'preview';

export const TARGET: MidnightTarget = process.env.MIDNIGHT_NETWORK === 'preview' ? 'preview' : 'local';

export const NETWORK_ID = TARGET === 'preview' ? ('preview' as const) : ('undeployed' as const);

export const NODE_WS_URL =
	TARGET === 'preview' ? 'wss://rpc.preview.midnight.network' : 'ws://127.0.0.1:9944';
export const INDEXER_HTTP_URL =
	TARGET === 'preview'
		? 'https://indexer.preview.midnight.network/api/v4/graphql'
		: 'http://127.0.0.1:8088/api/v4/graphql';
export const INDEXER_WS_URL =
	TARGET === 'preview'
		? 'wss://indexer.preview.midnight.network/api/v4/graphql/ws'
		: 'ws://127.0.0.1:8088/api/v4/graphql/ws';

// The proof server is ALWAYS local — same Docker container used for
// local-devnet work — regardless of which network the node/indexer above
// point at. Verified reachable (or not) independently of TARGET.
export const PROOF_SERVER_URL = 'http://127.0.0.1:6300';

// The local-devnet genesis seed — the `dev` preset pre-mints NIGHT/DUST to
// the wallet derived from this seed. Only meaningful when TARGET === 'local'
// (no such pre-funded genesis wallet exists on preview). NOT a secret in any
// real sense (it's public in every Midnight devnet doc); never use this seed
// anywhere but a throwaway local chain.
export const GENESIS_SEED_HEX =
	'0000000000000000000000000000000000000000000000000000000000000001';

// Forces a non-zero DUST fee. On an idle local devnet the per-block fee rate
// is effectively zero, so with no override the computed fee is 0 and the node
// rejects the tx as NotNormalized (error 117). Kept for preview too as a
// harmless safety margin (it only ever pads the fee upward), even though
// preview's real fee rate shouldn't need it. Only needed for wallets that
// submit transfers or contract calls — NOT for DUST registration, which is
// self-funding.
export const ADDITIONAL_FEE_OVERHEAD = 1_000_000n;
export const FEE_BLOCKS_MARGIN = 5;

// Where the compiled contract's ZK assets (keys/, zkir/) live, relative to
// contracts/midnight/. Same compiled artifacts regardless of target network.
export const ZK_CONFIG_PATH = new URL('../../src/managed/kyc', import.meta.url).pathname;

export const CONTRACT_NAME = 'KycAttestation';

// Local, throwaway state for the Node-side tooling only (deployed contract
// address record, the deployer's own private-state store, and — on preview —
// the persisted preview deployer seed). Never used by the browser app.
export const STATE_DIR = new URL('../../.dapp-state', import.meta.url).pathname;

// Kept separate per target so a local deploy and a preview deploy never
// clobber each other's record.
export const DEPLOYED_CONTRACTS_FILE =
	TARGET === 'preview' ? 'deployed-contracts.preview.json' : 'deployed-contracts.local.json';

// Where a generated/persisted preview deployer seed is cached (throwaway
// testnet-only key material — never committed; .dapp-state/ is gitignored).
export const PREVIEW_DEPLOYER_SEED_FILE = 'preview-deployer.seed';

// Default NIGHT amount handed to a freshly-derived player identity on the
// local devnet. 6 decimal places, so this is 100 NIGHT — comfortably enough
// for DUST registration to yield fees for a handful of submitKyc calls.
// Local-only (there is no genesis-style funder on preview).
export const DEFAULT_PLAYER_AIRDROP = 100_000_000n;
