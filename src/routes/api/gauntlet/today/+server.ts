import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gauntletAttempts } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { ensureTodaySeeded } from '$lib/server/gauntlet';

export async function GET({ cookies, fetch }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const today = new Date().toISOString().split('T')[0];

	// Cron should normally handle this, but self-heal if it hasn't run yet
	const question = await ensureTodaySeeded(today, fetch);

	const attempt = await db
		.select()
		.from(gauntletAttempts)
		.where(
			and(eq(gauntletAttempts.userId, parsed.userId), eq(gauntletAttempts.questionId, question.id))
		)
		.limit(1)
		.then((rows) => rows[0] ?? null);

	return json({
		id: question.id,
		question: question.question,
		options: question.options,
		sector: question.sector,
		xpReward: question.xpReward,
		boostSector: question.boostSector,
		category: question.category,
		term: question.term,
		alreadyAnswered: !!attempt,
		previousAnswer: attempt?.answer ?? null,
		wasCorrect: attempt?.correct ?? null
	});
}
