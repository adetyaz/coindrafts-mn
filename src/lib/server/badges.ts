import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lobbies, userBadges, users } from '$lib/server/schema';
import { BADGES } from '$lib/badges';

async function grantIfMissing(userId: string, candidateCodes: string[]): Promise<string[]> {
	if (candidateCodes.length === 0) return [];

	const already = await db
		.select({ badgeCode: userBadges.badgeCode })
		.from(userBadges)
		.where(and(eq(userBadges.userId, userId), inArray(userBadges.badgeCode, candidateCodes)));
	const alreadySet = new Set(already.map((b) => b.badgeCode));

	const toGrant = candidateCodes.filter((c) => !alreadySet.has(c));
	if (toGrant.length === 0) return [];

	await db.insert(userBadges).values(toGrant.map((badgeCode) => ({ userId, badgeCode })));
	return toGrant;
}

/** Checks win-count and streak based badges after a contest resolves. Idempotent. */
export async function awardWinBadges(userId: string): Promise<string[]> {
	const user = await db
		.select({ streak: users.streak })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	// Scrimmage wins (contests.isPaper) never count toward real milestones —
	// the call sites already skip calling this function for a paper win
	// itself, but without this filter a later real win would still count
	// every past Scrimmage win in the total (H-03).
	const contestWins = await db
		.select({ id: contests.id })
		.from(contests)
		.where(and(eq(contests.winnerId, userId), eq(contests.isPaper, false)))
		.then((rows) => rows.length);

	const lobbyWins = await db
		.select({ id: lobbies.id })
		.from(lobbies)
		.where(eq(lobbies.winnerId, userId))
		.then((rows) => rows.length);

	const totalWins = contestWins + lobbyWins;

	const streak = user?.streak ?? 0;
	const candidates: string[] = [];

	if (totalWins >= 1) candidates.push('first_blood');
	if (totalWins >= 10) candidates.push('veteran_10');
	if (totalWins >= 25) candidates.push('veteran_25');
	if (streak >= 3) candidates.push('win_streak_3');
	if (streak >= 5) candidates.push('win_streak_5');

	return grantIfMissing(userId, candidates);
}

export async function awardLeagueFounderBadge(userId: string): Promise<string[]> {
	return grantIfMissing(userId, ['league_founder']);
}

export async function getUserBadges(userId: string) {
	const earned = await db
		.select({ badgeCode: userBadges.badgeCode, earnedAt: userBadges.earnedAt })
		.from(userBadges)
		.where(eq(userBadges.userId, userId));

	const earnedMap = new Map(earned.map((e) => [e.badgeCode, e.earnedAt]));

	return BADGES.map((b) => ({
		...b,
		earned: earnedMap.has(b.code),
		earnedAt: earnedMap.get(b.code) ?? null
	}));
}
