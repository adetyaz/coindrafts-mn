import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gauntletQuestions, gauntletAttempts, users } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { questionId, answer } = body;
	if (!questionId || !answer)
		return json({ error: 'Question ID and answer required' }, { status: 400 });

	const question = await db
		.select()
		.from(gauntletQuestions)
		.where(eq(gauntletQuestions.id, questionId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!question) return json({ error: 'Question not found' }, { status: 404 });

	// Check if already answered
	const existing = await db
		.select()
		.from(gauntletAttempts)
		.where(
			and(eq(gauntletAttempts.userId, parsed.userId), eq(gauntletAttempts.questionId, questionId))
		)
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (existing) {
		return json({ error: 'Already answered' }, { status: 409 });
	}

	const correct = answer === question.correctAnswer;
	const xpEarned = correct ? question.xpReward : 0;

	// Record attempt
	await db.insert(gauntletAttempts).values({
		userId: parsed.userId,
		questionId,
		answer,
		correct,
		xpEarned
	});

	// Award XP and boost if correct
	if (correct) {
		const user = await db
			.select()
			.from(users)
			.where(eq(users.id, parsed.userId))
			.limit(1)
			.then((rows) => rows[0] ?? null);
		if (user) {
			const currentBoosts =
				(user.activeBoosts as Array<{ sector: string; expiresAt: string }>) || [];
			const newBoost = question.boostSector
				? {
						sector: question.boostSector,
						expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
					}
				: null;

			await db
				.update(users)
				.set({
					xpTotal: (user.xpTotal ?? 0) + (xpEarned ?? 0),
					activeBoosts: newBoost ? [...currentBoosts, newBoost] : currentBoosts
				})
				.where(eq(users.id, parsed.userId));
		}
	}

	return json({
		correct,
		xpEarned,
		boostSector: correct ? question.boostSector : null,
		correctAnswer: question.correctAnswer
	});
}
