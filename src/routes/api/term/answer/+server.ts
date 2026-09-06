import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { dailyTerms, termAttempts, users } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { bumpResearchStreak } from '$lib/server/term-of-day';

// POST /api/term/answer { termId } — purely informational, no quiz. Marks
// today's Word of the Day as read and pays out its flat XP once per day.
// Quizzing is the Gauntlet's job only — this endpoint used to require an
// `answer` and grade it, which is exactly the "asking another question"
// duplication that was never wanted here.
export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { termId } = body;
	if (!termId) return json({ error: 'Term ID required' }, { status: 400 });

	const dailyTerm = await db
		.select()
		.from(dailyTerms)
		.where(eq(dailyTerms.id, termId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!dailyTerm) return json({ error: 'Term not found' }, { status: 404 });

	const existing = await db
		.select()
		.from(termAttempts)
		.where(and(eq(termAttempts.userId, parsed.userId), eq(termAttempts.termId, termId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (existing) return json({ error: 'Already claimed today' }, { status: 409 });

	const xpEarned = dailyTerm.xpReward ?? 20;
	await db
		.insert(termAttempts)
		.values({ userId: parsed.userId, termId, answer: dailyTerm.term, correct: true, xpEarned });
	await bumpResearchStreak(parsed.userId);

	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (user) {
		await db
			.update(users)
			.set({ xpTotal: (user.xpTotal ?? 0) + xpEarned })
			.where(eq(users.id, parsed.userId));
	}

	return json({ xpEarned });
}
