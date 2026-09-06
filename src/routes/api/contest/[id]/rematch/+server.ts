import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { contests, stakes } from '$lib/server/schema';
import { and, eq, gte, or, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { createStakeForContest, headToHead } from '$lib/server/wager';

// Rematch: same opponent, same terms, one click.
//
// The point of this endpoint is the rivalry — "win your money back" is what
// turns a stranger into a nemesis. That also makes it the mechanic most capable
// of encouraging loss-chasing, which is why the cap below exists and is not
// optional.

/** Rematches allowed against the same opponent per rolling window. */
const REMATCH_CAP = 5;
const CAP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const previous = await db
		.select()
		.from(contests)
		.where(eq(contests.id, params.id))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!previous) return json({ error: 'Contest not found' }, { status: 404 });

	const isPlayer = previous.userAId === parsed.userId || previous.userBId === parsed.userId;
	if (!isPlayer) return json({ error: 'Forbidden' }, { status: 403 });
	if (previous.status !== 'resolved') {
		return json({ error: 'That game is still running' }, { status: 400 });
	}

	const opponentId = previous.userAId === parsed.userId ? previous.userBId : previous.userAId;
	if (!opponentId) return json({ error: 'No opponent to rematch' }, { status: 400 });

	// Scrimmage has no counterparty worth rematching — the bot isn't a rival.
	if (previous.isPaper) {
		return json({ error: 'Scrimmage games have no rematch' }, { status: 400 });
	}

	// ── The guard ──────────────────────────────────────────────────────────────
	// Chasing losses is precisely what this loop encourages, which is why it
	// needs a limit rather than despite it. Counted per pair, per hour.
	const since = new Date(Date.now() - CAP_WINDOW_MS);
	const recent = await db
		.select({ n: sql<number>`count(*)` })
		.from(contests)
		.where(
			and(
				gte(contests.startAt, since),
				or(
					and(eq(contests.userAId, parsed.userId), eq(contests.userBId, opponentId)),
					and(eq(contests.userAId, opponentId), eq(contests.userBId, parsed.userId))
				)
			)
		)
		.then((r) => Number(r[0]?.n ?? 0));

	if (recent >= REMATCH_CAP) {
		return json(
			{
				error: `You've played ${recent} games against this opponent in the last hour. Take a break before another.`,
				reason: 'rematch_cap',
				retryAfterMinutes: 60
			},
			{ status: 429 }
		);
	}

	// Same terms as the game just played — that's what makes it a rematch.
	const [next] = await db
		.insert(contests)
		.values({
			userAId: parsed.userId,
			userBId: opponentId,
			type: previous.type,
			durationMinutes: previous.durationMinutes,
			status: 'open'
		})
		.returning();

	// Carry the stake across at the same tier. It still requires both players to
	// commit — a rematch re-runs the wager, it doesn't assume consent to it.
	let stakeId: string | null = null;
	const previousStake = await db
		.select()
		.from(stakes)
		.where(eq(stakes.contestId, previous.id))
		.limit(1)
		.then((r) => r[0] ?? null);

	if (previousStake && previousStake.tierAmount > 0) {
		const created = await createStakeForContest(next.id, previousStake.tierAmount, [
			parsed.userId,
			opponentId
		]);
		if (created.ok) stakeId = created.stakeId;
	}

	const record = await headToHead(parsed.userId, opponentId);

	return json({
		contestId: next.id,
		opponentId,
		stakeId,
		stakeTier: previousStake?.tierAmount ?? 0,
		record,
		gamesThisHour: recent + 1,
		rematchCap: REMATCH_CAP
	});
}
