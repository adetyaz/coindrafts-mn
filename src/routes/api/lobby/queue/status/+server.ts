import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants } from '$lib/server/schema';
import { eq, and, desc } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const match = await db
		.select({ lobbyId: lobbyParticipants.lobbyId })
		.from(lobbyParticipants)
		.innerJoin(lobbies, eq(lobbies.id, lobbyParticipants.lobbyId))
		.where(and(eq(lobbyParticipants.userId, parsed.userId), eq(lobbies.status, 'drafting')))
		.orderBy(desc(lobbies.createdAt))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (match) return json({ status: 'matched', lobbyId: match.lobbyId });
	return json({ status: 'waiting' });
}
