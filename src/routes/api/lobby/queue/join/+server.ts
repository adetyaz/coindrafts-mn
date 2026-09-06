import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants } from '$lib/server/schema';
import { parseSessionToken } from '$lib/server/auth';
import { findLobbyGroup, enqueueLobby } from '$lib/server/lobby-matchmaking';

const ALLOWED_SIZES = [4, 6, 8];

export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const size = ALLOWED_SIZES.includes(body.size) ? body.size : 4;
	const contestType = body.type === 'weekly' ? 'weekly' : 'daily';

	const group = await findLobbyGroup(parsed.userId, size, contestType);

	if (group) {
		const allUserIds = [...group, parsed.userId];
		const [lobby] = await db
			.insert(lobbies)
			.values({ createdBy: parsed.userId, contestType, format: 'fixed', size, status: 'drafting' })
			.returning();

		await db
			.insert(lobbyParticipants)
			.values(allUserIds.map((userId) => ({ lobbyId: lobby.id, userId })));

		return json({ status: 'matched', lobbyId: lobby.id });
	}

	await enqueueLobby(parsed.userId, size, contestType);
	return json({ status: 'waiting', message: `Waiting for ${size - 1} more players...` });
}
