// Bracket orchestration for Tournament Mode. A bracket stage (a qualifier
// group, or the final) is just a `lobbies` row tagged with tournamentId +
// tournamentStage — join/start/draft/scoring are all the existing lobby
// machinery, unmodified. This file only does the orchestration on top:
// assigning joiners into a filling qualifier group, closing registration,
// and advancing winners into the final once every qualifier has resolved.
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tournaments, lobbies, lobbyParticipants, users } from '$lib/server/schema';

const QUALIFIER_STAGE = 0;
const FINAL_STAGE = 1;

export async function joinTournament(tournamentId: string, userId: string) {
	const tournament = await db
		.select()
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!tournament) return { error: 'not_found' as const };
	if (tournament.status !== 'open') return { error: 'closed' as const };

	// The deadline is enforced here too, not only on read. A tournament nobody
	// has opened since its closing time is still `open` in the database, and
	// without this check a late joiner could slip into a tournament that should
	// already have started or died.
	if (
		tournament.registrationClosesAt &&
		Date.now() >= new Date(tournament.registrationClosesAt).getTime()
	) {
		await evaluateTournament(tournament);
		return { error: 'closed' as const };
	}

	// Already in a group for this tournament? Don't double-assign.
	const existing = await db
		.select({ lobbyId: lobbyParticipants.lobbyId })
		.from(lobbyParticipants)
		.innerJoin(lobbies, eq(lobbies.id, lobbyParticipants.lobbyId))
		.where(and(eq(lobbies.tournamentId, tournamentId), eq(lobbyParticipants.userId, userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (existing) return { lobbyId: existing.lobbyId, alreadyJoined: true };

	const groupSize = tournament.groupSize ?? 4;
	const filling = await db
		.select({
			id: lobbies.id,
			// Hardcoded "lobbies"."id" rather than ${lobbies.id} — this query has
			// only one outer table, and Drizzle only auto-qualifies sql-template
			// column refs when the outer query joins 2+ tables. Left as
			// ${lobbies.id} here, this silently rendered as a bare "id", which
			// inside the subquery resolves to lobby_participants' own id column
			// instead — an always-false correlation, so headcount always read 0
			// and every joiner piled into the same first group regardless of
			// groupSize (same root cause as the /api/tournament/[id] fix).
			headcount: sql<number>`(select count(*) from ${lobbyParticipants} where ${lobbyParticipants.lobbyId} = "lobbies"."id")`
		})
		.from(lobbies)
		.where(
			and(
				eq(lobbies.tournamentId, tournamentId),
				eq(lobbies.tournamentStage, QUALIFIER_STAGE),
				eq(lobbies.status, 'waiting')
			)
		);
	const target = filling.find((f) => f.headcount < groupSize);

	let lobbyId: string;
	if (target) {
		lobbyId = target.id;
	} else {
		const [newLobby] = await db
			.insert(lobbies)
			.values({
				createdBy: userId,
				contestType: tournament.contestType,
				format: 'open',
				size: groupSize,
				status: 'waiting',
				tournamentId,
				tournamentStage: QUALIFIER_STAGE
			})
			.returning();
		lobbyId = newLobby.id;
	}

	await db.insert(lobbyParticipants).values({ lobbyId, userId });
	return { lobbyId };
}

/** Everyone currently signed up across all qualifier groups. */
async function participantCount(tournamentId: string): Promise<number> {
	const rows = await db
		.select({ userId: lobbyParticipants.userId })
		.from(lobbyParticipants)
		.innerJoin(lobbies, eq(lobbies.id, lobbyParticipants.lobbyId))
		.where(eq(lobbies.tournamentId, tournamentId));
	return new Set(rows.map((r) => r.userId)).size;
}

/**
 * Closes registration and STARTS the tournament. Assumes viability has already
 * been checked — call `evaluateTournament` unless the creator is starting early
 * on purpose.
 */
async function startTournament(tournamentId: string) {
	const filling = await db
		.select()
		.from(lobbies)
		.where(
			and(
				eq(lobbies.tournamentId, tournamentId),
				eq(lobbies.tournamentStage, QUALIFIER_STAGE),
				eq(lobbies.status, 'waiting')
			)
		);

	for (const group of filling) {
		const participants = await db
			.select()
			.from(lobbyParticipants)
			.where(eq(lobbyParticipants.lobbyId, group.id));
		if (participants.length >= 2) {
			await db.update(lobbies).set({ status: 'drafting' }).where(eq(lobbies.id, group.id));
		} else {
			// A group that never reached two can't be played — drop it. The player
			// isn't penalised; they simply aren't in a group.
			await db.delete(lobbyParticipants).where(eq(lobbyParticipants.lobbyId, group.id));
			await db.delete(lobbies).where(eq(lobbies.id, group.id));
		}
	}

	await db.update(tournaments).set({ status: 'active' }).where(eq(tournaments.id, tournamentId));
	return { ok: true as const, outcome: 'started' as const };
}

/**
 * Closes registration and CANCELS the tournament — it never ran and nobody won.
 *
 * Distinct from `resolved` on purpose: same timestamp as a start, opposite
 * meaning. Once funding exists this is the branch that must refund every stake,
 * where a start locks them.
 */
async function cancelTournament(tournamentId: string) {
	const groups = await db
		.select()
		.from(lobbies)
		.where(eq(lobbies.tournamentId, tournamentId));

	for (const g of groups) {
		await db.delete(lobbyParticipants).where(eq(lobbyParticipants.lobbyId, g.id));
		await db.delete(lobbies).where(eq(lobbies.id, g.id));
	}

	await db.update(tournaments).set({ status: 'cancelled' }).where(eq(tournaments.id, tournamentId));
	return { ok: true as const, outcome: 'cancelled' as const };
}

/**
 * The scheduled close. One evaluation, two possible outcomes — never both.
 *
 * Called lazily whenever a tournament is read (list or detail), because nothing
 * in the app can act at an arbitrary future moment: the only scheduled job is a
 * once-daily cron, which cannot start a tournament closing at 14:30. This is the
 * same pattern contest resolution already uses, so it needs no new
 * infrastructure. The cron remains a backstop for tournaments nobody opens.
 *
 * No-ops unless the tournament is open and its closing time has passed.
 */
export async function evaluateTournament(tournament: typeof tournaments.$inferSelect) {
	if (tournament.status !== 'open') return { ok: false as const, outcome: 'not_open' as const };
	if (!tournament.registrationClosesAt) {
		// No deadline set — only a manual close can start it.
		return { ok: false as const, outcome: 'no_deadline' as const };
	}
	if (Date.now() < new Date(tournament.registrationClosesAt).getTime()) {
		return { ok: false as const, outcome: 'still_open' as const };
	}

	const joined = await participantCount(tournament.id);
	const minimum = tournament.minPlayers ?? 2;

	return joined >= minimum ? startTournament(tournament.id) : cancelTournament(tournament.id);
}

/**
 * Creator-only manual close — "everyone's here, start now". Overrides the
 * scheduled time rather than replacing it, and still refuses to start a
 * tournament that isn't viable.
 */
export async function closeRegistration(tournamentId: string, userId: string) {
	const tournament = await db
		.select()
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!tournament) return { error: 'not_found' as const };
	if (tournament.createdBy !== userId) return { error: 'forbidden' as const };
	if (tournament.status !== 'open') return { error: 'already_closed' as const };

	const joined = await participantCount(tournamentId);
	const minimum = tournament.minPlayers ?? 2;
	if (joined < minimum) {
		return { error: 'not_enough_players' as const, joined, minimum };
	}

	return startTournament(tournamentId);
}

/**
 * Redistributes a resolved stage's already-awarded XP pool according to the
 * tournament's payout structure, instead of double-paying on top of
 * resolveLobby()'s standard curve. winner_take_all zeroes everyone but rank
 * 1; top3_weighted applies a 30/25/23-style split across ranks 1-3, using
 * the same pool those three already earned under the standard curve.
 */
async function applyPayoutStructure(lobbyId: string, payoutStructure: string) {
	const participants = await db
		.select()
		.from(lobbyParticipants)
		.where(eq(lobbyParticipants.lobbyId, lobbyId));

	const pool = participants.reduce((sum, p) => sum + (p.xpEarned ?? 0), 0);
	const newAmounts = new Map<string, number>();

	if (payoutStructure === 'winner_take_all') {
		for (const p of participants) newAmounts.set(p.userId as string, p.rank === 1 ? pool : 0);
	} else {
		const WEIGHTS: Record<number, number> = { 1: 30, 2: 25, 3: 23 };
		const top3 = participants.filter((p) => (p.rank ?? 99) <= 3);
		const top3Pool = top3.reduce((sum, p) => sum + (p.xpEarned ?? 0), 0);
		const weightSum = top3.reduce((sum, p) => sum + (WEIGHTS[p.rank ?? 0] ?? 0), 0);
		for (const p of participants) {
			if ((p.rank ?? 99) <= 3 && weightSum > 0) {
				newAmounts.set(
					p.userId as string,
					Math.round((top3Pool * (WEIGHTS[p.rank ?? 0] ?? 0)) / weightSum)
				);
			}
		}
	}

	for (const p of participants) {
		const oldXp = p.xpEarned ?? 0;
		const newXp = newAmounts.get(p.userId as string);
		if (newXp === undefined || newXp === oldXp) continue;
		const delta = newXp - oldXp;
		await db.update(lobbyParticipants).set({ xpEarned: newXp }).where(eq(lobbyParticipants.id, p.id));
		const user = await db
			.select()
			.from(users)
			.where(eq(users.id, p.userId as string))
			.limit(1)
			.then((rows) => rows[0] ?? null);
		if (user) {
			await db
				.update(users)
				.set({ xpTotal: (user.xpTotal ?? 0) + delta })
				.where(eq(users.id, p.userId as string));
		}
	}
}

/** Called by resolveLobby() right after it resolves a lobby that belongs to a tournament. */
export async function onLobbyResolved(lobby: {
	id: string;
	tournamentId: string | null;
	tournamentStage: number | null;
}) {
	if (!lobby.tournamentId) return;
	const tournament = await db
		.select()
		.from(tournaments)
		.where(eq(tournaments.id, lobby.tournamentId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!tournament) return;

	if (lobby.tournamentStage === FINAL_STAGE) {
		await applyPayoutStructure(lobby.id, tournament.payoutStructure ?? 'winner_take_all');
		await db.update(tournaments).set({ status: 'resolved' }).where(eq(tournaments.id, tournament.id));
		return;
	}

	const allQualifiers = await db
		.select()
		.from(lobbies)
		.where(and(eq(lobbies.tournamentId, tournament.id), eq(lobbies.tournamentStage, QUALIFIER_STAGE)));

	if (allQualifiers.some((l) => l.status !== 'resolved')) return; // other groups still running

	const winners = allQualifiers.map((l) => l.winnerId).filter((id): id is string => !!id);
	if (winners.length === 0) return;

	if (winners.length === 1) {
		// Only one qualifier group ever formed — its winner is the tournament winner, no final needed.
		await applyPayoutStructure(allQualifiers[0].id, tournament.payoutStructure ?? 'winner_take_all');
		await db.update(tournaments).set({ status: 'resolved' }).where(eq(tournaments.id, tournament.id));
		return;
	}

	const [final] = await db
		.insert(lobbies)
		.values({
			createdBy: tournament.createdBy,
			contestType: tournament.contestType,
			format: 'fixed',
			size: winners.length,
			status: 'drafting',
			tournamentId: tournament.id,
			tournamentStage: FINAL_STAGE
		})
		.returning();

	await db.insert(lobbyParticipants).values(winners.map((userId) => ({ lobbyId: final.id, userId })));
}
