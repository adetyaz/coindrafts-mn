import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { leagues, leagueMembers } from '$lib/server/schema';
import { eq, and } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { leagueId, inviteCode } = body;

	let league = null;

	if (leagueId) {
		const rows = await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
		league = rows[0] ?? null;
	} else if (inviteCode) {
		const rows = await db.select().from(leagues).where(eq(leagues.inviteCode, inviteCode)).limit(1);
		league = rows[0] ?? null;
	}

	if (!league) return json({ error: 'League not found' }, { status: 404 });

	// Check if already a member
	const existing = await db
		.select()
		.from(leagueMembers)
		.where(and(eq(leagueMembers.leagueId, league.id), eq(leagueMembers.userId, parsed.userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (existing) return json({ error: 'Already a member' }, { status: 409 });

	await db.insert(leagueMembers).values({
		leagueId: league.id,
		userId: parsed.userId,
		wins: 0,
		losses: 0,
		points: 0
	});

	return json({ ok: true, leagueId: league.id });
}
