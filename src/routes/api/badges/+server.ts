import { json } from '@sveltejs/kit';
import { parseSessionToken } from '$lib/server/auth';
import { getUserBadges } from '$lib/server/badges';

export async function GET({ cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const badges = await getUserBadges(parsed.userId);
	return json(badges);
}
