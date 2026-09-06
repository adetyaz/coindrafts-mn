import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { tournaments, lobbies, lobbyParticipants } from '$lib/server/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { evaluateTournament } from '$lib/server/tournament-resolution';

// GET /api/tournament/[id] — full detail + its bracket stages, for polling
export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const tournamentId = params.id;
	let tournament = await db
		.select()
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!tournament) return json({ error: 'Tournament not found' }, { status: 404 });

	// Lazily act on the scheduled close. Nothing in the app can fire at an
	// arbitrary future moment — the only cron is daily — so the deadline is
	// evaluated whenever someone reads the tournament. Starts it if it's viable,
	// cancels it permanently if it isn't.
	if (tournament.status === 'open' && tournament.registrationClosesAt) {
		const outcome = await evaluateTournament(tournament);
		if (outcome.ok) {
			tournament = await db
				.select()
				.from(tournaments)
				.where(eq(tournaments.id, tournamentId))
				.limit(1)
				.then((rows) => rows[0] ?? tournament);
		}
	}

	const groups = await db
		.select({
			id: lobbies.id,
			status: lobbies.status,
			tournamentStage: lobbies.tournamentStage,
			size: lobbies.size,
			winnerId: lobbies.winnerId,
			// Written as a raw-qualified reference (not ${lobbies.id}) deliberately —
			// Drizzle only auto-qualifies outer-select columns when the query joins
			// more than one table, and this query doesn't. Without it, ${lobbies.id}
			// renders as a bare "id", which resolves inside the subquery to
			// lobby_participants' own id column instead of the outer lobby's id —
			// an always-false correlation. Found live: headcount silently read 0
			// for a lobby with 2 real participants.
			headcount: sql<number>`(select count(*) from ${lobbyParticipants} where ${lobbyParticipants.lobbyId} = "lobbies"."id")`
		})
		.from(lobbies)
		.where(eq(lobbies.tournamentId, tournamentId));

	// A player who's advanced to the final has rows in both their old
	// (resolved) qualifier lobby and the final — prefer the highest stage so
	// polling clients get redirected to where they actually need to be next,
	// not back to a stage they've already finished.
	const myLobbyId = await db
		.select({ lobbyId: lobbyParticipants.lobbyId })
		.from(lobbyParticipants)
		.innerJoin(lobbies, eq(lobbies.id, lobbyParticipants.lobbyId))
		.where(and(eq(lobbies.tournamentId, tournamentId), eq(lobbyParticipants.userId, parsed.userId)))
		.orderBy(desc(lobbies.tournamentStage))
		.limit(1)
		.then((rows) => rows[0]?.lobbyId ?? null);

	return json({ ...tournament, groups, myLobbyId });
}
