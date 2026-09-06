// Word of the Day — a standalone daily vocabulary ritual, its own feature on
// the Knowledge Base page, distinct from the Gauntlet. Both draw from the
// SAME AI-generated, 0G-Storage-backed vocab pool (see ensureVocabPool in
// gauntlet.ts) — this is deliberately not a second, separate generator. They
// must never show the same term on the same day though: if the Gauntlet's
// 'vocab' category has already been seeded for today, its term is excluded
// here before picking. The matching exclusion runs the other way in
// gauntlet.ts's pickFromVocabPool, so whichever of the two seeds second is
// the one that actually avoids the collision.
import { db } from '$lib/server/db';
import { dailyTerms, users, vocabPool, gauntletQuestions } from '$lib/server/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ensureVocabPoolReady } from '$lib/server/gauntlet';

// Static fallback — reached only if the shared vocab pool is completely
// empty and generation has failed for it too (see ensureVocabPool).
const TERM_BANK: { term: string; definition: string; distractors: string[] }[] = [
	{
		term: 'TVL',
		definition: 'Total Value Locked — the total value of assets deposited in a protocol.',
		distractors: [
			'Total Volume Leveraged — the sum of all leveraged positions open on an exchange.',
			'Token Vesting Ledger — a record of when locked team tokens unlock.',
			'Transaction Verification Latency — how long a network takes to confirm a transaction.'
		]
	},
	{
		term: 'Slippage',
		definition: "The difference between a trade's expected price and its actual executed price.",
		distractors: [
			'The fee an exchange charges for executing a trade.',
			'The delay between placing an order and it appearing on-chain.',
			'The percentage of a token supply held by its top 10 wallets.'
		]
	},
	{
		term: 'Gas fee',
		definition: 'The cost paid to have a transaction processed and included on a blockchain.',
		distractors: [
			'A recurring subscription fee charged by a crypto exchange.',
			"The spread between a token's buy and sell price.",
			'A penalty charged for withdrawing staked tokens early.'
		]
	}
];

type TermRecord = {
	term: string;
	definition: string;
	quizOptions: { label: string; value: string }[];
	correctOption: string;
	xpReward: number;
};

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function hashDate(dateStr: string): number {
	let hash = 0;
	for (let i = 0; i < dateStr.length; i++) {
		hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
	}
	return hash;
}

function pickSeedTerm(dateStr: string): TermRecord {
	const t = TERM_BANK[hashDate(dateStr) % TERM_BANK.length];
	const quizOptions = shuffle([
		{ label: t.definition, value: t.definition },
		...t.distractors.map((d) => ({ label: d, value: d }))
	]);
	return { term: t.term, definition: t.definition, quizOptions, correctOption: t.definition, xpReward: 20 };
}

/** Ensures today's Word of the Day exists. Safe to call repeatedly (idempotent per day). */
export async function ensureTodayTermSeeded(today = new Date().toISOString().split('T')[0]) {
	const existing = await db
		.select()
		.from(dailyTerms)
		.where(eq(dailyTerms.activeDate, sql`${today}::date`))
		.limit(1);

	if (existing.length > 0) return existing[0];

	await ensureVocabPoolReady();
	const pool = await db.select().from(vocabPool);

	let t: TermRecord;
	if (pool.length > 0) {
		const todaysGauntletTerm = await db
			.select({ term: gauntletQuestions.term })
			.from(gauntletQuestions)
			.where(
				and(eq(gauntletQuestions.activeDate, sql`${today}::date`), eq(gauntletQuestions.category, 'vocab'))
			)
			.limit(1)
			.then((rows) => rows[0]?.term ?? null);

		const candidates = todaysGauntletTerm ? pool.filter((p) => p.term !== todaysGauntletTerm) : pool;
		// Last resort if the pool is too small to exclude anything from — accept
		// the rare collision rather than fail to seed a term at all.
		const usable = candidates.length > 0 ? candidates : pool;
		const entry = usable[hashDate(today) % usable.length];
		t = {
			term: entry.term,
			definition: entry.correctAnswer,
			quizOptions: entry.options as { label: string; value: string }[],
			correctOption: entry.correctAnswer,
			xpReward: 20
		};
	} else {
		t = pickSeedTerm(today);
	}

	const [inserted] = await db
		.insert(dailyTerms)
		.values({
			term: t.term,
			definition: t.definition,
			quizOptions: JSON.stringify(t.quizOptions),
			correctOption: t.correctOption,
			xpReward: t.xpReward,
			activeDate: sql`${today}::date`
		})
		.returning();

	return inserted;
}

/**
 * Shared by Word of the Day and Research Hub reads — a single "research
 * streak" tracked across both engagement paths, separate from the win-only
 * `users.streak`. Counts once per calendar day regardless of which of the
 * two the user did first that day.
 */
export async function bumpResearchStreak(userId: string) {
	const today = new Date().toISOString().split('T')[0];
	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!user) return;

	const last = user.lastResearchDate ? String(user.lastResearchDate).slice(0, 10) : null;
	if (last === today) return; // already counted today

	const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
	const continuing = last === yesterday;

	await db
		.update(users)
		.set({
			researchStreak: continuing ? (user.researchStreak ?? 0) + 1 : 1,
			lastResearchDate: sql`${today}::date`
		})
		.where(eq(users.id, userId));
}
