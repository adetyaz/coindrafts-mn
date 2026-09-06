import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { getClaimableAchievements } from '$lib/server/achievements';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const user = await db
		.select({ walletAddress: users.walletAddress, chainType: users.chainType })
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!user) return json({ error: 'User not found' }, { status: 404 });

	const result = await getClaimableAchievements(parsed.userId, user.walletAddress, user.chainType);
	return json(result);
}
