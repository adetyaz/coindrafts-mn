import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants, lineups, tournaments } from '$lib/server/schema';
import { and, eq, ne, gt, or } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

// A 'waiting' lobby that never filled has no other exit — nothing marks a
// group dead when it doesn't reach its player count, so without a cutoff here
// it surfaces as an "active match to continue" forever. Found live: a lobby
// with 1 of 4 players, sitting untouched for 2.75 days, still nagging its
// creator every time this endpoint was polled. This doesn't fix the deeper
// gap (tournaments/lobbies have no expiry or cancellation path at all — see
// docs-project/whats-next.md), it just stops a dead group from masquerading
// as something to return to.
const STALE_WAITING_MS = 48 * 60 * 60 * 1000;

// GET /api/lobby/mine — active (not resolved) lobbies I'm in, multiplayer
// or a tournament bracket stage. Same purpose as /api/contests already
// serves for 1v1/wager matches: without this there is no way to find your
// way back to an in-progress lobby once you've navigated away.
export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json([]);

	const rows = await db
		.select({
			id: lobbies.id,
			status: lobbies.status,
			contestType: lobbies.contestType,
			tournamentId: lobbies.tournamentId,
			tournamentStage: lobbies.tournamentStage,
			tournamentName: tournaments.name,
			createdAt: lobbies.createdAt
		})
		.from(lobbyParticipants)
		.innerJoin(lobbies, eq(lobbies.id, lobbyParticipants.lobbyId))
		.leftJoin(tournaments, eq(tournaments.id, lobbies.tournamentId))
		.where(
			and(
				eq(lobbyParticipants.userId, parsed.userId),
				ne(lobbies.status, 'resolved'),
				or(
					ne(lobbies.status, 'waiting'),
					gt(lobbies.createdAt, new Date(Date.now() - STALE_WAITING_MS))
				)
			)
		);

	const myLockedLineups = await db
		.select({ lobbyId: lineups.lobbyId })
		.from(lineups)
		.where(and(eq(lineups.userId, parsed.userId), eq(lineups.locked, true)));
	const lockedLobbyIds = new Set(myLockedLineups.map((l) => l.lobbyId));

	return json(rows.map((r) => ({ ...r, myLineupLocked: lockedLobbyIds.has(r.id) })));
}
