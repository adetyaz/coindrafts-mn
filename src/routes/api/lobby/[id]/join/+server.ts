import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

export async function POST({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const lobbyId = params.id;
	const lobby = await db
		.select()
		.from(lobbies)
		.where(eq(lobbies.id, lobbyId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!lobby) return json({ error: 'Lobby not found' }, { status: 404 });
	if (lobby.status !== 'waiting') return json({ error: 'Lobby already started' }, { status: 400 });

	const participants = await db
		.select()
		.from(lobbyParticipants)
		.where(eq(lobbyParticipants.lobbyId, lobbyId));

	if (participants.some((p) => p.userId === parsed.userId)) {
		return json({ ok: true, alreadyJoined: true });
	}

	if (lobby.size != null && participants.length >= lobby.size) {
		return json({ error: 'Lobby is full' }, { status: 400 });
	}

	await db.insert(lobbyParticipants).values({ lobbyId, userId: parsed.userId });
	return json({ ok: true });
}
