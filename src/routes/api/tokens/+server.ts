import { getTokensWithPrices } from '$lib/server/sosovalue';
import { classifySector } from '$lib/sectors';
import { json } from '@sveltejs/kit';

export async function GET({ url }) {
	try {
		const data = await getTokensWithPrices();
		const sector = url.searchParams.get('sector');
		const filtered = sector
			? data.filter((t) => t.symbol && classifySector([t.symbol]) === sector)
			: data;
		return json(filtered);
	} catch (error) {
		console.error('Error fetching tokens:', error);
		return json({ error: 'Failed to fetch tokens' }, { status: 500 });
	}
}
