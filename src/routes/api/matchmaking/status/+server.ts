import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { contests } from '$lib/server/schema';
import { eq, and, or } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	// Check if user is in a live/open contest
	const existing = await db
		.select()
		.from(contests)
		.where(
			and(
				or(eq(contests.status, 'live'), eq(contests.status, 'open')),
				or(eq(contests.userAId, parsed.userId), eq(contests.userBId, parsed.userId)),
				eq(contests.isPaper, false)
			)
		)
		.then((rows) => rows[0] ?? null);

	if (existing) {
		return json({
			status: 'matched',
			contestId: existing.id,
			opponentId: existing.userAId === parsed.userId ? existing.userBId : existing.userAId
		});
	}

	return json({ status: 'waiting' });
}
