import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';

function requireUser(cookies: { get(name: string): string | undefined }) {
	const token = cookies.get('session');
	return token ? parseSessionToken(token) : null;
}

export async function GET({ cookies }) {
	const parsed = requireUser(cookies);
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!user) return json({ error: 'User not found' }, { status: 404 });

	return json({
		id: user.id,
		username: user.username,
		walletAddress: user.walletAddress,
		xpTotal: user.xpTotal,
		paperXpTotal: user.paperXpTotal,
		streak: user.streak,
		researchStreak: user.researchStreak,
		freeHitsAvailable: user.freeHitsAvailable,
		matchmakingStatus: user.matchmakingStatus,
		activeBoosts: user.activeBoosts || []
	});
}

// Display name only — the one field here that's genuinely public (shown on
// leaderboards, results, everywhere). Everything else about "update your
// info" (name/age/location for the age gate) goes through the Midnight
// commitment flow instead, never through this endpoint.
export async function PATCH({ cookies, request }) {
	const parsed = requireUser(cookies);
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const username = typeof body?.username === 'string' ? body.username.trim() : '';
	if (username.length < 2 || username.length > 24) {
		return json({ error: 'Display name must be 2–24 characters.' }, { status: 400 });
	}
	if (!/^[a-zA-Z0-9_]+$/.test(username)) {
		return json({ error: 'Letters, numbers, and underscores only.' }, { status: 400 });
	}

	try {
		await db.update(users).set({ username }).where(eq(users.id, parsed.userId));
		return json({ username });
	} catch (e) {
		// Postgres unique-violation on users.username — the only realistic
		// failure mode here beyond the validation above.
		const message = e instanceof Error ? e.message : '';
		if (message.includes('unique') || message.includes('duplicate')) {
			return json({ error: 'That display name is already taken.' }, { status: 409 });
		}
		return json({ error: 'Could not update display name.' }, { status: 500 });
	}
}
