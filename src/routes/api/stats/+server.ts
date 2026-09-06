import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users, contests } from '$lib/server/schema';
import { count, or, eq } from 'drizzle-orm';

// Public — the landing page reads this before anyone signs in. Returns only
// aggregate counts, never rows, so there's nothing here a signed-out visitor
// shouldn't see. Replaces the fabricated "30,811 players / 1,204 contests"
// figures that were previously hardcoded into the page.
export async function GET() {
	try {
		const [playerRow, liveRow, resolvedRow] = await Promise.all([
			db.select({ n: count() }).from(users),
			db
				.select({ n: count() })
				.from(contests)
				.where(or(eq(contests.status, 'open'), eq(contests.status, 'live'))),
			db.select({ n: count() }).from(contests).where(eq(contests.status, 'resolved'))
		]);

		return json({
			players: playerRow[0]?.n ?? 0,
			liveContests: liveRow[0]?.n ?? 0,
			resolvedContests: resolvedRow[0]?.n ?? 0
		});
	} catch (error) {
		console.error('[stats] failed:', error);
		// The page renders a dash rather than a number when this happens — an
		// unavailable stat must never fall back to an invented one.
		return json({ error: 'unavailable' }, { status: 503 });
	}
}
