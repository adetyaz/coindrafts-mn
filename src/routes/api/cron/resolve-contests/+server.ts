import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests } from '$lib/server/schema';
import { resolveContest } from '$lib/server/contest-resolution';

// Sweeps contests whose 24h window has passed but nobody has loaded the
// result page yet (which is what normally triggers resolution).
async function sweep(authHeader: string | null) {
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const due = await db
		.select({ id: contests.id })
		.from(contests)
		.where(and(eq(contests.status, 'live'), lte(contests.endAt, new Date())));

	const results = await Promise.all(
		due.map(async (c) => ({ contestId: c.id, ...(await resolveContest(c.id)) }))
	);

	return json({
		checked: due.length,
		resolved: results.filter((r) => r.resolved).length,
		results
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
