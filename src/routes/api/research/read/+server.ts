import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { researchReads, users } from '$lib/server/schema';
import { eq, and, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { bumpResearchStreak } from '$lib/server/term-of-day';

const RESEARCH_XP = 20;

export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const articleId = String(body.articleId ?? '');
	const sector = String(body.sector ?? 'wildcard');
	if (!articleId) return json({ error: 'articleId is required' }, { status: 400 });

	const today = new Date().toISOString().split('T')[0];

	const existing = await db
		.select()
		.from(researchReads)
		.where(and(eq(researchReads.userId, parsed.userId), eq(researchReads.readDate, sql`${today}::date`)))
		.limit(1);

	if (existing.length > 0) {
		return json({ awarded: false, reason: 'Already claimed a research boost today' });
	}

	await db.insert(researchReads).values({
		userId: parsed.userId,
		articleId,
		sector,
		xpEarned: RESEARCH_XP,
		readDate: sql`${today}::date`
	});

	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (user) {
		const currentBoosts = (user.activeBoosts as Array<{ sector: string; expiresAt: string }>) || [];
		const newBoost = { sector, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
		await db
			.update(users)
			.set({
				xpTotal: (user.xpTotal ?? 0) + RESEARCH_XP,
				activeBoosts: [...currentBoosts, newBoost]
			})
			.where(eq(users.id, parsed.userId));
	}

	await bumpResearchStreak(parsed.userId);

	return json({ awarded: true, xp: RESEARCH_XP, sector });
}
