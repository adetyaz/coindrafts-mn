import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants, lineups, users } from '$lib/server/schema';
import { scoreLineupPicks } from '$lib/server/contest-resolution';
import { onLobbyResolved } from '$lib/server/tournament-resolution';

/**
 * Resolves a live lobby: scores every participant's lineup, ranks them,
 * awards XP on a curve (1st = 250, last = 60, evenly spread, 2x for
 * weekly — continuous with the existing 1v1 win/loss XP numbers), and
 * sets a single winnerId (rank 1) for badge-count compatibility.
 * Idempotent — no-ops if the lobby isn't live. League standings are
 * intentionally not touched here (see plan doc).
 */
export async function resolveLobby(
	lobbyId: string
): Promise<{ resolved: boolean; reason?: string }> {
	const lobby = await db
		.select()
		.from(lobbies)
		.where(eq(lobbies.id, lobbyId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!lobby) return { resolved: false, reason: 'not_found' };
	if (lobby.status !== 'live') return { resolved: false, reason: `status_${lobby.status}` };

	const participants = await db
		.select()
		.from(lobbyParticipants)
		.where(eq(lobbyParticipants.lobbyId, lobbyId));

	if (participants.length < 2) return { resolved: false, reason: 'not_enough_participants' };

	const scored = await Promise.all(
		participants.map(async (p) => {
			const userId = p.userId as string;
			const lineup = await db
				.select()
				.from(lineups)
				.where(and(eq(lineups.lobbyId, lobbyId), eq(lineups.userId, userId)))
				.limit(1)
				.then((rows) => rows[0] ?? null);

			const score = lineup ? await scoreLineupPicks(lineup.id) : 0;
			if (lineup) {
				await db.update(lineups).set({ finalScore: String(score) }).where(eq(lineups.id, lineup.id));
			}
			return { userId, score };
		})
	);

	scored.sort((a, b) => b.score - a.score);

	const n = scored.length;
	const xpMultiplier = lobby.contestType === 'weekly' ? 2 : 1;

	for (let i = 0; i < n; i++) {
		const rank = i + 1;
		const xpEarned =
			n === 1 ? 250 * xpMultiplier : Math.round((60 + 190 * ((n - rank) / (n - 1))) * xpMultiplier);

		await db
			.update(lobbyParticipants)
			.set({ rank, xpEarned })
			.where(and(eq(lobbyParticipants.lobbyId, lobbyId), eq(lobbyParticipants.userId, scored[i].userId)));

		const user = await db
			.select()
			.from(users)
			.where(eq(users.id, scored[i].userId))
			.limit(1)
			.then((rows) => rows[0] ?? null);

		if (user) {
			await db
				.update(users)
				.set({
					xpTotal: (user.xpTotal ?? 0) + xpEarned,
					streak: rank === 1 ? (user.streak ?? 0) + 1 : 0
				})
				.where(eq(users.id, scored[i].userId));
		}
	}

	await db
		.update(lobbies)
		.set({ status: 'resolved', winnerId: scored[0].userId, endAt: new Date() })
		.where(eq(lobbies.id, lobbyId));

	if (lobby.tournamentId) {
		await onLobbyResolved({
			id: lobby.id,
			tournamentId: lobby.tournamentId,
			tournamentStage: lobby.tournamentStage
		});
	}

	return { resolved: true };
}
