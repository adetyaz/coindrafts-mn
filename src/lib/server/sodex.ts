import { getSnapshot, extractPrice } from './sosovalue';

// SoDEX's "Market Data API" is documented (sodex.com/documentation/market-data-api)
// as pointing at SoSoValue's own API — same base URL, same key. Confirmed live:
// the two previously-guessed SoDEX-specific endpoints (api.sodex.io, and a
// /sodex/price path under openapi.sosovalue.com) don't exist — one is an
// unregistered domain, the other 404s. This just calls the real shared endpoint.
//
// SoDEX also has a separate on-chain Trading API (mainnet-gw.sodex.dev) with its
// own /ticker and /markPrice endpoints for tokens actually listed on its DEX —
// that's a genuinely different data source, but it needs its own SoDEX account
// and EIP712-signed API keys (not a header key like SoSoValue's), which this
// project doesn't have set up. Wiring that up is separate future work.
export async function getSodexPrice(currencyId: string): Promise<number> {
	const snapshot = await getSnapshot(currencyId).catch(() => null);
	return extractPrice(snapshot);
}
