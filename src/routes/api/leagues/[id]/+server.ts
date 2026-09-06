import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { leagues, leagueMembers, users } from '$lib/server/schema';
import { eq, desc } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const leagueId = params.id;
	if (!leagueId) return json({ error: 'League id required' }, { status: 400 });

	const league = await db
		.select()
		.from(leagues)
		.where(eq(leagues.id, leagueId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!league) return json({ error: 'League not found' }, { status: 404 });

	const members = await db
		.select({
			id: leagueMembers.id,
			userId: leagueMembers.userId,
			username: users.username,
			wins: leagueMembers.wins,
			losses: leagueMembers.losses,
			points: leagueMembers.points,
			joinedAt: leagueMembers.joinedAt
		})
		.from(leagueMembers)
		.innerJoin(users, eq(users.id, leagueMembers.userId))
		.where(eq(leagueMembers.leagueId, leagueId))
		.orderBy(desc(leagueMembers.points));

	return json({ league, members });
}
