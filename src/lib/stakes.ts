// Client-safe stake constants.
//
// Mirrors STAKE_TIERS in src/lib/server/wager.ts, which is the authority — the
// server clamps whatever arrives, so a mismatch here can't produce an illegal
// stake, only a confusing menu. Duplicated rather than imported because
// wager.ts pulls in the database and can't cross into client code.

/** Matching buckets. Deliberately few: every tier splits the matching pool. */
export const STAKE_TIERS = [0, 25, 50, 100, 250] as const;

export function stakeLabel(tier: number): string {
	return tier === 0 ? 'No stake' : `${tier} XP`;
}
