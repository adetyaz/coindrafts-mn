import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lineups, lineupPicks, users, stakes, stakeParticipants } from '$lib/server/schema';
import { parseSessionToken } from '$lib/server/auth';
import { resolveContest } from '$lib/server/contest-resolution';
import { awardWinBadges } from '$lib/server/badges';
import { headToHead } from '$lib/server/wager';

export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const contestId = params.id;
	if (!contestId) return json({ error: 'Contest id is required' }, { status: 400 });

	let contest = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!contest) return json({ error: 'Contest not found' }, { status: 404 });
	if (contest.userAId !== parsed.userId && contest.userBId !== parsed.userId) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (contest.status === 'live') {
		const result = await resolveContest(contestId);
		if (!result.resolved) {
			// Still running is a normal state now that duration is enforced, not an
			// error — the caller should be watching the game, not reading a result.
			if (result.reason === 'not_ended') {
				return json(
					{
						error: 'Contest is still running',
						stillRunning: true,
						endAt: contest.endAt,
						gameUrl: `/game/${contestId}`
					},
					{ status: 409 }
				);
			}
			const reason =
				result.reason === 'missing_lineup_b'
					? 'Opponent has not submitted a lineup yet'
					: result.reason === 'prices_unavailable'
						? 'Still resolving — waiting on live prices'
						: 'Contest is not ready to resolve yet';
			// `retryable` tells the client whether this is worth polling for.
			// `prices_unavailable` is a batch price-fetch blip — genuinely transient,
			// resolves itself the moment prices are reachable again. A missing
			// opponent lineup is not something a retry fixes on its own.
			return json(
				{ error: reason, reason: result.reason, retryable: result.reason === 'prices_unavailable' },
				{ status: 400 }
			);
		}
		contest = await db
			.select()
			.from(contests)
			.where(eq(contests.id, contestId))
			.limit(1)
			.then((rows) => rows[0]);
	}

	if (contest.status !== 'resolved') {
		return json({ error: 'Contest is not live yet' }, { status: 400 });
	}

	const isUserA = contest.userAId === parsed.userId;

	const myLineup = await db
		.select()
		.from(lineups)
		.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, parsed.userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!myLineup) return json({ error: 'Lineup not found' }, { status: 404 });

	const myPicks = await db.select().from(lineupPicks).where(eq(lineupPicks.lineupId, myLineup.id));
	if (myPicks.length === 0) return json({ error: 'No picks found' }, { status: 404 });

	const didWin = contest.winnerId === parsed.userId;

	// The opponent's real lineup, resolved before the breakdown is built so each
	// row can name what they actually picked in that sector. This previously
	// emitted the literal string "Opponent"/"Bot" for every row, so the result
	// page's opponent column was a placeholder that never showed anything —
	// there was genuinely nothing to show while bots had no lineup, but Scrimmage
	// bots now draft real ones, so the data exists.
	const opponentId = isUserA ? contest.userBId : contest.userAId;
	let opponentLineup = null;
	let opponentPicks: (typeof lineupPicks.$inferSelect)[] = [];
	let opponentName: string | null = null;

	if (opponentId) {
		opponentLineup = await db
			.select()
			.from(lineups)
			.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, opponentId)))
			.limit(1)
			.then((rows) => rows[0] ?? null);

		if (opponentLineup) {
			opponentPicks = await db
				.select()
				.from(lineupPicks)
				.where(eq(lineupPicks.lineupId, opponentLineup.id));
		}

		opponentName = await db
			.select({ username: users.username })
			.from(users)
			.where(eq(users.id, opponentId))
			.limit(1)
			.then((rows) => rows[0]?.username ?? null);
	}

	const opponentBySector = new Map(opponentPicks.map((p) => [p.sector, p]));

	const scoredPicks = myPicks.map((p) => {
		const opp = opponentBySector.get(p.sector);
		const oppPct = opp ? Number(Number(opp.pctChange ?? 0).toFixed(2)) : null;
		return {
			sector: p.sector,
			pick: p.tokenSymbol,
			pct: Number(Number(p.pctChange ?? 0).toFixed(2)),
			// null rather than a placeholder — the page renders a dash, so an
			// opponent with no lineup reads as absent instead of as a real pick.
			opponent: opp ? `${opp.tokenSymbol} (${oppPct != null && oppPct >= 0 ? '+' : ''}${oppPct}%)` : null,
			opponentPick: opp?.tokenSymbol ?? null,
			opponentPct: oppPct,
			points: Number(Number(p.score ?? 0).toFixed(2))
		};
	});

	let opponentScore = 0;
	if (contest.userBId) {
		opponentScore = opponentLineup ? Number(Number(opponentLineup.finalScore ?? 0).toFixed(0)) : 0;
	} else {
		const total = myPicks.reduce((sum, p) => sum + Number(p.score ?? 0), 0);
		opponentScore = Number(Math.max(0, total - 120 + 110).toFixed(0));
	}

	const xpMultiplier = contest.type === 'weekly' ? 2 : 1;
	// Paper (practice) contests don't count toward real achievements
	const newBadges = didWin && !contest.isPaper ? await awardWinBadges(parsed.userId) : [];

	return json({
		contestId,
		isPaper: Boolean(contest.isPaper),
		status: didWin ? 'YOU WON' : 'YOU LOST',
		xp: (didWin ? 250 : 60) * xpMultiplier,
		yourScore: Number(Number(myLineup.finalScore ?? 0).toFixed(0)),
		opponentScore,
		opponentName,
		// The rivalry. A running record is what turns "some opponent" into a
		// nemesis worth rematching — it's the point of the loop.
		record: opponentId && !contest.isPaper ? await headToHead(parsed.userId, opponentId) : null,
		canRematch: Boolean(opponentId) && !contest.isPaper,
		// What the wager did, so the result screen can state it rather than
		// leaving the player to infer it from an XP change.
		stake: await (async () => {
			const s = await db
				.select()
				.from(stakes)
				.where(eq(stakes.contestId, contestId))
				.limit(1)
				.then((r) => r[0] ?? null);
			if (!s) return null;
			const mine = await db
				.select()
				.from(stakeParticipants)
				.where(and(eq(stakeParticipants.stakeId, s.id), eq(stakeParticipants.userId, parsed.userId)))
				.limit(1)
				.then((r) => r[0] ?? null);
			return {
				amount: s.agreedAmount,
				currency: s.currency,
				status: s.status,
				// Signed net: what actually changed hands for this player.
				net: s.status === 'settled' ? (mine?.payout ?? 0) - (mine?.committed ?? 0) : 0
			};
		})(),
		breakdown: scoredPicks,
		newBadges
	});
}
