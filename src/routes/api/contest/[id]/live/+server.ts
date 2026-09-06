import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lineups, lineupPicks, users, priceSamples, stakes } from '$lib/server/schema';
import { parseSessionToken } from '$lib/server/auth';
import { getSnapshot, extractPrice, getTokensWithPrices } from '$lib/server/sosovalue';

// Don't re-sample more often than this. Two players watching the same game
// would otherwise each write a full set of rows every poll.
//
// 6s. Fine-grained enough that a 10-minute game yields ~100 points and the line
// reads as motion, without generating rows faster than anyone can see them.
//
// An earlier 4s value was chosen on the assumption that sampling was ~free
// because it reuses the batch price map. That was wrong: the upstream *price*
// call is free, but every tick still writes a row per token and the endpoint
// re-read the full history each poll. On a metered Postgres that's the
// expensive part, and it contributed to exhausting a compute quota.
const SAMPLE_THROTTLE_MS = 6_000;

// NOTE: an in-memory cache for the immutable parts (contest, lineups, picks,
// usernames — none of which change once a game is live) was started here and is
// deliberately NOT in place. Left as a comment rather than dead code: it's a
// real optimisation worth doing if this endpoint's load matters, but a
// half-applied version that nothing uses is worse than none.

// Live state for the game screen: both lineups, their locked entry prices, and
// where each pick stands right now. The race is drawn from this.
//
// Note on the series: the app captures no price history during a window —
// scoring only ever compared entry and exit. Rather than add interval capture
// infrastructure, this returns the *current* standing on each poll and the
// client accumulates the line as the game runs. That's honest for watching a
// game live, but it means the graph only covers the time the page was open.
export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const contestId = params.id;
	if (!contestId) return json({ error: 'Contest id is required' }, { status: 400 });

	const contest = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!contest) return json({ error: 'Contest not found' }, { status: 404 });
	if (contest.userAId !== parsed.userId && contest.userBId !== parsed.userId) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	// Priced from the same batch pool the draft screen and lineup lock use — one
	// cached call, not up to 10 individual per-pick requests every single poll.
	// That per-token burst was the actual cause of the race chart going blank:
	// a rate-limited fetch used to silently fall back to "0% move" for that
	// tick, and under sustained rate-limiting that's every tick, every pick —
	// a real, drawn line that just never moves.
	const priceByCurrency = new Map((await getTokensWithPrices()).map((t) => [t.currency_id, t.price]));
	async function currentPriceFor(currencyId: string, fallback: number): Promise<number> {
		const cached = priceByCurrency.get(currencyId);
		if (cached != null && cached > 0) return cached;
		// Rare fallback — a token the batch pool doesn't currently carry.
		try {
			const live = extractPrice(await getSnapshot(currencyId));
			return live && Number.isFinite(live) && live > 0 ? live : fallback;
		} catch {
			return fallback;
		}
	}

	async function sideFor(userId: string | null) {
		if (!userId) return null;
		const lineup = await db
			.select()
			.from(lineups)
			.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, userId)))
			.limit(1)
			.then((rows) => rows[0] ?? null);
		if (!lineup) return null;

		const picks = await db.select().from(lineupPicks).where(eq(lineupPicks.lineupId, lineup.id));
		const name = await db
			.select({ username: users.username })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
			.then((rows) => rows[0]?.username ?? null);

		const enriched = await Promise.all(
			picks.map(async (p) => {
				const entry = Number(p.entryPrice ?? 0);
				const current = await currentPriceFor(p.currencyId, entry);
				const pct = entry > 0 ? ((current - entry) / entry) * 100 : 0;
				return {
					sector: p.sector,
					symbol: p.tokenSymbol,
					name: p.tokenName,
					currencyId: p.currencyId,
					entryPrice: entry,
					currentPrice: current,
					pct: Number(pct.toFixed(3))
				};
			})
		);

		const total = enriched.reduce((sum, p) => sum + p.pct, 0);
		return { userId, name, picks: enriched, totalPct: Number(total.toFixed(3)) };
	}

	const [me, opponent] = await Promise.all([
		sideFor(parsed.userId),
		sideFor(contest.userAId === parsed.userId ? contest.userBId : contest.userAId)
	]);

	const now = Date.now();
	const endAt = contest.endAt ? new Date(contest.endAt).getTime() : null;
	const startAt = contest.startAt ? new Date(contest.startAt).getTime() : null;

	// ── Persist this tick, then hand back the whole run ──────────────────────
	// Written server-side so the race survives a refresh and both players see
	// the same line, rather than each accumulating a private one in memory.
	const livePicks = [...(me?.picks ?? []), ...(opponent?.picks ?? [])];

	try {
		const newest = await db
			.select({ sampledAt: priceSamples.sampledAt })
			.from(priceSamples)
			.where(eq(priceSamples.contestId, contestId))
			.orderBy(asc(priceSamples.sampledAt))
			.then((rows) => (rows.length ? rows[rows.length - 1].sampledAt : null));

		const dueForSample =
			contest.status === 'live' &&
			(!newest || now - new Date(newest).getTime() >= SAMPLE_THROTTLE_MS);

		if (dueForSample && livePicks.length > 0) {
			// One timestamp for the whole set, so a tick groups cleanly on read.
			const sampledAt = new Date();
			await db.insert(priceSamples).values(
				livePicks.map((p) => ({
					contestId,
					currencyId: p.currencyId,
					price: String(p.currentPrice),
					sampledAt
				}))
			);
		}
	} catch (e) {
		// Sampling is best-effort — never fail the screen over history.
		console.error('[live] sample write failed:', e);
	}

	let history: { at: string; prices: Record<string, number> }[] = [];
	try {
		const rows = await db
			.select()
			.from(priceSamples)
			.where(eq(priceSamples.contestId, contestId))
			.orderBy(asc(priceSamples.sampledAt));

		const byTick = new Map<string, Record<string, number>>();
		for (const r of rows) {
			const key = new Date(r.sampledAt).toISOString();
			if (!byTick.has(key)) byTick.set(key, {});
			byTick.get(key)![r.currencyId] = Number(r.price);
		}
		history = [...byTick.entries()].map(([at, prices]) => ({ at, prices }));
	} catch (e) {
		console.error('[live] history read failed:', e);
	}

	// Surfaced so the start screen can show the commit step without a second round trip.
	const stake = await db
		.select({ id: stakes.id })
		.from(stakes)
		.where(eq(stakes.contestId, contestId))
		.limit(1)
		.then((r) => r[0] ?? null);

	return json({
		stakeId: stake?.id ?? null,
		history,
		contestId,
		status: contest.status,
		isPaper: Boolean(contest.isPaper),
		durationMinutes: contest.durationMinutes,
		startAt: startAt ? new Date(startAt).toISOString() : null,
		endAt: endAt ? new Date(endAt).toISOString() : null,
		msRemaining: endAt ? Math.max(0, endAt - now) : null,
		finished: endAt ? now >= endAt : false,
		me,
		opponent
	});
}
