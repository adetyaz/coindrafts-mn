// Wager mechanic: tier-locked matching + blind commit, settling at the lower
// of the two commits.
//
// The design deliberately has no timer, no counter-offer and no deadlock:
//
//   1. Players are MATCHED on a tier, so being paired is already consent to
//      that stake. That's the whole agreement for anyone who just wants to play.
//   2. Either may privately RAISE. The stake settles at the MINIMUM across
//      players, so nobody can ever be pushed above their own number.
//
// Because the settle-at-minimum rule makes raising strictly safe, none of the
// hard problems of a negotiation exist here — there is no state where a player
// is waiting on someone else to decide, so nothing can hang.
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { stakes, stakeParticipants, contests } from '$lib/server/schema';
import { getSettlementProvider } from '$lib/server/settlement';

/**
 * Matching buckets. Kept few and coarse on purpose: every tier splits the
 * matching pool, and duration already splits it. "About 50" is the unit of
 * agreement — the exact figure is settled per game by the commits below.
 */
export const STAKE_TIERS = [0, 25, 50, 100, 250] as const;

export function normalizeTier(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	// Snap to the nearest legal tier rather than rejecting — the tier is a
	// matching bucket, not a precise amount.
	return STAKE_TIERS.reduce((best, t) =>
		Math.abs(t - n) < Math.abs(best - n) ? t : best
	);
}

/** Creates the stake for a contest once both players are known. */
export async function createStakeForContest(
	contestId: string,
	tierAmount: number,
	userIds: string[]
) {
	const tier = normalizeTier(tierAmount);
	if (tier === 0) return { ok: false as const, reason: 'no_stake' };

	const existing = await db
		.select()
		.from(stakes)
		.where(eq(stakes.contestId, contestId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (existing) return { ok: true as const, stakeId: existing.id, alreadyExisted: true };

	const [stake] = await db
		.insert(stakes)
		.values({ contestId, tierAmount: tier, status: 'proposed' })
		.returning();

	await db
		.insert(stakeParticipants)
		.values(userIds.map((userId) => ({ stakeId: stake.id, userId })));

	return { ok: true as const, stakeId: stake.id, alreadyExisted: false };
}

/**
 * A player commits what they're willing to risk — at least the tier, or more.
 *
 * Private until everyone has committed: that's what makes this a blind commit
 * rather than a negotiation, and why raising can't be used to pressure anyone.
 */
export async function commitToStake(
	stakeId: string,
	userId: string,
	amount: number,
	confirmedAdult: boolean
) {
	const stake = await db
		.select()
		.from(stakes)
		.where(eq(stakes.id, stakeId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!stake) return { ok: false as const, reason: 'not_found' };
	if (stake.status !== 'proposed') return { ok: false as const, reason: 'already_locked' };

	// G-03 AC 1 — 18+ before any amount can be set. Checked per player, since
	// each commits separately.
	//
	// NOTE: this is a self-report, not evidence — the client asserts it and the
	// server takes its word. Making it a wallet-signed attestation is tracked in
	// docs-project/whats-next.md.
	if (!confirmedAdult) return { ok: false as const, reason: 'age_not_confirmed' };

	// You may raise above the tier, never below it — the tier is what both
	// players were matched on, so dropping under it would break that agreement.
	const committed = Math.max(stake.tierAmount, Math.floor(amount));

	const me = await db
		.select()
		.from(stakeParticipants)
		.where(and(eq(stakeParticipants.stakeId, stakeId), eq(stakeParticipants.userId, userId)))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!me) return { ok: false as const, reason: 'not_a_participant' };
	if (me.committed != null) return { ok: false as const, reason: 'already_committed' };

	await db
		.update(stakeParticipants)
		.set({ committed, confirmedAdult: true, committedAt: new Date() })
		.where(eq(stakeParticipants.id, me.id));

	// Everyone in? Then the wager is decided.
	const all = await db
		.select()
		.from(stakeParticipants)
		.where(eq(stakeParticipants.stakeId, stakeId));

	const pending = all.filter((p) => p.committed == null);
	if (pending.length > 0) {
		return { ok: true as const, status: 'waiting', committed, waitingOn: pending.length };
	}

	// Settle at the LOWER of the commits — the rule that makes raising safe.
	const agreed = Math.min(...all.map((p) => p.committed ?? 0));

	const provider = getSettlementProvider();
	for (const p of all) {
		if (!p.userId) continue;
		const held = await provider.hold(stakeId, p.userId, agreed);
		if (!held.ok) {
			// One player can't cover it — unwind rather than lock a wager only
			// one side has actually funded.
			await provider.refund(stakeId, `hold_failed:${held.reason}`);
			await db.update(stakes).set({ status: 'cancelled' }).where(eq(stakes.id, stakeId));
			return { ok: false as const, reason: held.reason };
		}
	}

	await db
		.update(stakes)
		.set({ agreedAmount: agreed, status: 'locked' })
		.where(eq(stakes.id, stakeId));

	return { ok: true as const, status: 'locked', agreed };
}

/**
 * Pays out a wagered contest. Called at resolution, after a winner exists.
 *
 * Idempotent: only acts on a stake still in `locked`, so a contest resolved
 * twice can't pay twice.
 */
export async function settleStakeForContest(contestId: string, winnerId: string | null) {
	const stake = await db
		.select()
		.from(stakes)
		.where(eq(stakes.contestId, contestId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!stake || stake.status !== 'locked') return { ok: false as const, reason: 'no_locked_stake' };

	const parts = await db
		.select()
		.from(stakeParticipants)
		.where(eq(stakeParticipants.stakeId, stake.id));

	const provider = getSettlementProvider();
	const amount = stake.agreedAmount ?? 0;

	// No winner (a tie, or an unresolvable contest) returns everyone's stake
	// rather than picking arbitrarily.
	if (!winnerId) {
		await provider.refund(stake.id, 'no_winner');
		return { ok: true as const, outcome: 'refunded' as const };
	}

	// The hold already took each player's stake, so the winner is credited the
	// whole pot and the loser is credited nothing — their loss is the hold.
	const pot = amount * parts.length;
	await provider.release(
		stake.id,
		parts.map((p) => ({
			userId: p.userId as string,
			amount: p.userId === winnerId ? pot : 0
		}))
	);

	return { ok: true as const, outcome: 'settled' as const, pot };
}

/** Returns any stake still holding value for a contest that will never resolve. */
export async function refundStakesForContests(contestIds: string[], reason: string) {
	if (contestIds.length === 0) return;
	const open = await db
		.select()
		.from(stakes)
		.where(and(inArray(stakes.contestId, contestIds), eq(stakes.status, 'locked')));

	const provider = getSettlementProvider();
	for (const s of open) await provider.refund(s.id, reason);
}

/** Head-to-head record, for the rematch loop. */
export async function headToHead(userId: string, opponentId: string) {
	const rows = await db
		.select({ winnerId: contests.winnerId, userAId: contests.userAId, userBId: contests.userBId })
		.from(contests)
		.where(eq(contests.status, 'resolved'));

	let wins = 0;
	let losses = 0;
	for (const c of rows) {
		const pair =
			(c.userAId === userId && c.userBId === opponentId) ||
			(c.userBId === userId && c.userAId === opponentId);
		if (!pair) continue;
		if (c.winnerId === userId) wins++;
		else if (c.winnerId === opponentId) losses++;
	}
	return { wins, losses };
}
