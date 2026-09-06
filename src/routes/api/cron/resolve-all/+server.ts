import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lobbies } from '$lib/server/schema';
import { resolveContest } from '$lib/server/contest-resolution';
import { resolveLobby } from '$lib/server/lobby-resolution';

// Merges the contest and lobby resolution sweeps into a single cron job.
// Vercel's Hobby plan caps cron jobs at once/day and limits how many a
// project can have — this keeps us to one daily job instead of two hourly
// ones. The lazy-resolve-on-view path (hitting a result page) still
// resolves instantly regardless of this cron's cadence; this is just the
// catch-all for anyone who never loads their result page.
async function sweep(authHeader: string | null) {
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const now = new Date();

	const dueContests = await db
		.select({ id: contests.id })
		.from(contests)
		.where(and(eq(contests.status, 'live'), lte(contests.endAt, now)));

	const dueLobbies = await db
		.select({ id: lobbies.id })
		.from(lobbies)
		.where(and(eq(lobbies.status, 'live'), lte(lobbies.endAt, now)));

	const contestResults = await Promise.all(
		dueContests.map(async (c) => ({ contestId: c.id, ...(await resolveContest(c.id)) }))
	);
	const lobbyResults = await Promise.all(
		dueLobbies.map(async (l) => ({ lobbyId: l.id, ...(await resolveLobby(l.id)) }))
	);

	return json({
		contests: {
			checked: dueContests.length,
			resolved: contestResults.filter((r) => r.resolved).length,
			results: contestResults
		},
		lobbies: {
			checked: dueLobbies.length,
			resolved: lobbyResults.filter((r) => r.resolved).length,
			results: lobbyResults
		}
	});
}

// Vercel Cron Jobs send GET requests
export async function GET({ request }) {
	return sweep(request.headers.get('authorization'));
}

// Kept for manual/local triggering
export async function POST({ request }) {
	return sweep(request.headers.get('authorization'));
}
