import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { ensureTodaySeeded } from '$lib/server/gauntlet';

async function seed(authHeader: string | null, fetchFn: typeof fetch) {
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const today = new Date().toISOString().split('T')[0];
	const question = await ensureTodaySeeded(today, fetchFn);
	return json({ message: `Question ready for ${today}`, questionId: question.id });
}

// Vercel Cron Jobs send GET requests
export async function GET({ request, fetch }) {
	return seed(request.headers.get('authorization'), fetch);
}

// Kept for manual/local triggering
export async function POST({ request, fetch }) {
	return seed(request.headers.get('authorization'), fetch);
}
