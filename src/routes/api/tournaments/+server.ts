import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { tournaments, lobbies, lobbyParticipants, users } from '$lib/server/schema';
import { and, eq, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

const SECTORS = ['l1', 'l2', 'defi', 'meme', 'wildcard'];

// GET /api/tournaments?status=open — browse
export async function GET({ url, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const status = url.searchParams.get('status') ?? 'open';

	const rows = await db
		.select({
			id: tournaments.id,
			name: tournaments.name,
			contestType: tournaments.contestType,
			payoutStructure: tournaments.payoutStructure,
			sectorRestriction: tournaments.sectorRestriction,
			groupSize: tournaments.groupSize,
			status: tournaments.status,
			createdBy: tournaments.createdBy,
			creatorName: users.username,
			createdAt: tournaments.createdAt,
			participantCount: sql<number>`(
				select count(*) from ${lobbyParticipants}
				join ${lobbies} on ${lobbies.id} = ${lobbyParticipants.lobbyId}
				where ${lobbies.tournamentId} = ${tournaments.id}
			)`
		})
		.from(tournaments)
		.leftJoin(users, eq(users.id, tournaments.createdBy))
		// accessType filter is load-bearing, not redundant: two 'private' rows
		// exist from the invite-flow testing pass and were leaking into this
		// public list — this query used to only filter by status.
		.where(and(eq(tournaments.status, status), eq(tournaments.accessType, 'public')));

	return json(rows);
}

// POST /api/tournaments { name, contestType?, payoutStructure?, sectorRestriction?, groupSize?, accessType? }
// fundingMode stays hardcoded to 'free' — that one's genuinely blocked on the
// shared money mechanic. accessType isn't blocked on anything; private
// tournaments just aren't listed and require an invite to join (see
// /api/tournament/[id]/join), both already built.
export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
	if (!name) return json({ error: 'A tournament name is required' }, { status: 400 });

	const contestType = body.contestType === 'weekly' ? 'weekly' : 'daily';
	const accessType = body.accessType === 'private' ? 'private' : 'public';
	const payoutStructure = body.payoutStructure === 'top3_weighted' ? 'top3_weighted' : 'winner_take_all';
	const sectorRestriction = SECTORS.includes(body.sectorRestriction) ? body.sectorRestriction : null;
	const groupSize = Number.isInteger(body.groupSize) && body.groupSize >= 2 ? body.groupSize : 4;

	const [tournament] = await db
		.insert(tournaments)
		.values({
			name,
			createdBy: parsed.userId,
			contestType,
			accessType,
			fundingMode: 'free',
			payoutStructure,
			sectorRestriction,
			groupSize,
			status: 'open'
		})
		.returning();

	return json(tournament);
}
