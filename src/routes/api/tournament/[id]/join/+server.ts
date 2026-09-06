import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { tournaments, tournamentInvites } from '$lib/server/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { joinTournament } from '$lib/server/tournament-resolution';

export async function POST({ params, request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const tournamentId = params.id;
	const body = await request.json().catch(() => ({}));
	const inviteToken = typeof body?.invite === 'string' ? body.invite : null;

	const tournament = await db
		.select()
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!tournament) return json({ error: 'Tournament not found' }, { status: 404 });

	// ── Private tournaments require a valid, unclaimed invite ─────────────────
	// A private tournament isn't listed anywhere, but "unlisted" is not access
	// control — without this check anyone with the id could join one.
	let invite = null;
	if (tournament.accessType === 'private') {
		if (!inviteToken) {
			return json(
				{ error: 'This tournament is invite-only.', reason: 'invite_required' },
				{ status: 403 }
			);
		}

		invite = await db
			.select()
			.from(tournamentInvites)
			.where(
				and(
					eq(tournamentInvites.token, inviteToken),
					eq(tournamentInvites.tournamentId, tournamentId),
					// Single use — a forwarded link can't admit a crowd.
					isNull(tournamentInvites.acceptedBy)
				)
			)
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!invite) {
			return json(
				{ error: 'That invite is invalid or has already been used.', reason: 'invite_invalid' },
				{ status: 403 }
			);
		}
	}

	const result = await joinTournament(tournamentId, parsed.userId);
	if ('error' in result) {
		const status = result.error === 'not_found' ? 404 : 400;
		return json({ error: result.error }, { status });
	}

	// Claim the invite only after the join actually succeeded — burning it on a
	// failed join would strand the player with a dead link.
	if (invite) {
		await db
			.update(tournamentInvites)
			.set({ acceptedBy: parsed.userId, acceptedAt: new Date() })
			.where(eq(tournamentInvites.id, invite.id));
	}

	return json(result);
}
