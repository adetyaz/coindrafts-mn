import { getSnapshot } from '$lib/server/sosovalue';
import { json } from '@sveltejs/kit';

export async function GET({ params }) {
	try {
		const data = await getSnapshot(params.id);
		return json(data);
	} catch (error) {
		console.error('Error fetching snapshot:', error);
		return json({ error: 'Failed to fetch snapshot' }, { status: 500 });
	}
}
