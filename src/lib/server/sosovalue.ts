import { SOSOVALUE_API_KEY, SOSOVALUE_BASE_URL } from '$env/static/private';
import { getAllPrices } from '$lib/server/prices';
import { KNOWN_SECTOR_SYMBOLS, isExcluded } from '$lib/sectors';

// Simple in-memory cache (replace with Redis if scaling)
const cache = new Map<string, { data: unknown; expires: number }>();

export async function ssv<T>(
	path: string,
	ttlSeconds: number,
	params?: Record<string, string>
): Promise<T> {
	const url = new URL(SOSOVALUE_BASE_URL + path);
	if (params) {
		Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
	}
	const cacheKey = url.toString();

	// Cache hit
	const hit = cache.get(cacheKey);
	if (hit && hit.expires > Date.now()) {
		return hit.data as T;
	}

	// Fetch with retry on 429
	let attempts = 0;
	while (attempts < 3) {
		const res = await fetch(url.toString(), {
			headers: {
				'x-soso-api-key': SOSOVALUE_API_KEY,
				'Content-Type': 'application/json'
			}
		});

		if (res.status === 429) {
			const body = await res.json().catch(() => ({}));
			// SoSoValue's retry_after (or our own fallback) can be far longer than
			// a page load should ever block for — with getTokensWithPrices firing
			// 30 of these in parallel, an unbounded wait here turned a transient
			// rate limit into multi-minute hangs on /draft. Cap it hard.
			const wait = Math.min((body.details?.retry_after ?? 2) * 1000, 5000);
			await new Promise((r) => setTimeout(r, wait));
			attempts++;
			continue;
		}

		if (!res.ok) {
			const errorBody = await res.text().catch(() => '');
			console.error(`SSV API Error ${res.status} on ${url}:`, errorBody);
			throw new Error(`SSV ${res.status}: ${path} (${errorBody})`);
		}

		const json = await res.json();
		if (json.code !== 0) {
			throw new Error(`SSV error: ${json.message}`);
		}

		// Store in cache
		cache.set(cacheKey, { data: json.data, expires: Date.now() + ttlSeconds * 1000 });
		return json.data as T;
	}

	throw new Error(`SSV rate limit: giving up after 3 attempts on ${path}`);
}

// Pulls a usable USD price out of a market-snapshot response, whichever
// field name the API happens to return it under.
export function extractPrice(snapshot: unknown): number {
	if (!snapshot || typeof snapshot !== 'object') return 0;
	const s = snapshot as Record<string, unknown>;
	const candidates = [
		s?.price,
		s?.current_price,
		s?.close,
		s?.last_price,
		s?.usd_price,
		s?.priceUsd,
		s?.price_usd,
		s?.latestPrice,
		(s?.market_data as Record<string, unknown> | undefined)?.current_price
			? ((s.market_data as Record<string, unknown>).current_price as Record<string, unknown>)?.usd
			: undefined
	];
	for (const value of candidates) {
		const n = Number(value);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return 0;
}

// Named helpers — import these everywhere
export const getTokens = () => ssv('/currencies', 86400); // 24h
export const getSectors = () => ssv('/currencies/sector-spotlight', 300); // 5min
export const getEtfHistory = (symbol: string) =>
	ssv('/etfs/summary-history', 300, { symbol, country_code: 'US' }); // 5min
export const getNews = () => ssv('/news/featured', 900, { pageNum: '1', pageSize: '20' }); // 15min
// 5min, not 60s — this is called up to 30x in parallel per getTokensWithPrices
// refresh (one snapshot request per token); a tight TTL here was the main
// driver of a live SoSoValue rate-limit hit during testing.
export const getSnapshot = (id: string) => ssv(`/currencies/${id}/market-snapshot`, 300);

// Merged token list with live price/change data
// Cached separately for 2 minutes so we don't re-merge on every request
export type TokenWithPrice = {
	currency_id: string;
	symbol?: string;
	name?: string;
	price: number | null;
	change24h: number | null;
	volume24h: number | null;
	rank: number | null;
};

type RawToken = { currency_id: string; symbol?: string; name?: string };

// The draft pool. This used to be 30 because each token cost its own snapshot
// request and thirty in parallel already rate-limited — the cap was a symptom,
// not a choice, and it kept every Solana-ecosystem token except SOL out of the
// game. Priced in one batch call now, so a wider pool costs nothing extra.
const DEFAULT_POOL_SIZE = 150;

export async function getTokensWithPrices(limit = DEFAULT_POOL_SIZE): Promise<TokenWithPrice[]> {
	const cacheKey = `__tokens_prices_${limit}`;
	const hit = cache.get(cacheKey);
	if (hit && hit.expires > Date.now()) return hit.data as TokenWithPrice[];

	const rawTokens = (await getTokens()) as RawToken[];

	// Top-N by market cap, PLUS every token the sector classifier recognises
	// wherever it sits in the list. A pure top-N slice is why the draft board was
	// all majors: the Solana ecosystem (RAY 315, ORCA 406, BONK 441, JTO 595,
	// PYTH 597, WIF 603, JUP 630) all rank below any sane cutoff, so DeFi and
	// Meme slots had almost nothing recognisable to choose from.
	const known = new Set(KNOWN_SECTOR_SYMBOLS);
	const picked = new Map<string, RawToken>();
	for (const t of rawTokens.slice(0, limit)) picked.set(t.currency_id, t);
	for (const t of rawTokens) {
		if (t.symbol && known.has(t.symbol.toUpperCase())) picked.set(t.currency_id, t);
	}
	const top = [...picked.values()];

	// One request for the whole market instead of one per token.
	const batch = await getAllPrices().catch(() => null);

	const merged: TokenWithPrice[] = top.map((t, i) => {
		const symbol = (t.symbol ?? '').toUpperCase();
		const q = batch?.get(symbol) ?? null;
		return {
			currency_id: t.currency_id,
			symbol: t.symbol,
			name: t.name,
			price: q?.price ?? null,
			change24h: q?.change24h ?? null,
			volume24h: q?.volume24h ?? null,
			// SoSoValue orders /currencies by market cap, so list position is the
			// rank — previously this came from a per-token snapshot we no longer make.
			rank: i + 1
		};
	});

	// Only tokens we can actually price are draftable — a token with no price
	// can't be scored, so offering it would create a lineup slot that resolves
	// to nothing. Stablecoins and wrapped duplicates are excluded outright: the
	// game scores on price movement, so they're guaranteed-zero picks (see
	// EXCLUDED_SYMBOLS). Filtered here so every surface — draft board, bots and
	// the AI agent — inherits the same pool.
	const priceable = merged.filter((t) => t.price != null && !isExcluded(t.symbol));

	// Shorter TTL than before: the batch is cheap, so freshness costs little.
	cache.set(cacheKey, { data: priceable, expires: Date.now() + 60_000 });
	return priceable;
}
