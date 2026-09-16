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
		activeBoosts: user.activeBoosts || [],
		// Whether this account has linked a Midnight identity at all — not
		// whether that identity is actually verified 18+ on-chain (that's
		// re-checked independently, server-side, at wager-commit time; see
		// src/lib/server/midnightKyc.ts). This is a UI hint only: enough for
		// the client to show "complete verification" vs. proceed to commit.
		midnightParticipantId: user.midnightParticipantId ?? null
	});
}

const PARTICIPANT_ID_HEX_RE = /^[0-9a-f]{64}$/;

// Two independent, optional updates: the public display name, and linking
// this account to a Midnight KYC identity (src/routes/profile/kyc/+page.svelte
// calls this with `midnightParticipantId` right after a confirmed submitKyc
// transaction). Everything else about "update your info" (name/age/location
// for the age gate) goes through the Midnight commitment flow instead, never
// through this endpoint — only the derived participantId ever lands here.
export async function PATCH({ cookies, request }) {
	const parsed = requireUser(cookies);
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const updates: { username?: string; midnightParticipantId?: string } = {};
	const response: Record<string, unknown> = {};

	if (body && 'username' in body) {
		const username = typeof body.username === 'string' ? body.username.trim() : '';
		if (username.length < 2 || username.length > 24) {
			return json({ error: 'Display name must be 2–24 characters.' }, { status: 400 });
		}
		if (!/^[a-zA-Z0-9_]+$/.test(username)) {
			return json({ error: 'Letters, numbers, and underscores only.' }, { status: 400 });
		}
		updates.username = username;
		response.username = username;
	}

	if (body && 'midnightParticipantId' in body) {
		const hex =
			typeof body.midnightParticipantId === 'string'
				? body.midnightParticipantId.trim().toLowerCase()
				: '';
		if (!PARTICIPANT_ID_HEX_RE.test(hex)) {
			return json({ error: 'Invalid Midnight participant id.' }, { status: 400 });
		}
		updates.midnightParticipantId = hex;
		response.midnightParticipantId = hex;
	}

	if (Object.keys(updates).length === 0) {
		return json({ error: 'Nothing to update.' }, { status: 400 });
	}

	try {
		await db.update(users).set(updates).where(eq(users.id, parsed.userId));
		return json(response);
	} catch (e) {
		// Postgres unique-violation on users.username — the only realistic
		// failure mode here beyond the validation above.
		const message = e instanceof Error ? e.message : '';
		if (message.includes('unique') || message.includes('duplicate')) {
			return json({ error: 'That display name is already taken.' }, { status: 409 });
		}
		return json({ error: 'Could not update.' }, { status: 500 });
	}
}
