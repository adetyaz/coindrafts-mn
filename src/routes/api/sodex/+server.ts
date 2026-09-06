import { json } from '@sveltejs/kit';
import { getSodexPrice } from '$lib/server/sodex';

// currencyId is SoSoValue's internal id (see /api/tokens), not a ticker symbol —
// the underlying market-snapshot endpoint is keyed by currency_id.
export async function GET({ url }) {
	const currencyId = url.searchParams.get('currencyId');
	if (!currencyId) return json({ error: 'currencyId is required' }, { status: 400 });

	const price = await getSodexPrice(currencyId);
	if (price > 0) {
		return json({ source: 'sodex', currencyId, price });
	}

	return json({ source: 'sodex', currencyId, price: null, error: 'No price available' });
}
