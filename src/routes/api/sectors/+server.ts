import { getSectors } from '$lib/server/sosovalue';
import { json } from '@sveltejs/kit';

// Map SoSoValue sector names → our game sector IDs
const SECTOR_MAP: Record<string, string> = {
	layer1: 'l1',
	l1: 'l1',
	layer2: 'l2',
	l2: 'l2',
	defi: 'defi',
	meme: 'meme',
	ai: 'wildcard',
	gamefi: 'wildcard',
	nft: 'wildcard',
	rwa: 'wildcard',
	depin: 'wildcard',
	socialfi: 'wildcard',
	payfi: 'wildcard'
};

const GAME_SECTORS = [
	{ id: 'l1', name: 'L1' },
	{ id: 'l2', name: 'L2' },
	{ id: 'defi', name: 'DeFi' },
	{ id: 'meme', name: 'Meme' },
	{ id: 'wildcard', name: 'Wildcard' }
];

export async function GET() {
	try {
		const raw = (await getSectors()) as {
			sector?: Array<{ name: string; change_pct_24h: number }>;
			spotlight?: Array<{ name: string; change_pct_24h: number }>;
		};

		const changeByGameId = new Map<string, number>();

		for (const item of raw?.sector ?? []) {
			const key = item.name?.toLowerCase().trim();
			const gameId = SECTOR_MAP[key];
			if (gameId && !changeByGameId.has(gameId)) {
				// Values are fractions (0.0096 = 0.96%) — convert to percentage
				changeByGameId.set(gameId, Number((item.change_pct_24h * 100).toFixed(2)));
			}
		}

		// Wildcard fallback: use top spotlight item
		if (!changeByGameId.has('wildcard')) {
			const top = raw?.spotlight?.[0];
			if (top) {
				changeByGameId.set('wildcard', Number((top.change_pct_24h * 100).toFixed(2)));
			}
		}

		return json(
			GAME_SECTORS.map((s) => ({
				...s,
				change: changeByGameId.get(s.id) ?? null
			}))
		);
	} catch (error) {
		console.error('Error fetching sectors:', error);
		return json(GAME_SECTORS.map((s) => ({ ...s, change: null })));
	}
}
