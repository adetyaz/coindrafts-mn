// src/lib/tokenRegistry.ts
// Hardcoded draft pool for Wave 1
// Populate currency_id values after calling GET /currencies once

export const SECTORS = ['L1', 'L2', 'Meme', 'DeFi', 'Wildcard'] as const;
export type Sector = (typeof SECTORS)[number];

export const DRAFT_POOL: Record<Sector, { symbol: string; name: string; currency_id: string }[]> = {
	L1: [
		{ symbol: 'SOL', name: 'Solana', currency_id: '' },
		{ symbol: 'AVAX', name: 'Avalanche', currency_id: '' },
		{ symbol: 'SUI', name: 'Sui', currency_id: '' },
		{ symbol: 'ADA', name: 'Cardano', currency_id: '' },
		{ symbol: 'DOT', name: 'Polkadot', currency_id: '' }
	],
	L2: [
		{ symbol: 'ARB', name: 'Arbitrum', currency_id: '' },
		{ symbol: 'OP', name: 'Optimism', currency_id: '' },
		{ symbol: 'MATIC', name: 'Polygon', currency_id: '' },
		{ symbol: 'STRK', name: 'Starknet', currency_id: '' },
		{ symbol: 'ZK', name: 'zkSync', currency_id: '' }
	],
	Meme: [
		{ symbol: 'DOGE', name: 'Dogecoin', currency_id: '' },
		{ symbol: 'SHIB', name: 'Shiba Inu', currency_id: '' },
		{ symbol: 'PEPE', name: 'Pepe', currency_id: '' },
		{ symbol: 'WIF', name: 'dogwifhat', currency_id: '' },
		{ symbol: 'BONK', name: 'Bonk', currency_id: '' }
	],
	DeFi: [
		{ symbol: 'AAVE', name: 'Aave', currency_id: '' },
		{ symbol: 'UNI', name: 'Uniswap', currency_id: '' },
		{ symbol: 'CRV', name: 'Curve', currency_id: '' },
		{ symbol: 'JUP', name: 'Jupiter', currency_id: '' },
		{ symbol: 'PENDLE', name: 'Pendle', currency_id: '' }
	],
	Wildcard: [
		{ symbol: 'TAO', name: 'Bittensor', currency_id: '' },
		{ symbol: 'RENDER', name: 'Render', currency_id: '' },
		{ symbol: 'INJ', name: 'Injective', currency_id: '' },
		{ symbol: 'SEI', name: 'Sei', currency_id: '' },
		{ symbol: 'TIA', name: 'Celestia', currency_id: '' }
	]
};

// Helper to get all tokens in the pool
export function getAllDraftTokens() {
	const all: any[] = [];
	SECTORS.forEach((sector) => {
		DRAFT_POOL[sector].forEach((token) => {
			all.push({ ...token, sector });
		});
	});
	return all;
}
