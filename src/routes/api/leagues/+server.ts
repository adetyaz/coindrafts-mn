import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { leagues, leagueMembers } from '$lib/server/schema';
import { eq, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { awardLeagueFounderBadge } from '$lib/server/badges';

function generateInviteCode(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let code = '';
	for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
	return code;
}

// GET /api/leagues — list public leagues + user's leagues
export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const publicLeagues = await db
		.select({
			id: leagues.id,
			name: leagues.name,
			type: leagues.type,
			createdBy: leagues.createdBy,
			seasonStart: leagues.seasonStart,
			seasonEnd: leagues.seasonEnd,
			createdAt: leagues.createdAt,
			memberCount: sql<number>`count(${leagueMembers.id})`.as('member_count')
		})
		.from(leagues)
		.leftJoin(leagueMembers, eq(leagueMembers.leagueId, leagues.id))
		.where(eq(leagues.type, 'public'))
		.groupBy(leagues.id);

	// Get user's leagues via subquery to avoid self-join issues
	const myMemberships = await db
		.select({ leagueId: leagueMembers.leagueId })
		.from(leagueMembers)
		.where(eq(leagueMembers.userId, parsed.userId));

	const myLeagueIds = myMemberships.map((m) => m.leagueId);

	let mine: Array<{
		id: string;
		name: string;
		type: string;
		createdBy: string | null;
		seasonStart: Date | null;
		seasonEnd: Date | null;
		createdAt: Date | null;
		memberCount: number;
	}> = [];

	if (myLeagueIds.length > 0) {
		mine = await db
			.select({
				id: leagues.id,
				name: leagues.name,
				type: leagues.type,
				createdBy: leagues.createdBy,
				seasonStart: leagues.seasonStart,
				seasonEnd: leagues.seasonEnd,
				createdAt: leagues.createdAt,
				memberCount: sql<number>`count(${leagueMembers.id})`.as('member_count')
			})
			.from(leagues)
			.leftJoin(leagueMembers, eq(leagueMembers.leagueId, leagues.id))
			.where(
				sql`${leagues.id} IN (${myLeagueIds
					.filter((id) => id !== null)
					.map((id) => sql`${id}`)
					.reduce((a, b) => sql`${a}, ${b}`)})`
			)
			.groupBy(leagues.id);
	}

	return json({ public: publicLeagues, mine });
}

// POST /api/leagues — create a new league
export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { name, type } = body;
	if (!name || !type) return json({ error: 'Name and type required' }, { status: 400 });
	if (type !== 'public' && type !== 'private') {
		return json({ error: 'Type must be public or private' }, { status: 400 });
	}

	const inviteCode = type === 'private' ? generateInviteCode() : null;

	const [league] = await db
		.insert(leagues)
		.values({
			name,
			type,
			inviteCode,
			createdBy: parsed.userId,
			seasonStart: new Date(),
			seasonEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
		})
		.returning();

	// Auto-join creator
	await db.insert(leagueMembers).values({
		leagueId: league.id,
		userId: parsed.userId,
		wins: 0,
		losses: 0,
		points: 0
	});

	const newBadges = await awardLeagueFounderBadge(parsed.userId);

	return json({ ...league, newBadges });
}
