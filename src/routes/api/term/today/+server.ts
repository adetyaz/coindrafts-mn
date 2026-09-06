import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { termAttempts } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { ensureTodayTermSeeded } from '$lib/server/term-of-day';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const today = new Date().toISOString().split('T')[0];
	const dailyTerm = await ensureTodayTermSeeded(today);

	const attempt = await db
		.select()
		.from(termAttempts)
		.where(and(eq(termAttempts.userId, parsed.userId), eq(termAttempts.termId, dailyTerm.id)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	return json({
		id: dailyTerm.id,
		term: dailyTerm.term,
		definition: dailyTerm.definition,
		xpReward: dailyTerm.xpReward,
		alreadyAnswered: !!attempt
	});
}
