// Batch price source.
//
// Why this exists: SoSoValue has no batch endpoint, so pricing N tokens cost N
// HTTP requests. Thirty in parallel already triggered `402901 Too many
// requests`, which is why the draft pool was capped at 30 tokens — the cap was
// a symptom of the rate limit, not a product decision. It also kept every
// Solana-ecosystem token except SOL out of the game, since they sit between
// index 187 and 946 of SoSoValue's 1,205-token list.
//
// Binance returns every symbol in ONE request. Measured: 3,688 symbols, ~3s,
// request weight 4 against a 6,000/minute budget — roughly 0.07% of the budget
// for the entire market. That removes the cap outright.
//
// Deliberately NOT replacing SoSoValue everywhere: sector spotlight, ETF flows
// and news have no equivalent here and stay exactly as they are.

// /ticker/24hr rather than /ticker/price: it returns price, 24h change AND
// volume for every symbol in the same call. Measured weight 80 against a
// 6,000/minute budget — 1.3% — so keeping the richer payload costs nothing
// meaningful and avoids losing the 24h change the dashboard and ticker rely on.
//
// data-api.binance.vision, NOT api.binance.com: Binance geo-blocks the main
// api.binance.com domain for US-origin requests (HTTP 451) — and Vercel's
// serverless functions run from a US region by default. Worked in local dev
// (a normal residential/office connection isn't blocked) and returned an
// empty token pool in production — every price request failed, got swallowed
// to null by getAllPrices()'s catch, and every token was filtered out for
// having no price. data-api.binance.vision is Binance's own purpose-built,
// unrestricted, no-auth mirror of the public market-data endpoints — same
// response shape, not a workaround.
const BINANCE_TICKER = 'https://data-api.binance.vision/api/v3/ticker/24hr';
const CACHE_TTL_MS = 10_000;
const QUOTE = 'USDT';

export type Quote = { price: number; change24h: number | null; volume24h: number | null };

// Symbols Binance can't price, with a stated reason each. USDT is the quote
// currency so `USDTUSDT` cannot exist; the rest are competitor exchange tokens
// or wrappers Binance doesn't list. CoinGecko covers these — see
// docs-project/price-source-options.md — but until that's wired in they simply
// resolve to null rather than to a wrong number.
export const BINANCE_UNPRICEABLE: Record<string, string> = {
	USDT: 'quote currency',
	USDC: 'stable, quote-adjacent',
	STETH: 'not listed — tracks ETH',
	LEO: 'not listed — Bitfinex token',
	OKB: 'not listed — OKX token'
};

type Cache = { at: number; prices: Map<string, Quote> };
let cache: Cache | null = null;
let inFlight: Promise<Map<string, Quote>> | null = null;

async function fetchAll(): Promise<Map<string, Quote>> {
	const res = await fetch(BINANCE_TICKER);
	if (!res.ok) throw new Error(`binance ticker ${res.status}`);
	const rows = (await res.json()) as {
		symbol: string;
		lastPrice: string;
		priceChangePercent: string;
		quoteVolume: string;
	}[];

	const map = new Map<string, Quote>();
	for (const r of rows) {
		if (!r.symbol.endsWith(QUOTE)) continue;
		const base = r.symbol.slice(0, -QUOTE.length);
		const price = Number(r.lastPrice);
		if (!Number.isFinite(price) || price <= 0) continue;
		const change = Number(r.priceChangePercent);
		const volume = Number(r.quoteVolume);
		map.set(base, {
			price,
			change24h: Number.isFinite(change) ? Number(change.toFixed(2)) : null,
			volume24h: Number.isFinite(volume) ? volume : null
		});
	}
	return map;
}

/**
 * Every quote Binance knows, keyed by bare symbol (`ETH`, not `ETHUSDT`).
 * Cached briefly, and concurrent callers share one in-flight request so a burst
 * of page loads can't fan out into duplicate fetches.
 */
export async function getAllPrices(): Promise<Map<string, Quote>> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.prices;
	if (inFlight) return inFlight;

	inFlight = fetchAll()
		.then((prices) => {
			cache = { at: Date.now(), prices };
			return prices;
		})
		.catch((e) => {
			console.error('[prices] batch fetch failed:', e);
			// Serve the last good map rather than nothing — stale beats blank, and
			// callers that need freshness check `isStale()`.
			if (cache) return cache.prices;
			throw e;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}

/**
 * One symbol's price, or **null** when it genuinely isn't known.
 *
 * Returning null rather than 0 is deliberate and load-bearing: `extractPrice`
 * returns 0 on failure, which scoring reads as `entry -> entry`, i.e. "this
 * token didn't move". That turns an outage into a plausible-looking result.
 * Callers must decide what absence means for them.
 */
export async function getPrice(symbol: string): Promise<number | null> {
	const prices = await getAllPrices().catch(() => null);
	if (!prices) return null;
	return prices.get(symbol.toUpperCase())?.price ?? null;
}

/** Full quote for one symbol, or null when it genuinely isn't known. */
export async function getQuote(symbol: string): Promise<Quote | null> {
	const prices = await getAllPrices().catch(() => null);
	if (!prices) return null;
	return prices.get(symbol.toUpperCase()) ?? null;
}

/** True when the cached map is older than its TTL (or absent entirely). */
export function isStale(): boolean {
	return !cache || Date.now() - cache.at >= CACHE_TTL_MS;
}
