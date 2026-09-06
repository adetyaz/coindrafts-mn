import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { lobbies } from '$lib/server/schema';
import { resolveLobby } from '$lib/server/lobby-resolution';

// Sweeps lobbies whose window has passed but nobody has loaded the
// result page yet (which is what normally triggers resolution).
async function sweep(authHeader: string | null) {
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const due = await db
		.select({ id: lobbies.id })
		.from(lobbies)
		.where(and(eq(lobbies.status, 'live'), lte(lobbies.endAt, new Date())));

	const results = await Promise.all(
		due.map(async (l) => ({ lobbyId: l.id, ...(await resolveLobby(l.id)) }))
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
