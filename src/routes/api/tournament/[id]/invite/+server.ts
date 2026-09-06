import { json } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { db } from '$lib/server/db';
import { tournaments, tournamentInvites, users } from '$lib/server/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { sendEmail, isEmailConfigured, tournamentInviteEmail } from '$lib/server/email';

// POST /api/tournament/[id]/invite — create an invite, optionally emailed.
//
// Three guards, because a send-mail endpoint is an abuse magnet:
//   1. Authenticated.
//   2. Creator-only — you can't invite people to someone else's tournament.
//   3. Rate limited per tournament, so a compromised session can't turn this
//      into a spam cannon from the project's Gmail account.
//
// The invite token is the credential. Email is only a way to deliver it, so a
// failed send still returns a usable link rather than losing the invite.

const MAX_INVITES_PER_TOURNAMENT = 50;
const MAX_INVITES_PER_HOUR = 20;

export async function POST({ params, request, cookies, url }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const tournamentId = params.id;
	const tournament = await db
		.select()
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!tournament) return json({ error: 'Tournament not found' }, { status: 404 });

	if (tournament.createdBy !== parsed.userId) {
		return json({ error: 'Only the organiser can invite players' }, { status: 403 });
	}
	if (tournament.status !== 'open') {
		return json({ error: 'This tournament is no longer accepting players' }, { status: 400 });
	}

	const body = await request.json().catch(() => ({}));
	const email = typeof body?.email === 'string' ? body.email.trim() : null;
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'That email address does not look right' }, { status: 400 });
	}

	// ── Rate limits ───────────────────────────────────────────────────────────
	const total = await db
		.select({ n: sql<number>`count(*)` })
		.from(tournamentInvites)
		.where(eq(tournamentInvites.tournamentId, tournamentId))
		.then((r) => Number(r[0]?.n ?? 0));
	if (total >= MAX_INVITES_PER_TOURNAMENT) {
		return json(
			{ error: `A tournament can have at most ${MAX_INVITES_PER_TOURNAMENT} invites.` },
			{ status: 429 }
		);
	}

	const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
	const recent = await db
		.select({ n: sql<number>`count(*)` })
		.from(tournamentInvites)
		.where(
			and(eq(tournamentInvites.invitedBy, parsed.userId), gte(tournamentInvites.createdAt, hourAgo))
		)
		.then((r) => Number(r[0]?.n ?? 0));
	if (recent >= MAX_INVITES_PER_HOUR) {
		return json(
			{ error: 'You have sent a lot of invites recently. Try again in an hour.' },
			{ status: 429 }
		);
	}

	// 32 bytes of randomness — this is a credential, not an identifier.
	const inviteToken = randomBytes(24).toString('base64url');

	const [invite] = await db
		.insert(tournamentInvites)
		.values({ tournamentId, token: inviteToken, email, invitedBy: parsed.userId })
		.returning();

	// There's no /tournament/[id] page — this is a single flat page keyed off
	// query params, not routing. This used to point at /tournament/<id>, a URL
	// with no matching route at all — every invite link 404'd.
	const joinUrl = `${url.origin}/tournament?id=${tournamentId}&invite=${inviteToken}`;

	// Email, if there's an address and mail is available. A failure here is
	// reported but never fatal — the caller still has a working link.
	let emailStatus: string = email ? 'pending' : 'skipped';
	if (email) {
		if (!isEmailConfigured()) {
			emailStatus = 'not_configured';
		} else {
			const inviter = await db
				.select({ username: users.username })
				.from(users)
				.where(eq(users.id, parsed.userId))
				.limit(1)
				.then((r) => r[0]?.username ?? 'A player');

			const { subject, content } = tournamentInviteEmail({
				tournamentName: tournament.name,
				inviterName: inviter,
				joinUrl,
				closesAt: tournament.registrationClosesAt
					? new Date(tournament.registrationClosesAt)
					: null
			});

			const sent = await sendEmail({ to: email, subject, content });
			emailStatus = sent.ok ? 'sent' : sent.reason;
			if (sent.ok) {
				await db
					.update(tournamentInvites)
					.set({ emailSentAt: new Date() })
					.where(eq(tournamentInvites.id, invite.id));
			}
		}
	}

	return json({
		inviteId: invite.id,
		joinUrl,
		email,
		emailStatus,
		// So the UI can tell the organiser to copy the link rather than silently
		// assuming an email arrived.
		emailAvailable: isEmailConfigured()
	});
}
