// On-chain achievement badges (CoinDraftAchievements.sol on 0G Chain).
//
// This module never sends a transaction — it only SIGNS vouchers. The player
// claims for themselves, from their own wallet, paying their own gas; the
// contract verifies the signature on-chain before minting anything. See
// contracts/contracts/CoinDraftAchievements.sol and ARCHITECTURE.md.
import { ethers } from 'ethers';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, gauntletAttempts, userBadges } from '$lib/server/schema';
import { ACHIEVEMENTS_ABI } from '$lib/achievementsAbi';
import { ZG_CHAIN, ZG_STORAGE } from '$lib/server/zgNetwork';

// Must match the order achievements were added on-chain — typeId is just an
// array index on-chain, there's no name-based lookup. 0-3 seeded via
// contracts/scripts/seed-achievements.ts, 4-8 via
// contracts/scripts/add-more-achievement-types.ts (closing the gap where
// these 5 showed as "earned" in the off-chain Badge cabinet — src/lib/badges.ts
// — but had no on-chain type to claim).
export const ACHIEVEMENT_TYPES = {
	FIRST_WIN_OPPONENT: 0,
	FIRST_WIN_BOT: 1,
	QUIZ_CORRECT: 2,
	QUIZ_STREAK_5: 3,
	WIN_STREAK_3: 4,
	WIN_STREAK_5: 5,
	VETERAN_10: 6,
	VETERAN_25: 7,
	LEAGUE_FOUNDER: 8
} as const;

export const ACHIEVEMENT_META: Record<number, { name: string; description: string }> = {
	[ACHIEVEMENT_TYPES.FIRST_WIN_OPPONENT]: {
		name: 'First Blood',
		description: 'Won your first head-to-head match against a real opponent.'
	},
	[ACHIEVEMENT_TYPES.FIRST_WIN_BOT]: {
		name: 'Scrimmage Starter',
		description: 'Won your first Scrimmage match against a bot.'
	},
	[ACHIEVEMENT_TYPES.QUIZ_CORRECT]: {
		name: 'Sharp Shooter',
		description: 'Answered a Gauntlet quiz question correctly.'
	},
	[ACHIEVEMENT_TYPES.QUIZ_STREAK_5]: {
		name: 'Know-It-All',
		description: 'Answered 5 Gauntlet quiz questions correctly in a row.'
	},
	[ACHIEVEMENT_TYPES.WIN_STREAK_3]: {
		name: 'On Fire',
		description: 'Won 3 contests in a row.'
	},
	[ACHIEVEMENT_TYPES.WIN_STREAK_5]: {
		name: 'Unstoppable',
		description: 'Won 5 contests in a row.'
	},
	[ACHIEVEMENT_TYPES.VETERAN_10]: {
		name: 'Veteran',
		description: 'Won 10 contests total.'
	},
	[ACHIEVEMENT_TYPES.VETERAN_25]: {
		name: 'Champion',
		description: 'Won 25 contests total.'
	},
	[ACHIEVEMENT_TYPES.LEAGUE_FOUNDER]: {
		name: 'League Founder',
		description: 'Created your first league.'
	}
};

// Maps the 5 win/streak/league badges to the same badge_code the off-chain
// Badge cabinet already grants them under (src/lib/server/badges.ts) — reuses
// that table as the source of truth instead of re-deriving win totals here,
// so the two systems can never drift apart on what counts as "earned".
const BADGE_CODE_TO_TYPE_ID: Record<string, number> = {
	win_streak_3: ACHIEVEMENT_TYPES.WIN_STREAK_3,
	win_streak_5: ACHIEVEMENT_TYPES.WIN_STREAK_5,
	veteran_10: ACHIEVEMENT_TYPES.VETERAN_10,
	veteran_25: ACHIEVEMENT_TYPES.VETERAN_25,
	league_founder: ACHIEVEMENT_TYPES.LEAGUE_FOUNDER
};

function isConfigured(): boolean {
	return Boolean(ZG_CHAIN.contractAddress && ZG_STORAGE.privateKey);
}

function getProvider() {
	return new ethers.JsonRpcProvider(ZG_CHAIN.rpcUrl);
}

function getReadContract() {
	return new ethers.Contract(ZG_CHAIN.contractAddress!, ACHIEVEMENTS_ABI, getProvider());
}

