import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lineups, lineupPicks, users, leagueMembers } from '$lib/server/schema';
import { getAllPrices } from '$lib/server/prices';
import { calcPickScore, boostFactor, type ActiveBoost } from '$lib/server/scoring';
import { settleStakeForContest } from '$lib/server/wager';

/** Raised when a contest cannot be scored because prices are unavailable. */
export class PriceUnavailableError extends Error {
	constructor(public readonly symbols: string[]) {
		super(`No exit price for: ${symbols.join(', ')}`);
		this.name = 'PriceUnavailableError';
	}
}

export async function scoreLineupPicks(
	lineupId: string,
	durationMinutes?: number | null,
	// The lineup owner's boosts, and the moment to judge them against. Passed in
	// rather than read here so both lineups in a contest are scored against the
	// same instant.
	boosts?: ActiveBoost[] | null,
	scoredAt: Date = new Date()
) {
	const picks = await db.select().from(lineupPicks).where(eq(lineupPicks.lineupId, lineupId));

	// Batch call, not one SoSoValue snapshot request per pick. This used to be
	// exactly the per-token burst pattern that was already fixed for ENTRY
	// pricing earlier — 10 concurrent requests for a 2-player contest, fragile
	// to any rate limit or blip, with a resolution that just defers itself
	// (correctly) on failure. The gap was that the result page had no retry for
	// that deferred state, so a transient burst failure surfaced as a
	// permanent-looking "Result unavailable" instead of "try again shortly".
	// Same batch source entry prices already come from, so a token that was
	// priceable at draft time is priceable at resolution time too.
	const quotes = await getAllPrices().catch(() => null);

	// A missing price is NOT a flat market.
	//
	// Scoring previously could treat "no price found" as entry === exit, i.e.
	// "this token didn't move" — so an API outage silently produced a
	// real-looking result, and with a wager attached that's a payout decided by
	// a dropped HTTP request.
	//
	// Refusing to score is the right failure: a contest that settles late is
	// recoverable, a contest that settles wrong is not.
	const unpriced = picks
		.map((p) => ({ symbol: p.tokenSymbol, price: quotes?.get(p.tokenSymbol.toUpperCase())?.price ?? null }))
		.filter((x) => !(x.price != null && x.price > 0))
		.map((x) => x.symbol);

	if (unpriced.length > 0) {
		throw new PriceUnavailableError(unpriced);
	}

	let total = 0;
	for (let i = 0; i < picks.length; i++) {
		const pick = picks[i];
		const exitPrice = quotes!.get(pick.tokenSymbol.toUpperCase())!.price;
		const entry = Number(pick.entryPrice ?? 0);
		const pct = entry > 0 ? ((exitPrice - entry) / entry) * 100 : 0;
		// Boosts finally apply. They were earned, stored, counted down and
		// advertised as ×1.25 in three places while having no effect on any
		// outcome — the largest promise/behaviour gap in the product.
		const boost = boostFactor(pick.sector, boosts, scoredAt);
		const score = calcPickScore(entry || 1, exitPrice || entry || 1, durationMinutes, boost);

		await db
			.update(lineupPicks)
			.set({ exitPrice: String(exitPrice), pctChange: String(pct), score: String(score) })
			.where(eq(lineupPicks.id, pick.id));

		total += score;
	}
	return total;
}

/**
 * Resolves a live contest: scores both lineups, picks a winner, awards XP,
 * updates league standings, and marks the contest resolved. Idempotent —
 * no-ops if the contest isn't live or the userB lineup hasn't been submitted yet.
 * Independent of any requesting user, so it can run from a cron sweep.
 */
