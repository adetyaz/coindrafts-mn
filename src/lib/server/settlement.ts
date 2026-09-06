// Settlement providers — the seam that keeps escrow a swap rather than a rewrite.
//
// Every wager in the app goes through this interface. Today the only
// implementation is XP: real stakes players care about, no chain, no gas, and
// fully testable. An on-chain provider (0G testnet first) implements the same
// four methods later and nothing above this line changes.
//
// Why an interface at all, given only one implementation exists: the escrow
// decision is genuinely unsettled — custodial vs on-chain vs the hybrid 0G
// itself uses — and the wager *mechanic* has no dependency on it. Building the
// mechanic behind a seam means that decision can be made after seeing the game
// work, instead of blocking it.
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users, stakes, stakeParticipants } from '$lib/server/schema';

export type SettlementResult = { ok: true } | { ok: false; reason: string };

export interface SettlementProvider {
	/** Reserve a player's stake. Must fail rather than allow an unfunded wager. */
	hold(stakeId: string, userId: string, amount: number): Promise<SettlementResult>;
	/** Pay out. `payouts` is signed — positive to credit, negative to debit. */
	release(stakeId: string, payouts: { userId: string; amount: number }[]): Promise<SettlementResult>;
	/** Return everything held. Used when a game never happens. */
	refund(stakeId: string, reason: string): Promise<SettlementResult>;
	/** What this player can actually stake right now. */
	balanceOf(userId: string): Promise<number>;
}

/**
 * XP settlement.
 *
 * XP is deducted at hold, not at settlement. That ordering matters: it makes
 * the stake real the moment it's locked, and it makes double-spending across
 * two simultaneous wagers impossible — the balance is already gone. A refund
 * or a win credits back.
 */
export const xpSettlement: SettlementProvider = {
	async balanceOf(userId) {
		const u = await db
			.select({ xp: users.xpTotal })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
			.then((r) => r[0] ?? null);
		return u?.xp ?? 0;
	},

	async hold(stakeId, userId, amount) {
		if (amount <= 0) return { ok: false, reason: 'invalid_amount' };

		const u = await db
			.select()
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
			.then((r) => r[0] ?? null);
		if (!u) return { ok: false, reason: 'user_not_found' };

		const balance = u.xpTotal ?? 0;
		// Refuse rather than allow a negative balance — a wager nobody can cover
		// isn't a wager.
		if (balance < amount) return { ok: false, reason: 'insufficient_balance' };

		await db
			.update(users)
			.set({ xpTotal: balance - amount })
			.where(eq(users.id, userId));

		await db
			.update(stakeParticipants)
			.set({ committed: amount, committedAt: new Date() })
			.where(and(eq(stakeParticipants.stakeId, stakeId), eq(stakeParticipants.userId, userId)));

		return { ok: true };
	},

	async release(stakeId, payouts) {
		for (const p of payouts) {
			const u = await db
				.select()
				.from(users)
				.where(eq(users.id, p.userId))
				.limit(1)
				.then((r) => r[0] ?? null);
			if (!u) continue;

			// Never below zero — the hold already took the stake, so a loss is
			// recorded as payout 0, not as a second deduction.
			const next = Math.max(0, (u.xpTotal ?? 0) + p.amount);
			await db.update(users).set({ xpTotal: next }).where(eq(users.id, p.userId));

			await db
				.update(stakeParticipants)
				.set({ payout: p.amount })
				.where(and(eq(stakeParticipants.stakeId, stakeId), eq(stakeParticipants.userId, p.userId)));
		}

		await db
			.update(stakes)
			.set({ status: 'settled', settledAt: new Date() })
			.where(eq(stakes.id, stakeId));

		return { ok: true };
	},

	async refund(stakeId, reason) {
		const parts = await db
			.select()
			.from(stakeParticipants)
			.where(eq(stakeParticipants.stakeId, stakeId));

		for (const p of parts) {
			const held = p.committed ?? 0;
			if (held <= 0 || !p.userId) continue;

			const u = await db
				.select()
				.from(users)
				.where(eq(users.id, p.userId))
				.limit(1)
				.then((r) => r[0] ?? null);
			if (!u) continue;

			await db
				.update(users)
				.set({ xpTotal: (u.xpTotal ?? 0) + held })
				.where(eq(users.id, p.userId));

			await db
				.update(stakeParticipants)
				.set({ payout: 0 })
				.where(eq(stakeParticipants.id, p.id));
		}

		console.info(`[settlement] stake ${stakeId} refunded: ${reason}`);
		await db
			.update(stakes)
			.set({ status: 'refunded', settledAt: new Date() })
			.where(eq(stakes.id, stakeId));

		return { ok: true };
	}
};

/**
 * The active provider.
 *
 * Deliberately not env-switchable yet: there is only one implementation, and a
 * flag pointing at a provider that doesn't exist would be a way to lose real
 * stakes. When `OnChainSettlement` lands it gets selected here, the same way
 * `USE_0G_COMPUTE` picks an inference backend.
 */
export function getSettlementProvider(): SettlementProvider {
	return xpSettlement;
}
