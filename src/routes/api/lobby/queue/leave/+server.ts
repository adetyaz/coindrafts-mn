import { json } from '@sveltejs/kit';
import { parseSessionToken } from '$lib/server/auth';
import { dequeueLobby } from '$lib/server/lobby-matchmaking';

export async function POST({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	await dequeueLobby(parsed.userId);
	return json({ ok: true });
}
