import { parseSessionToken, getUserById } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';

const PROTECTED = ['/contest', '/draft', '/matchmaking'];

export async function load({ cookies, url }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	const user = parsed ? await getUserById(parsed.userId) : null;

	if (!user && PROTECTED.some((p) => url.pathname.startsWith(p))) {
		throw redirect(302, '/?auth=required');
	}

	return { user };
}
