import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { desc } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const topUsers = await db
		.select({
			id: users.id,
			username: users.username,
			walletAddress: users.walletAddress,
			xpTotal: users.xpTotal,
			streak: users.streak
		})
		.from(users)
		.orderBy(desc(users.xpTotal))
		.limit(50);

	const leaderboard = topUsers.map((u, i) => ({
		rank: i + 1,
		id: u.id,
		username: u.username,
		walletShort: u.walletAddress.slice(0, 6) + '...' + u.walletAddress.slice(-4),
		xp: u.xpTotal,
		streak: u.streak,
		isMe: u.id === parsed.userId
	}));

	return json(leaderboard);
}
