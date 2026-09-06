import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!user) return json({ error: 'User not found' }, { status: 404 });

	return json({
		id: user.id,
		username: user.username,
		walletAddress: user.walletAddress,
		xpTotal: user.xpTotal,
		paperXpTotal: user.paperXpTotal,
		streak: user.streak,
		researchStreak: user.researchStreak,
		freeHitsAvailable: user.freeHitsAvailable,
		matchmakingStatus: user.matchmakingStatus,
		activeBoosts: user.activeBoosts || []
	});
}
