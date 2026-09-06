import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants, users } from '$lib/server/schema';
import { eq, and, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

// GET /api/lobby?status=waiting — browse open lobbies looking for players
export async function GET({ url, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const status = url.searchParams.get('status') ?? 'waiting';

	const rows = await db
		.select({
			id: lobbies.id,
			contestType: lobbies.contestType,
			size: lobbies.size,
			status: lobbies.status,
			createdBy: lobbies.createdBy,
			creatorName: users.username,
			createdAt: lobbies.createdAt,
			headcount: sql<number>`(select count(*) from ${lobbyParticipants} where ${lobbyParticipants.lobbyId} = ${lobbies.id})`
		})
		.from(lobbies)
		.leftJoin(users, eq(users.id, lobbies.createdBy))
		.where(and(eq(lobbies.format, 'open'), eq(lobbies.status, status)));

	return json(rows);
}

// POST /api/lobby { contestType?, maxSize? } — create an open lobby, creator auto-joins
export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const contestType = body.contestType === 'weekly' ? 'weekly' : 'daily';
	const maxSize = Number.isInteger(body.maxSize) && body.maxSize >= 2 ? body.maxSize : null;

	const [lobby] = await db
		.insert(lobbies)
		.values({
			createdBy: parsed.userId,
			contestType,
			format: 'open',
			size: maxSize,
			status: 'waiting'
		})
		.returning();

	await db.insert(lobbyParticipants).values({ lobbyId: lobby.id, userId: parsed.userId });

	return json(lobby);
}
