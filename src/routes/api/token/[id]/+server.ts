import { json } from '@sveltejs/kit';
import { getSnapshot, getNews } from '$lib/server/sosovalue';
import { getQuote } from '$lib/server/prices';
import { parseSessionToken } from '$lib/server/auth';

// Detail for one token, for the hover overlay on /draft.
//
// Hover fires far more often than a page load — a player skimming a 179-token
// pool could trigger this dozens of times in seconds. So:
//   • results are cached hard, per token
//   • an in-flight request is shared rather than duplicated
//   • the batch price map is reused (already cached, no upstream call)
// Only the per-token snapshot can cost an upstream request, and only on a miss.
const CACHE_TTL_MS = 60_000;

type Detail = {
	symbol: string;
	price: number | null;
	change24h: number | null;
	volume24h: number | null;
	high24h: number | null;
	low24h: number | null;
	marketcap: number | null;
	rank: number | null;
	ath: number | null;
	downFromAth: number | null;
	news: { title: string; source?: string }[];
};

const cache = new Map<string, { at: number; data: Detail }>();
const inFlight = new Map<string, Promise<Detail>>();

function num(v: unknown): number | null {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

async function build(currencyId: string, symbol: string): Promise<Detail> {
	// Quote comes from the shared batch map — already cached, costs nothing.
	const quote = await getQuote(symbol).catch(() => null);

	// The snapshot is the only call that can hit upstream. Failure degrades the
	// overlay to price-only rather than breaking it.
	let snap: Record<string, unknown> | null = null;
	try {
		snap = (await getSnapshot(currencyId)) as Record<string, unknown>;
	} catch {
		/* price-only overlay */
	}

	// News is shared across all tokens and cached for 15 minutes upstream, so
	// this is effectively free. Filtered to headlines that mention the symbol.
	let news: { title: string; source?: string }[] = [];
	try {
		const raw = (await getNews()) as { title?: string; source?: string }[];
		const needle = symbol.toUpperCase();
		news = (Array.isArray(raw) ? raw : [])
			.filter((n) => (n?.title ?? '').toUpperCase().includes(needle))
			.slice(0, 4)
			.map((n) => ({ title: n.title ?? '', source: n.source }));
	} catch {
		/* no news tab content */
	}

	return {
		symbol: symbol.toUpperCase(),
		price: quote?.price ?? num(snap?.price),
		change24h: quote?.change24h ?? null,
		volume24h: quote?.volume24h ?? num(snap?.turnover_24h),
		high24h: num(snap?.high_24h),
		low24h: num(snap?.low_24h),
		marketcap: num(snap?.marketcap),
		rank: num(snap?.marketcap_rank),
		ath: num(snap?.ath),
		downFromAth: num(snap?.down_from_ath),
		news
	};
}

export async function GET({ params, url, cookies }) {
	const token = cookies.get('session');
	if (!token || !parseSessionToken(token)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const currencyId = params.id;
	const symbol = url.searchParams.get('symbol') ?? '';
	if (!currencyId || !symbol) {
		return json({ error: 'currency id and symbol are required' }, { status: 400 });
	}

	const key = `${currencyId}:${symbol.toUpperCase()}`;

	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return json(hit.data);

	// Share a concurrent build rather than starting a second one — hovering
	// quickly across the same card shouldn't fan out.
	const existing = inFlight.get(key);
	if (existing) return json(await existing);

	const p = build(currencyId, symbol)
		.then((data) => {
			cache.set(key, { at: Date.now(), data });
			return data;
		})
		.finally(() => inFlight.delete(key));

	inFlight.set(key, p);

	try {
		return json(await p);
	} catch (e) {
		console.error('[token detail]', e);
		return json({ error: 'Could not load token detail' }, { status: 502 });
	}
}
