// Local-devnet-only network configuration for the KYC deploy/fund tooling.
//
// Deliberately hardcoded (not read from env) — these scripts only ever target
// the `undeployed` local devnet (see AGENTS.md / task scope: no preview, no
// mainnet). If that ever changes, this is the one place to touch.

export const NETWORK_ID = 'undeployed' as const;

export const NODE_WS_URL = 'ws://127.0.0.1:9944';
export const INDEXER_HTTP_URL = 'http://127.0.0.1:8088/api/v4/graphql';
export const INDEXER_WS_URL = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
export const PROOF_SERVER_URL = 'http://127.0.0.1:6300';

// The local-devnet genesis seed — the `dev` preset pre-mints NIGHT/DUST to the
// wallet derived from this seed. NOT a secret in any real sense (it's public
// in every Midnight devnet doc); never use this seed anywhere but a
// throwaway local chain.
export const GENESIS_SEED_HEX =
	'0000000000000000000000000000000000000000000000000000000000000001';

// Forces a non-zero DUST fee. On an idle local devnet the per-block fee rate
// is effectively zero, so with no override the computed fee is 0 and the node
// rejects the tx as NotNormalized (error 117). Only needed for wallets that
// submit transfers or contract calls — NOT for DUST registration, which is
// self-funding.
export const ADDITIONAL_FEE_OVERHEAD = 1_000_000n;
export const FEE_BLOCKS_MARGIN = 5;

// Where the compiled contract's ZK assets (keys/, zkir/) live, relative to
// contracts/midnight/.
export const ZK_CONFIG_PATH = new URL('../../src/managed/kyc', import.meta.url).pathname;

export const CONTRACT_NAME = 'KycAttestation';

// Local, throwaway state for the Node-side tooling only (deployed contract
// address record, the deployer's own private-state store). Never used by the
// browser app.
export const STATE_DIR = new URL('../../.dapp-state', import.meta.url).pathname;
export const DEPLOYED_CONTRACTS_FILE = 'deployed-contracts.local.json';

// Default NIGHT amount handed to a freshly-derived player identity. 6 decimal
// places, so this is 100 NIGHT — comfortably enough for DUST registration to
// yield fees for a handful of submitKyc calls on a local devnet.
export const DEFAULT_PLAYER_AIRDROP = 100_000_000n;
