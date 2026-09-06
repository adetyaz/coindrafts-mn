import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lineups, lineupPicks, users } from '$lib/server/schema';
import { renderResultCardSvg } from '$lib/server/resultCard';

// Public, unauthenticated — link-preview crawlers (Twitter/Discord/etc) have no
// session cookie. Read-only, and scoped to a single participant's own picks,
// which they've already chosen to share.
export async function GET({ params, url }) {
	const contestId = params.id;
	const userId = url.searchParams.get('u');
	if (!contestId || !userId) return new Response('Not found', { status: 404 });

	const contest = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!contest || contest.status !== 'resolved') return new Response('Not found', { status: 404 });
	if (contest.userAId !== userId && contest.userBId !== userId) {
		return new Response('Not found', { status: 404 });
	}

	const lineup = await db
		.select()
		.from(lineups)
		.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!lineup) return new Response('Not found', { status: 404 });

	const picks = await db.select().from(lineupPicks).where(eq(lineupPicks.lineupId, lineup.id));
	const user = await db
		.select({ username: users.username })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	const opponentId = contest.userAId === userId ? contest.userBId : contest.userAId;
	const opponentLineup = opponentId
		? await db
				.select()
				.from(lineups)
				.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, opponentId)))
				.limit(1)
				.then((rows) => rows[0] ?? null)
		: null;

	const svg = renderResultCardSvg({
		username: user?.username ?? 'Player',
		didWin: contest.winnerId === userId,
		yourScore: Number(Number(lineup.finalScore ?? 0).toFixed(0)),
		opponentScore: Number(Number(opponentLineup?.finalScore ?? 0).toFixed(0)),
		contestType: contest.type ?? 'daily',
		picks: picks.map((p) => ({
			sector: p.sector,
			pick: p.tokenSymbol,
			pct: Number(p.pctChange ?? 0)
		}))
	});

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml',
			'Cache-Control': 'public, max-age=3600'
		}
	});
}
