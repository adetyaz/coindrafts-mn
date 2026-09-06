import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { lobbies, lobbyParticipants, lineups, lineupPicks, users } from '$lib/server/schema';
import { parseSessionToken } from '$lib/server/auth';
import { resolveLobby } from '$lib/server/lobby-resolution';
import { awardWinBadges } from '$lib/server/badges';

export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const lobbyId = params.id;
	if (!lobbyId) return json({ error: 'Lobby id is required' }, { status: 400 });

	let lobby = await db
		.select()
		.from(lobbies)
		.where(eq(lobbies.id, lobbyId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!lobby) return json({ error: 'Lobby not found' }, { status: 404 });

	const myMembership = await db
		.select()
		.from(lobbyParticipants)
		.where(and(eq(lobbyParticipants.lobbyId, lobbyId), eq(lobbyParticipants.userId, parsed.userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!myMembership) return json({ error: 'Forbidden' }, { status: 403 });

	if (lobby.status === 'live') {
		const result = await resolveLobby(lobbyId);
		if (!result.resolved) {
			return json({ error: 'Not every player has submitted a lineup yet' }, { status: 400 });
		}
		lobby = await db
			.select()
			.from(lobbies)
			.where(eq(lobbies.id, lobbyId))
			.limit(1)
			.then((rows) => rows[0]);
	}

	if (lobby.status !== 'resolved') {
		return json({ error: 'Lobby is not live yet' }, { status: 400 });
	}

	const ranked = await db
		.select({
			userId: lobbyParticipants.userId,
			rank: lobbyParticipants.rank,
			xpEarned: lobbyParticipants.xpEarned,
			username: users.username
		})
		.from(lobbyParticipants)
		.leftJoin(users, eq(users.id, lobbyParticipants.userId))
		.where(eq(lobbyParticipants.lobbyId, lobbyId));

	const scores = await db
		.select({ userId: lineups.userId, finalScore: lineups.finalScore })
		.from(lineups)
		.where(eq(lineups.lobbyId, lobbyId));
	const scoreByUser = new Map(scores.map((s) => [s.userId, Number(s.finalScore ?? 0)]));

	const leaderboard = ranked
		.map((r) => ({
			rank: r.rank ?? 0,
			username: r.username ?? 'Player',
			score: Math.round(scoreByUser.get(r.userId) ?? 0),
			xpEarned: r.xpEarned ?? 0,
			isMe: r.userId === parsed.userId
		}))
		.sort((a, b) => a.rank - b.rank);

	const myLineup = await db
		.select()
		.from(lineups)
		.where(and(eq(lineups.lobbyId, lobbyId), eq(lineups.userId, parsed.userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	const breakdown = myLineup
		? await db
				.select()
				.from(lineupPicks)
				.where(eq(lineupPicks.lineupId, myLineup.id))
				.then((picks) =>
					picks.map((p) => ({
						sector: p.sector,
						pick: p.tokenSymbol,
						pct: Number(Number(p.pctChange ?? 0).toFixed(2)),
						points: Number(Number(p.score ?? 0).toFixed(2))
					}))
				)
		: [];

	const myRank = leaderboard.find((r) => r.isMe)?.rank ?? null;
	const didWin = myRank === 1;
	const newBadges = didWin ? await awardWinBadges(parsed.userId) : [];

	return json({
		lobbyId,
		size: lobby.size,
		contestType: lobby.contestType,
		myRank,
		myXp: leaderboard.find((r) => r.isMe)?.xpEarned ?? 0,
		leaderboard,
		breakdown,
		newBadges
	});
}