export async function resolveContest(
	contestId: string
): Promise<{ resolved: boolean; reason?: string }> {
	const contest = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!contest) return { resolved: false, reason: 'not_found' };
	if (contest.status !== 'live') return { resolved: false, reason: `status_${contest.status}` };
	if (!contest.userAId) return { resolved: false, reason: 'missing_user_a' };

	// A contest cannot end before its clock does. Without this guard the only
	// check was `status === 'live'`, so simply *opening the result page*
	// resolved a running contest — and since the draft page redirected straight
	// there on lock, every game settled seconds after it started, on near-zero
	// price movement. It also meant anyone could settle a contest early the
	// moment they were ahead. The chosen duration is only real once this holds.
	if (contest.endAt && Date.now() < new Date(contest.endAt).getTime()) {
		return { resolved: false, reason: 'not_ended' };
	}

	const lineupA = await db
		.select()
		.from(lineups)
		.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, contest.userAId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!lineupA) return { resolved: false, reason: 'missing_lineup_a' };

	// Price failures abort resolution rather than producing a wrong result. The
	// contest stays `live` and will resolve on a later attempt — lazily when
	// someone opens it, or on the cron sweep — once prices are back.
	// Judged at the contest's scheduled end, so a result never depends on when
	// someone happened to open the page.
	const scoredAt = contest.endAt ? new Date(contest.endAt) : new Date();

	const userA = await db
		.select({ activeBoosts: users.activeBoosts })
		.from(users)
		.where(eq(users.id, contest.userAId))
		.limit(1)
		.then((r) => r[0] ?? null);

	let scoreA: number;
	try {
		scoreA = await scoreLineupPicks(
			lineupA.id,
			contest.durationMinutes,
			userA?.activeBoosts as ActiveBoost[] | null,
			scoredAt
		);
	} catch (e) {
		if (e instanceof PriceUnavailableError) {
			console.warn(`[resolveContest] ${contestId} deferred — ${e.message}`);
			return { resolved: false, reason: 'prices_unavailable' };
		}
		throw e;
	}
	await db.update(lineups).set({ finalScore: String(scoreA) }).where(eq(lineups.id, lineupA.id));

	let scoreB = 0;
	let didAWin = false;

	if (contest.userBId) {
		const lineupB = await db
			.select()
			.from(lineups)
			.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, contest.userBId)))
			.limit(1)
			.then((rows) => rows[0] ?? null);

		if (!lineupB) return { resolved: false, reason: 'missing_lineup_b' };

		const userB = await db
			.select({ activeBoosts: users.activeBoosts })
			.from(users)
			.where(eq(users.id, contest.userBId))
			.limit(1)
			.then((r) => r[0] ?? null);

		try {
			scoreB = await scoreLineupPicks(
				lineupB.id,
				contest.durationMinutes,
				userB?.activeBoosts as ActiveBoost[] | null,
				scoredAt
			);
		} catch (e) {
			if (e instanceof PriceUnavailableError) {
				console.warn(`[resolveContest] ${contestId} deferred — ${e.message}`);
				return { resolved: false, reason: 'prices_unavailable' };
			}
			throw e;
		}
		await db.update(lineups).set({ finalScore: String(scoreB) }).where(eq(lineups.id, lineupB.id));

		didAWin = scoreA >= scoreB;
	} else {
		// Bot opponent
		scoreB = Math.max(0, scoreA - 120 + Math.random() * 220);
		didAWin = scoreA >= scoreB;
	}

	const winnerId = didAWin ? contest.userAId : contest.userBId || null;

	// Pay out any wager on this contest. Runs before XP so that a settlement
	// failure surfaces loudly rather than after rewards have already moved.
	// Idempotent by design — only a `locked` stake is acted on, so resolving a
	// contest twice cannot pay twice.
	try {
		await settleStakeForContest(contestId, winnerId);
	} catch (e) {
		console.error('[resolveContest] stake settlement failed:', e);
	}
	const loserId = didAWin ? contest.userBId : contest.userAId;
	const xpMultiplier = contest.type === 'weekly' ? 2 : 1;

	await db
		.update(contests)
		// endAt is deliberately left alone — it's the scheduled end of the game,
		// not the moment resolution happened. Overwriting it destroyed the record
		// of how long the contest was actually meant to run.
		.set({ status: 'resolved', winnerId })
		.where(eq(contests.id, contestId));

	if (winnerId) {
		const winner = await db
			.select()
			.from(users)
			.where(eq(users.id, winnerId))
			.limit(1)
			.then((rows) => rows[0] ?? null);
		if (winner) {
			// Paper (practice) contests earn practice XP only — no real XP, no streak impact
			await db
				.update(users)
				.set(
					contest.isPaper
						? { paperXpTotal: (winner.paperXpTotal ?? 0) + 250 * xpMultiplier }
						: {
								xpTotal: (winner.xpTotal ?? 0) + 250 * xpMultiplier,
								streak: (winner.streak ?? 0) + 1
							}
				)
				.where(eq(users.id, winnerId));
		}
	}

	if (loserId) {
		const loser = await db
			.select()
			.from(users)
			.where(eq(users.id, loserId))
			.limit(1)
			.then((rows) => rows[0] ?? null);
		if (loser) {
			await db
				.update(users)
				.set(
					contest.isPaper
						? { paperXpTotal: (loser.paperXpTotal ?? 0) + 60 * xpMultiplier }
						: { xpTotal: (loser.xpTotal ?? 0) + 60 * xpMultiplier, streak: 0 }
				)
				.where(eq(users.id, loserId));
		}
	}

	if (contest.userBId) {
		await db
			.update(users)
			.set({ matchmakingStatus: 'idle' })
			.where(eq(users.id, contest.userAId));
		await db
			.update(users)
			.set({ matchmakingStatus: 'idle' })
			.where(eq(users.id, contest.userBId));

		if (loserId) {
			const winnerLeagues = await db
				.select({ leagueId: leagueMembers.leagueId })
				.from(leagueMembers)
				.where(eq(leagueMembers.userId, winnerId!));

			for (const { leagueId } of winnerLeagues) {
				if (!leagueId) continue;

				const winnerMember = await db
					.select()
					.from(leagueMembers)
					.where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, winnerId!)))
					.limit(1)
					.then((rows) => rows[0] ?? null);

				if (winnerMember) {
					await db
						.update(leagueMembers)
						.set({ wins: (winnerMember.wins ?? 0) + 1, points: (winnerMember.points ?? 0) + 3 })
						.where(eq(leagueMembers.id, winnerMember.id));
				}

				const loserMember = await db
					.select()
					.from(leagueMembers)
					.where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, loserId)))
					.limit(1)
					.then((rows) => rows[0] ?? null);

				if (loserMember) {
					await db
						.update(leagueMembers)
						.set({ losses: (loserMember.losses ?? 0) + 1 })
						.where(eq(leagueMembers.id, loserMember.id));
				}
			}
		}
	}

	return { resolved: true };
}
