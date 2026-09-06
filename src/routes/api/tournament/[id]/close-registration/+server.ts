import { json } from '@sveltejs/kit';
import { parseSessionToken } from '$lib/server/auth';
import { closeRegistration } from '$lib/server/tournament-resolution';

export async function POST({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const result = await closeRegistration(params.id, parsed.userId);
	if ('error' in result) {
		const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400;
		return json({ error: result.error }, { status });
	}
	return json(result);
}
