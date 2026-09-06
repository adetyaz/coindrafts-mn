import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lobbies, tournaments } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

// GET /api/lobby/[id] — basic lobby info, including its tournament's sector
// restriction (if any) so the draft screen can filter the token pool (G-08).
export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const lobbyId = params.id;
	const row = await db
		.select({
			id: lobbies.id,
			contestType: lobbies.contestType,
			tournamentId: lobbies.tournamentId,
			tournamentStage: lobbies.tournamentStage,
			sectorRestriction: tournaments.sectorRestriction
		})
		.from(lobbies)
		.leftJoin(tournaments, eq(tournaments.id, lobbies.tournamentId))
		.where(eq(lobbies.id, lobbyId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!row) return json({ error: 'Lobby not found' }, { status: 404 });
	return json(row);
}
