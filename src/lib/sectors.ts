// Heuristic sector classifier for news/content that only has a token symbol,
// not an intrinsic sector (CoinDraft's sectors are draft-slot labels, not a
// property tokens carry — there's no canonical token->sector mapping anywhere
// else in the app, so this is a best-effort bucket for browsing, not scoring).

// Widened 2026-08-28. The list was ~40 symbols, sized for a 30-token pool. Once
// the pool grew past 100, 98 of 122 tokens fell through to Wildcard — which
// makes a five-sector draft meaningless, since one slot would hold four-fifths
// of the board. This is also the list that decides which tokens are pulled into
// the pool regardless of market-cap rank, so it's what puts the Solana
// ecosystem (JUP, BONK, WIF, RAY…) in reach: those sit between index 187 and
// 946 of SoSoValue's list and would never survive a top-N slice.
const SECTOR_SYMBOLS: Record<string, string[]> = {
	l1: [
		'BTC', 'ETH', 'SOL', 'ADA', 'AVAX', 'DOT', 'ATOM', 'NEAR', 'APT', 'SUI', 'TON', 'BNB',
		'TRX', 'XLM', 'ALGO', 'EGLD', 'HBAR', 'ICP', 'FTM', 'S', 'KAS', 'INJ', 'SEI', 'TIA',
		'XTZ', 'EOS', 'NEO', 'WAVES', 'ZIL', 'ONE', 'ROSE', 'CELO', 'KAVA', 'FLOW', 'CFX',
		'MINA', 'QNT', 'VET', 'THETA', 'BCH', 'LTC', 'ETC', 'XMR', 'ZEC', 'DASH', 'BSV'
	],
	l2: [
		'ARB', 'OP', 'MATIC', 'POL', 'BASE', 'STRK', 'ZK', 'MNT', 'METIS', 'IMX', 'LRC',
		'SKL', 'BOBA', 'CTSI', 'OMG', 'SCR', 'TAIKO', 'BLAST', 'MANTA', 'ZKJ'
	],
	defi: [
		'UNI', 'AAVE', 'LDO', 'MKR', 'CRV', 'COMP', 'SNX', 'GMX', 'PENDLE', 'STETH', 'SUSHI',
		'CAKE', 'BAL', 'YFI', 'DYDX', 'RUNE', '1INCH', 'ENA', 'ETHFI', 'EIGEN', 'JUP', 'RAY',
		'ORCA', 'JTO', 'DRIFT', 'KMNO', 'RPL', 'FXS', 'SPELL', 'CVX', 'ONDO', 'USUAL', 'MORPHO',
		'AERO', 'VELO', 'QUICK', 'JOE', 'OSMO', 'LQTY', 'ALPHA'
	],
	meme: [
		'DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'MEME', 'POPCAT', 'MEW', 'BOME',
		'BRETT', 'MOG', 'TURBO', 'NEIRO', 'PNUT', 'GOAT', 'ACT', 'CHILLGUY', 'FARTCOIN',
		'SPX', 'WOJAK', 'LADYS', 'BABYDOGE', 'ELON', 'SNEK', 'TRUMP', 'MELANIA'
	],
	// Explicit rather than fall-through: these are real categories the game
	// treats as Wildcard, and naming them keeps genuinely unknown tokens
	// distinguishable from ones deliberately placed here.
	wildcard: [
		'LINK', 'GRT', 'FIL', 'AR', 'RNDR', 'RENDER', 'TAO', 'FET', 'AGIX', 'OCEAN', 'WLD',
		'PYTH', 'API3', 'BAND', 'TRB', 'STORJ', 'AKT', 'HNT', 'IOTA', 'ANKR', 'GLM',
		'W', 'TNSR', 'ZRO', 'AXL', 'CELR', 'ATH', 'IO', 'NOS'
	]
};

/** Every symbol the classifier knows — used to keep sector tokens in the draft pool. */
export const KNOWN_SECTOR_SYMBOLS: string[] = Object.values(SECTOR_SYMBOLS).flat();

/**
 * Never draftable.
 *
 * The game scores on percentage price movement, so a stablecoin is a
 * near-guaranteed zero — it can only ever lose you a slot. Leaving them in the
 * pool meant the top-ranked token by market cap was one of the worst possible
 * picks, and the AI draft agent actually chose one (USDT for a wildcard slot)
 * while charging the player XP for the privilege.
 *
 * Removed pool-wide rather than per-surface, so the draft board, the bots and
 * the agent all see the same list and none of them can pick one.
 */
export const EXCLUDED_SYMBOLS = new Set([
	'USDS',
	'USDT',
	'USDC',
	'DAI',
	'TUSD',
	'FDUSD',
	'USDE',
	'PYUSD',
	'BUSD',
	'USDP',
	'GUSD',
	'LUSD',
	'FRAX',
	'USDD',
	'SUSD',
	'CRVUSD',
	'USD1',
	'RLUSD',
	// Wrapped/staked assets that just track another token already in the pool —
	// they add duplicate exposure rather than a distinct pick.
	'WBTC',
	'WETH',
	'STETH',
	'WSTETH',
	'WEETH',
	'CBBTC'
]);

/** True when a token should never appear in the draft pool. */
export function isExcluded(symbol: string | undefined | null): boolean {
	return EXCLUDED_SYMBOLS.has((symbol ?? '').toUpperCase());
}

const SYMBOL_TO_SECTOR = new Map<string, string>();
for (const [sector, symbols] of Object.entries(SECTOR_SYMBOLS)) {
	for (const s of symbols) SYMBOL_TO_SECTOR.set(s, sector);
}

/** Classifies a set of token symbols into one of the 5 draft sectors, wildcard if unrecognized. */
export function classifySector(symbols: string[]): string {
	for (const s of symbols) {
		const hit = SYMBOL_TO_SECTOR.get(s.toUpperCase());
		if (hit) return hit;
	}
	return 'wildcard';
}
