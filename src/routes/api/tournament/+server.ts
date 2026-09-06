import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { tournaments, lobbies, lobbyParticipants } from '$lib/server/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { evaluateTournament } from '$lib/server/tournament-resolution';

// GET /api/tournament — the public list.
//
// Private tournaments are deliberately absent: they're reached by invite, not by
// browsing, so listing them would defeat the point of the access type.
export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const open = await db
		.select()
		.from(tournaments)
		.where(and(eq(tournaments.accessType, 'public'), eq(tournaments.status, 'open')))
		.orderBy(desc(tournaments.createdAt));

	// Act on any deadline that has passed. This is the list most people land on,
	// so it's the most reliable place for lazy evaluation to happen — a
	// tournament whose time is up either starts or dies here rather than
	// lingering as joinable.
	const stillOpen: typeof open = [];
	for (const t of open) {
		if (t.registrationClosesAt && Date.now() >= new Date(t.registrationClosesAt).getTime()) {
			await evaluateTournament(t);
			continue; // no longer open either way — started or cancelled
		}
		stillOpen.push(t);
	}

	if (stillOpen.length === 0) return json([]);

	// Headcount per tournament in one query rather than per row.
	const ids = stillOpen.map((t) => t.id);
	const counts = await db
		.select({
			tournamentId: lobbies.tournamentId,
			// Distinct users, since a tournament spans several qualifier groups.
			players: sql<number>`count(distinct ${lobbyParticipants.userId})`
		})
		.from(lobbies)
		.innerJoin(lobbyParticipants, eq(lobbyParticipants.lobbyId, lobbies.id))
		.where(inArray(lobbies.tournamentId, ids))
		.groupBy(lobbies.tournamentId);

	const byId = new Map(counts.map((c) => [c.tournamentId, Number(c.players)]));

	return json(
		stillOpen.map((t) => {
			const players = byId.get(t.id) ?? 0;
			const minimum = t.minPlayers ?? 2;
			return {
				id: t.id,
				name: t.name,
				contestType: t.contestType,
				fundingMode: t.fundingMode,
				payoutStructure: t.payoutStructure,
				sectorRestriction: t.sectorRestriction,
				groupSize: t.groupSize,
				minPlayers: minimum,
				players,
				// Surfaced so the list can say "needs 2 more" rather than leaving
				// people to guess whether a tournament will actually run.
				needsMore: Math.max(0, minimum - players),
				registrationClosesAt: t.registrationClosesAt,
				msUntilClose: t.registrationClosesAt
					? Math.max(0, new Date(t.registrationClosesAt).getTime() - Date.now())
					: null,
				isAutoCreated: Boolean(t.isAutoCreated),
				createdAt: t.createdAt
			};
		})
	);
}
