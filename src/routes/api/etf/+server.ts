import { getEtfHistory } from '$lib/server/sosovalue';
import { detectEtfStreaks } from '$lib/server/scoring';
import { json } from '@sveltejs/kit';

// Primary Bitcoin spot ETF — most liquid, best data coverage
const ETF_SYMBOL = 'IBIT';

export async function GET() {
	try {
		const history = await getEtfHistory(ETF_SYMBOL);
		const alerts = detectEtfStreaks(Array.isArray(history) ? history : []);
		return json({ symbol: ETF_SYMBOL, history, alerts });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error('[/api/etf]', message);
		return json({ symbol: ETF_SYMBOL, history: [], alerts: [], error: message });
	}
}
