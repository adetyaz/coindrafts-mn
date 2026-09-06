// Single source of truth for which 0G network (testnet vs mainnet) every
// server-side 0G integration (Chain achievements, Storage, Compute) talks to.
//
// `dev` (from `$app/environment`) is true only under `vite dev` — i.e. `npm
// run dev`, your local machine — and false for any built/deployed instance
// (Vercel preview or production). So: local dev always uses testnet, anything
// deployed always uses mainnet. No manual toggle, no risk of a deployed
// instance quietly still pointed at testnet because someone forgot a flag.
//
// Each *_MAINNET env var mirrors an existing testnet-named one — fill them in
// (see .env's comments) before deploying; this module does the switching, the
// call sites (achievements.ts, gauntlet.ts, aiCompute.ts) don't need to know
// which network they're on.
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

export const ZG_IS_MAINNET = !dev;

export const ZG_CHAIN = {
	rpcUrl: ZG_IS_MAINNET
		? env.ACHIEVEMENTS_RPC_URL_MAINNET || 'https://evmrpc.0g.ai'
		: env.ACHIEVEMENTS_RPC_URL || 'https://evmrpc-testnet.0g.ai',
	contractAddress: ZG_IS_MAINNET ? env.ACHIEVEMENTS_CONTRACT_ADDRESS_MAINNET : env.ACHIEVEMENTS_CONTRACT_ADDRESS
};

export const ZG_STORAGE = {
	// Same wallet signs achievement-claim vouchers too (see achievements.ts) —
	// intentional, mirrors the testnet setup rather than a shortcut.
	privateKey: ZG_IS_MAINNET ? env.ZG_STORAGE_PRIVATE_KEY_MAINNET : env.ZG_STORAGE_PRIVATE_KEY,
	rpcUrl: ZG_IS_MAINNET
		? env.ZG_STORAGE_RPC_URL_MAINNET || 'https://evmrpc.0g.ai'
		: env.ZG_STORAGE_RPC_URL || 'https://evmrpc-testnet.0g.ai',
	indexerUrl: ZG_IS_MAINNET
		? env.ZG_STORAGE_INDEXER_URL_MAINNET
		: env.ZG_STORAGE_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai'
};

export const ZG_COMPUTE = {
	apiKey: ZG_IS_MAINNET ? env.ZG_COMPUTE_API_KEY_MAINNET : env.ZG_COMPUTE_API_KEY,
	baseURL: ZG_IS_MAINNET ? env.ZG_COMPUTE_BASE_URL_MAINNET : env.ZG_COMPUTE_BASE_URL,
	model: ZG_IS_MAINNET ? env.ZG_COMPUTE_MODEL_MAINNET : env.ZG_COMPUTE_MODEL
};