/** Off-chain conditions only — does NOT check whether it's already been claimed on-chain. */
async function checkEligibility(userId: string): Promise<number[]> {
	const eligible: number[] = [];

	const wonVsOpponent = await db
		.select({ id: contests.id })
		.from(contests)
		.where(and(eq(contests.winnerId, userId), eq(contests.isPaper, false)))
		.limit(1);
	if (wonVsOpponent.length > 0) eligible.push(ACHIEVEMENT_TYPES.FIRST_WIN_OPPONENT);

	const wonVsBot = await db
		.select({ id: contests.id })
		.from(contests)
		.where(and(eq(contests.winnerId, userId), eq(contests.isPaper, true)))
		.limit(1);
	if (wonVsBot.length > 0) eligible.push(ACHIEVEMENT_TYPES.FIRST_WIN_BOT);

	const anyCorrect = await db
		.select({ id: gauntletAttempts.id })
		.from(gauntletAttempts)
		.where(and(eq(gauntletAttempts.userId, userId), eq(gauntletAttempts.correct, true)))
		.limit(1);
	if (anyCorrect.length > 0) eligible.push(ACHIEVEMENT_TYPES.QUIZ_CORRECT);

	const lastFive = await db
		.select({ correct: gauntletAttempts.correct })
		.from(gauntletAttempts)
		.where(eq(gauntletAttempts.userId, userId))
		.orderBy(desc(gauntletAttempts.attemptedAt))
		.limit(5);
	if (lastFive.length === 5 && lastFive.every((a) => a.correct)) {
		eligible.push(ACHIEVEMENT_TYPES.QUIZ_STREAK_5);
	}

	const earnedCodes = await db
		.select({ badgeCode: userBadges.badgeCode })
		.from(userBadges)
		.where(and(eq(userBadges.userId, userId), inArray(userBadges.badgeCode, Object.keys(BADGE_CODE_TO_TYPE_ID))));
	for (const { badgeCode } of earnedCodes) {
		eligible.push(BADGE_CODE_TO_TYPE_ID[badgeCode]);
	}

	return eligible;
}

/** Off-chain eligibility, minus whatever's already claimed on-chain. Empty (with `configured: false`) until env vars are set. */
export async function getClaimableAchievements(
	userId: string,
	walletAddress: string,
	chainType: string
): Promise<{ configured: boolean; claimable: { typeId: number; name: string; description: string }[] }> {
	if (!isConfigured()) return { configured: false, claimable: [] };
	// Badges live on 0G Chain, which is EVM — a Solana-signed-in user has no
	// address this contract can mint to. Known gap, not silently ignored.
	if (chainType !== 'evm') return { configured: true, claimable: [] };

	const eligibleTypeIds = await checkEligibility(userId);
	if (eligibleTypeIds.length === 0) return { configured: true, claimable: [] };

	const contract = getReadContract();
	const claimable: { typeId: number; name: string; description: string }[] = [];
	for (const typeId of eligibleTypeIds) {
		const already: boolean = await contract.hasAchievement(walletAddress, typeId);
		if (!already) claimable.push({ typeId, ...ACHIEVEMENT_META[typeId] });
	}
	return { configured: true, claimable };
}

/**
 * Signs a claim voucher for (contract, walletAddress, typeId) — this is the
 * exact hash CoinDraftAchievements.claimAchievement() verifies on-chain via
 * ECDSA.recover. Re-checks eligibility itself rather than trusting the
 * caller, since this is the one function that actually authorizes a mint.
 */
export async function signClaimVoucher(
	userId: string,
	walletAddress: string,
	typeId: number
): Promise<{ ok: true; signature: string; contractAddress: string } | { ok: false; error: string }> {
	if (!isConfigured()) return { ok: false, error: 'Achievements are not configured yet.' };

	const eligibleTypeIds = await checkEligibility(userId);
	if (!eligibleTypeIds.includes(typeId)) {
		return { ok: false, error: "You haven't earned this achievement yet." };
	}

	const contract = getReadContract();
	const already: boolean = await contract.hasAchievement(walletAddress, typeId);
	if (already) return { ok: false, error: 'Already claimed.' };

	const contractAddress = ZG_CHAIN.contractAddress!;
	// Must match `keccak256(abi.encodePacked(address(this), msg.sender, typeId))`
	// + toEthSignedMessageHash() on-chain, exactly.
	const voucher = ethers.solidityPackedKeccak256(
		['address', 'address', 'uint256'],
		[contractAddress, walletAddress, typeId]
	);
	const signer = new ethers.Wallet(ZG_STORAGE.privateKey!);
	const signature = await signer.signMessage(ethers.getBytes(voucher));

	return { ok: true, signature, contractAddress };
}
