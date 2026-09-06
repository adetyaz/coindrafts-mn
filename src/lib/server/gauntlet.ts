import { db } from '$lib/server/db';
import { gauntletQuestions, vocabPool, vocabPoolBatches, dailyTerms } from '$lib/server/schema';
import { eq, sql } from 'drizzle-orm';
import { createChatCompletion } from '$lib/server/aiCompute';
import { ZG_STORAGE } from '$lib/server/zgNetwork';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECTORS = ['l1', 'l2', 'defi', 'meme', 'wildcard'] as const;

// Fallback bank — used only if both the AI and (for market questions) live
// data generation are unavailable when a day needs seeding.
const SEED_QUESTIONS = [
	{
		question: 'Which sector is typically considered the "blue chip" layer of crypto?',
		options: [
			{ label: 'Layer 1 (L1)', value: 'l1' },
			{ label: 'Layer 2 (L2)', value: 'l2' },
			{ label: 'DeFi', value: 'defi' },
			{ label: 'Meme', value: 'meme' }
		],
		correctAnswer: 'l1',
		sector: 'l1',
		xpReward: 50,
		boostSector: 'l1'
	},
	{
		question: 'Which of these is a Layer 2 scaling solution for Ethereum?',
		options: [
			{ label: 'Bitcoin', value: 'bitcoin' },
			{ label: 'Solana', value: 'solana' },
			{ label: 'Base', value: 'base' },
			{ label: 'Cardano', value: 'cardano' }
		],
		correctAnswer: 'base',
		sector: 'l2',
		xpReward: 50,
		boostSector: 'l2'
	},
	{
		question: 'What metric best measures short-term market sentiment for a token?',
		options: [
			{ label: 'Market Cap', value: 'market_cap' },
			{ label: '24h Price Change %', value: '24h_change' },
			{ label: 'Total Supply', value: 'total_supply' },
			{ label: 'Founder Twitter Followers', value: 'twitter_followers' }
		],
		correctAnswer: '24h_change',
		sector: 'wildcard',
		xpReward: 50,
		boostSector: 'wildcard'
	},
	{
		question: 'In CoinDraft scoring, what determines your pick score?',
		options: [
			{ label: "The token's market cap rank", value: 'mcap_rank' },
			{ label: 'Price change from entry to exit', value: 'price_change' },
			{ label: 'How many people picked the same token', value: 'popularity' },
			{ label: 'Random dice roll', value: 'random' }
		],
		correctAnswer: 'price_change',
		sector: 'wildcard',
		xpReward: 75,
		boostSector: 'wildcard'
	}
];

// Vocab fallback bank — moved from the old term-of-day.ts, which this
// replaces. Only reached if the vocab pool is empty AND the AI can't
// generate a batch to fill it (see ensureVocabPool below).
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
		term: 'Market cap',
		definition: 'Circulating supply multiplied by the current price of a token.',
		distractors: [
			'The maximum number of tokens that will ever exist.',
			'The total dollar volume traded across all exchanges in 24 hours.',
			'The highest price a token has ever reached.'
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
	},
	{
		term: 'Liquidity pool',
		definition: 'A pool of tokens locked in a smart contract that other users trade against.',
		distractors: [
			"A wallet that holds a project's unsold token supply.",
			"A list of an exchange's most-traded pairs.",
			'A fund that insures depositors against a protocol hack.'
		]
	},
	{
		term: 'Staking',
		definition: 'Locking up tokens to help secure or operate a network in exchange for rewards.',
		distractors: [
			'Buying a token and immediately selling it for a quick profit.',
			'Borrowing tokens against collateral you already hold.',
			'Voting on a governance proposal with your token balance.'
		]
	},
	{
		term: 'DEX',
		definition: 'Decentralized Exchange — a trading venue with no central custodian, run by smart contracts.',
		distractors: [
			'A type of hardware wallet used to store private keys offline.',
			'An index that tracks the average price of the top 10 tokens.',
			'A protocol that lets you borrow against your crypto holdings.'
		]
	},
	{
		term: 'Volatility',
		definition: "How much and how quickly a token's price moves over a given period.",
		distractors: [
			'The number of holders a token has.',
			"The percentage of a token's supply that is currently staked.",
			"How often a blockchain's validators change."
		]
	}
];

export type QuestionCategory = 'market' | 'vocab';

type QuestionInput = {
	question: string;
	options: { label: string; value: string }[];
	correctAnswer: string;
	sector: string;
	xpReward: number;
	boostSector: string | null;
	category: QuestionCategory;
	term: string | null;
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

// Deterministic per-day category, so a retry within the same day (self-heal,
// or two instances racing to seed) picks the same category rather than
// disagreeing with itself.
function categoryForDate(dateStr: string): QuestionCategory {
	return hashDate(dateStr) % 2 === 0 ? 'market' : 'vocab';
}

function pickMarketSeed(dateStr: string): QuestionInput {
	const q = SEED_QUESTIONS[hashDate(dateStr) % SEED_QUESTIONS.length];
	return { ...q, category: 'market', term: null };
}

function pickVocabSeed(dateStr: string): QuestionInput {
	const t = TERM_BANK[hashDate(dateStr) % TERM_BANK.length];
	const options = shuffle([
		{ label: t.definition, value: t.definition },
		...t.distractors.map((d) => ({ label: d, value: d }))
	]);
	return {
		question: `What is "${t.term}"?`,
		options,
		correctAnswer: t.definition,
		sector: 'wildcard',
		xpReward: 20,
		boostSector: null,
		category: 'vocab',
		term: t.term
	};
}

type QuestionOutput = {
	question: string;
	options: { label: string; value: string }[];
	correctAnswer: string;
	sector: string;
	xpReward: number;
	boostSector: string;
};

function shuffleOptions<T extends { question: string; options: { label: string; value: string }[] }>(
	q: T
): T {
	return { ...q, options: shuffle(q.options) };
}

type SvelteFetch = (input: string) => Promise<Response>;

/**
 * Generates a market question from today's real market data instead of a
 * static bank — no LLM, procedural, so no hallucination or parsing-failure
 * risk. This is the fallback that runs BEFORE the static bank if the AI
 * attempt below doesn't produce a valid question. Returns null if live data
 * isn't available.
 */
async function generateLiveQuestion(fetchFn: SvelteFetch): Promise<QuestionOutput | null> {
	try {
		const [tokensRes, sectorsRes] = await Promise.all([
			fetchFn('/api/tokens'),
			fetchFn('/api/sectors')
		]);
		if (!tokensRes.ok) return null;

		const tokens: Array<{ symbol?: string; change24h: number | null; price: number | null }> =
			await tokensRes.json();
		const validTokens = tokens.filter((t) => t.symbol && t.change24h != null);
		if (validTokens.length < 4) return null;

		const sectors: Array<{ id: string; name: string; change: number | null }> = sectorsRes.ok
			? await sectorsRes.json()
			: [];
		const validSectors = sectors.filter((s) => s.change != null);

		const templates: Array<() => QuestionOutput | null> = [
			() => {
				const sample = shuffle(validTokens).slice(0, 4);
				const best = sample.reduce((a, b) => ((a.change24h ?? -Infinity) >= (b.change24h ?? -Infinity) ? a : b));
				return {
					question: 'Which of these tokens has the best 24h performance right now?',
					options: sample.map((t) => ({
						label: (t.symbol ?? '').toUpperCase(),
						value: (t.symbol ?? '').toUpperCase()
					})),
					correctAnswer: (best.symbol ?? '').toUpperCase(),
					sector: 'wildcard',
					xpReward: 50,
					boostSector: 'wildcard'
				};
			},
			() => {
				const sample = shuffle(validTokens).slice(0, 4);
				const highest = sample.reduce((a, b) => ((a.price ?? -Infinity) >= (b.price ?? -Infinity) ? a : b));
				return {
					question: 'Which of these tokens is trading at the highest price right now?',
					options: sample.map((t) => ({
						label: (t.symbol ?? '').toUpperCase(),
						value: (t.symbol ?? '').toUpperCase()
					})),
					correctAnswer: (highest.symbol ?? '').toUpperCase(),
					sector: 'wildcard',
					xpReward: 50,
					boostSector: 'wildcard'
				};
			},
			() => {
				if (validSectors.length < 4) return null;
				const sample = shuffle(validSectors).slice(0, 4);
				const leader = sample.reduce((a, b) => ((a.change ?? -Infinity) >= (b.change ?? -Infinity) ? a : b));
				return {
					question: 'Which sector is leading today by 24h performance?',
					options: sample.map((s) => ({ label: s.name, value: s.id })),
					correctAnswer: leader.id,
					sector: leader.id,
					xpReward: 50,
					boostSector: leader.id
				};
			}
		];

		for (const t of shuffle(templates)) {
			const q = t();
			if (q) return q;
		}
		return null;
	} catch {
		return null;
	}
}

/** Condensed live numbers handed to the AI as grounding, so it can't invent prices. */
async function buildLiveContext(fetchFn: SvelteFetch): Promise<string | null> {
	try {
		const [tokensRes, sectorsRes] = await Promise.all([
			fetchFn('/api/tokens'),
			fetchFn('/api/sectors')
		]);
		if (!tokensRes.ok) return null;
		const tokens: Array<{ symbol?: string; price: number | null; change24h: number | null }> =
			await tokensRes.json();
		const sectors: Array<{ name: string; change: number | null }> = sectorsRes.ok
			? await sectorsRes.json()
			: [];

		const tokenLines = shuffle(tokens.filter((t) => t.symbol && t.change24h != null))
			.slice(0, 8)
			.map((t) => `${(t.symbol ?? '').toUpperCase()}: $${t.price}, ${t.change24h}% 24h`)
			.join('; ');
		const sectorLines = sectors
			.filter((s) => s.change != null)
			.map((s) => `${s.name}: ${s.change}%`)
			.join('; ');

		if (!tokenLines) return null;
		return `Live token data: ${tokenLines}\nLive sector data: ${sectorLines || 'unavailable'}`;
	} catch {
		return null;
	}
}

function parseJsonLoose(content: string): unknown {
	const match = content.match(/\{[\s\S]*\}/);
	if (!match) return null;
	try {
		return JSON.parse(match[0]);
	} catch {
		return null;
	}
}

/** Rejects anything that isn't a clean 4-option, single-correct-answer question. */
function validateQuestion(raw: unknown, category: QuestionCategory): QuestionInput | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;

	const question = typeof r.question === 'string' ? r.question.trim() : '';
	const rawOptions = Array.isArray(r.options) ? r.options : [];
	if (!question || rawOptions.length !== 4) return null;

	const cleanOptions = rawOptions.map((o) => {
		if (!o || typeof o !== 'object') return null;
		const label = typeof (o as Record<string, unknown>).label === 'string' ? (o as Record<string, unknown>).label as string : '';
		const value = typeof (o as Record<string, unknown>).value === 'string' ? (o as Record<string, unknown>).value as string : '';
		return label.trim() && value.trim() ? { label: label.trim(), value: value.trim() } : null;
	});
	if (cleanOptions.some((o) => !o)) return null;
	const rawCorrectAnswer = typeof r.correctAnswer === 'string' ? r.correctAnswer.trim() : '';

	if (category === 'vocab') {
		// The model is asked to make `value` a copy of `label`, but doesn't
		// reliably do that — it often uses short codes instead (e.g. "DFI" for
		// two different definitions), which collide and made every batch fail
		// the uniqueness check below. `value` is meaningless for a vocab
		// definition anyway (the label IS the answer text), so match the
		// correct answer against the model's raw value first, then normalize
		// every option's value to its own label — that's what's actually
		// displayed and stored.
		const rawOptions2 = cleanOptions as { label: string; value: string }[];
		const matched = rawOptions2.find((o) => o.value === rawCorrectAnswer);
		if (!matched) return null;
		const options = rawOptions2.map((o) => ({ label: o.label, value: o.label }));
		const values = new Set(options.map((o) => o.value));
		if (values.size !== 4) return null; // no duplicate definitions

		const term = typeof r.term === 'string' ? r.term.trim() : '';
		if (!term) return null;

		// A real definition EXPLAINS the term — it isn't the term itself, an
		// abbreviation of it, or another short term-like label. Found live: the
		// model sometimes generates a "guess which term this is" question
		// instead, where every option (including the "correct" one) is just
		// another term name — "Smart Contract" ended up as its own definition.
		// Every option must be a real phrase (>=4 words), and the correct one
		// must not just restate the term.
		const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
		const termNorm = normalize(term);
		const defNorm = normalize(matched.label);
		if (!termNorm || !defNorm || defNorm.includes(termNorm) || termNorm.includes(defNorm)) return null;
		if (options.some((o) => o.label.trim().split(/\s+/).length < 4)) return null;

		return {
			question,
			options,
			correctAnswer: matched.label,
			sector: 'wildcard',
			xpReward: 20,
			boostSector: null,
			category,
			term
		};
	}

	const options = cleanOptions as { label: string; value: string }[];
	const values = new Set(options.map((o) => o.value));
	if (values.size !== 4) return null; // no duplicate options
	if (!values.has(rawCorrectAnswer)) return null;
	const correctAnswer = rawCorrectAnswer;

	const sectorRaw = typeof r.sector === 'string' ? r.sector : '';
	const sector = (SECTORS as readonly string[]).includes(sectorRaw) ? sectorRaw : 'wildcard';
	return { question, options, correctAnswer, sector, xpReward: 50, boostSector: sector, category, term: null };
}

function buildMarketPrompt(liveContext: string): string {
	return [
		'Generate ONE multiple-choice crypto market-knowledge question for a trading game, grounded in this live data:',
		liveContext,
		'Return ONLY a JSON object, no markdown, no prose, in exactly this shape:',
		`{"question": "<question text, under 20 words>", "options": [{"label": "<text>", "value": "<text>"}, ...4 total], "correctAnswer": "<must exactly equal the correct option's value>", "sector": "<one of l1|l2|defi|meme|wildcard>"}`,
		'Base the question and correct answer directly on the live data given (e.g. "which of these has the best 24h performance").'
	].join('\n');
}

/**
 * Market questions can't be batched like vocab — they're only meaningful
 * against TODAY's prices, so this runs fresh each day one is needed.
 */
async function generateAIMarketQuestion(fetchFn?: SvelteFetch): Promise<QuestionInput | null> {
	try {
		const liveContext = fetchFn ? await buildLiveContext(fetchFn) : null;
		if (!liveContext) return null; // no grounding — let the procedural fallback handle it

		const res = await createChatCompletion({
			messages: [
				{
					role: 'system',
					content:
						'You write short crypto quiz questions for a trading game. Respond with ONLY a single JSON object — no markdown fences, no commentary.'
				},
				{ role: 'user', content: buildMarketPrompt(liveContext) }
			],
			temperature: 0.9,
			max_tokens: 400,
			stream: false
		});

		const content = res.choices?.[0]?.message?.content ?? '';
		const parsed = parseJsonLoose(content);
		return validateQuestion(parsed, 'market');
	} catch (e) {
		console.error('[gauntlet] AI market question generation failed:', e);
		return null;
	}
}

// ─── Vocab pool — the batch-generated knowledge base ───────────────────────
// Unlike market questions, vocab is timeless, so it's generated in bulk and
// reused across many days instead of costing an AI call every single day.

const VOCAB_POOL_TARGET = 100; // aim to have this many entries banked
const VOCAB_POOL_MIN = 40; // top up once the pool drops below this
const VOCAB_BATCH_CHUNK = 10; // items requested per AI call — small enough for the model to return reliably
const VOCAB_BATCH_MAX_CALLS = 10; // safety cap on AI calls in one top-up pass — covers reaching TARGET from empty in one pass

type VocabItem = { term: string; question: string; options: { label: string; value: string }[]; correctAnswer: string };

function buildVocabBatchPrompt(count: number, avoidTerms: string[]): string {
	return [
		`Generate ${count} DIFFERENT crypto/DeFi vocabulary quiz questions for a trading game.`,
		'Cover a wide range of real, commonly-used terms — spanning basics, DeFi mechanics, trading jargon, and on-chain concepts.',
		avoidTerms.length > 0
			? `These terms are ALREADY in the pool — you must not repeat any of them, and must not just vary their capitalization: ${avoidTerms.join(', ')}.`
			: '',
		'Return ONLY a JSON array, no markdown, no prose. Each item in exactly this shape:',
		'{"term": "<the term itself>", "question": "<e.g. \\"What is slippage?\\">", "options": [{"label": "<definition text>", "value": "<same as label>"}, ...4 total, one correct + three plausible-but-wrong], "correctAnswer": "<must exactly equal the correct option\'s value>"}',
		`The array must contain exactly ${count} DISTINCT terms, no duplicates within your own answer either. Keep each option to one concise sentence.`
	]
		.filter(Boolean)
		.join('\n');
}

function parseJsonArrayLoose(content: string): unknown[] {
	const match = content.match(/\[[\s\S]*\]/);
	if (!match) return [];
	try {
		const parsed = JSON.parse(match[0]);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function generateVocabChunk(count: number, avoidTerms: string[]): Promise<VocabItem[]> {
	try {
		const res = await createChatCompletion({
			messages: [
				{
					role: 'system',
					content:
						'You write short crypto quiz questions for a trading game. Respond with ONLY a single JSON array — no markdown fences, no commentary.'
				},
				{ role: 'user', content: buildVocabBatchPrompt(count, avoidTerms) }
			],
			temperature: 0.9,
			max_tokens: 1600,
			stream: false
		});

		const content = res.choices?.[0]?.message?.content ?? '';
		const items: VocabItem[] = [];
		for (const raw of parseJsonArrayLoose(content)) {
			const v = validateQuestion(raw, 'vocab');
			if (v && v.term) items.push({ term: v.term, question: v.question, options: v.options, correctAnswer: v.correctAnswer });
		}
		return items;
	} catch (e) {
		console.error('[gauntlet] vocab batch generation failed:', e);
		return [];
	}
}

/**
 * Tops up the vocab pool via a batch AI generation pass when it's running
 * low — nothing runs if there's already enough banked. Falls back to the
 * static TERM_BANK only if the pool is completely empty and the AI produced
 * nothing at all, so a Gauntlet day is never left with no vocab option.
 */
export async function ensureVocabPool(): Promise<void> {
	const existing = await db.select({ term: vocabPool.term }).from(vocabPool);
	if (existing.length >= VOCAB_POOL_MIN) return;

	const seenTerms = new Set(existing.map((e) => e.term.toLowerCase()));
	const collected: VocabItem[] = [];

	for (let call = 0; call < VOCAB_BATCH_MAX_CALLS && existing.length + collected.length < VOCAB_POOL_TARGET; call++) {
		const chunk = await generateVocabChunk(VOCAB_BATCH_CHUNK, [...seenTerms]);
		for (const item of chunk) {
			const key = item.term.toLowerCase();
			if (seenTerms.has(key)) continue;
			seenTerms.add(key);
			collected.push(item);
		}
	}

	if (collected.length === 0 && existing.length === 0) {
		// AI produced nothing and the pool has never had anything — seed from
		// the static bank so the pool isn't empty on day one.
		for (const t of TERM_BANK) {
			const options = shuffle([
				{ label: t.definition, value: t.definition },
				...t.distractors.map((d) => ({ label: d, value: d }))
			]);
			collected.push({ term: t.term, question: `What is "${t.term}"?`, options, correctAnswer: t.definition });
		}
	}

	if (collected.length === 0) return; // already had enough, or generation totally failed with an existing pool to fall back on

	const [batch] = await db.insert(vocabPoolBatches).values({}).returning();
	await db
		.insert(vocabPool)
		.values(
			collected.map((c) => ({
				batchId: batch.id,
				term: c.term,
				question: c.question,
				options: JSON.stringify(c.options),
				correctAnswer: c.correctAnswer
			}))
		)
		// Skips rather than errors on a case-insensitive term collision — the
		// only real defence against two concurrent top-ups both generating the
		// same term, since there's no in-process lock here.
		.onConflictDoNothing();

	pushVocabBatchToStorage(batch.id, collected).catch((e) =>
		console.error('[gauntlet] vocab pool storage write skipped:', e)
	);
}

/**
 * Callers that just need TODAY's question (Gauntlet, Word of the Day) must
 * never block on a full top-up pass — that's up to 8 sequential AI calls and
 * can take minutes, which turned a page load into a hang/timeout until the
 * pool reached VOCAB_POOL_MIN. If there's already at least one usable entry,
 * answer from it immediately and top up in the background instead. Only
 * blocks when the pool has never had anything at all — there's nothing to
 * serve today's question from otherwise.
 */
export async function ensureVocabPoolReady(): Promise<void> {
	const existing = await db.select({ term: vocabPool.term }).from(vocabPool).limit(1);
	if (existing.length > 0) {
		ensureVocabPool().catch((e) => console.error('[gauntlet] background vocab pool top-up failed:', e));
		return;
	}
	await ensureVocabPool();
}

/**
 * Deterministic per-day pick from the pool — same day always picks the same
 * entry. Word of the Day (term-of-day.ts) draws from this same shared pool,
 * so if today's Word of the Day has already been seeded, its term is
 * excluded here — the two must never show the same term on the same day.
 * The matching exclusion runs the other way in term-of-day.ts, so whichever
 * of the two seeds second is the one that actually avoids a collision.
 */
async function pickFromVocabPool(dateStr: string): Promise<QuestionInput | null> {
	const pool = await db.select().from(vocabPool);
	if (pool.length === 0) return null;

	const todaysTerm = await db
		.select({ term: dailyTerms.term })
		.from(dailyTerms)
		.where(eq(dailyTerms.activeDate, sql`${dateStr}::date`))
		.limit(1)
		.then((rows) => rows[0]?.term ?? null);

	const candidates = todaysTerm ? pool.filter((p) => p.term !== todaysTerm) : pool;
	// Last resort if the pool is too small to exclude anything from — accept
	// the rare collision rather than fail to seed a question at all.
	const usable = candidates.length > 0 ? candidates : pool;
	const entry = usable[hashDate(dateStr) % usable.length];
	return {
		question: entry.question,
		options: entry.options as { label: string; value: string }[],
		correctAnswer: entry.correctAnswer,
		sector: 'wildcard',
		xpReward: 20,
		boostSector: null,
		category: 'vocab',
		term: entry.term
	};
}

/**
 * Permanent record of a vocab batch on 0G Storage. `ZG_STORAGE_PRIVATE_KEY`
 * is configured, but `@0gfoundation/0g-storage-ts-sdk` still isn't installed
 * (npm install blocked in this environment) — so this genuinely attempts the
 * real upload and only degrades to a no-op if that import fails, rather than
 * being a no-op by design. Installing the package is the only remaining step
 * to make this write for real. Never blocks seeding: the caller swallows
 * failures here.
 *
 * Deliberately per-batch, not per-day: batching vocab into one document per
 * top-up (instead of one write per day) is the whole point of pre-generating
 * it in bulk — far fewer 0G Storage transactions, and the batch itself reads
 * as an actual knowledge-base artifact rather than a trickle of one-offs.
 */
async function pushVocabBatchToStorage(batchId: string, items: VocabItem[]): Promise<void> {
	const privateKey = ZG_STORAGE.privateKey;
	if (!privateKey) return; // not configured — the key exists but the SDK isn't installed yet

	// Lazy import: @0gfoundation/0g-storage-ts-sdk isn't installed yet (see
	// src/0g-storage.d.ts for the ambient types that let this type-check
	// anyway). This degrades to a no-op (logged once) instead of crashing the
	// whole Gauntlet feature on module load, and starts working the moment
	// it IS installed — no further code change needed.
	let ZgFile: (typeof import('@0gfoundation/0g-storage-ts-sdk'))['ZgFile'];
	let Indexer: (typeof import('@0gfoundation/0g-storage-ts-sdk'))['Indexer'];
	let JsonRpcProvider: (typeof import('ethers'))['JsonRpcProvider'];
	let Wallet: (typeof import('ethers'))['Wallet'];
	try {
		const [sdk, ethersMod] = await Promise.all([
			import('@0gfoundation/0g-storage-ts-sdk'),
			import('ethers')
		]);
		({ ZgFile, Indexer } = sdk);
		({ JsonRpcProvider, Wallet } = ethersMod);
	} catch {
		console.error('[gauntlet] 0G Storage SDK not installed yet — skipping storage write for this batch');
		return;
	}
	const rpcUrl = ZG_STORAGE.rpcUrl;
	const indexerUrl = ZG_STORAGE.indexerUrl;
	if (!indexerUrl) {
		// Mainnet's indexer URL has no hardcoded fallback (unlike testnet's) —
		// deliberately, since a mainnet 0G Storage indexer address isn't
		// something safe to guess. Same degrade-gracefully rule as `privateKey`
		// above: skip this write, never block seeding.
		console.error('[gauntlet] ZG_STORAGE_INDEXER_URL_MAINNET not set — skipping storage write for this batch');
		return;
	}

	const tmpPath = join(tmpdir(), `coindraft-vocab-batch-${batchId}.json`);
	await writeFile(
		tmpPath,
		JSON.stringify({ batchId, generatedAt: new Date().toISOString(), items }),
		'utf-8'
	);

	try {
		const provider = new JsonRpcProvider(rpcUrl);
		const signer = new Wallet(privateKey, provider);
		const indexer = new Indexer(indexerUrl);

		const file = await ZgFile.fromFilePath(tmpPath);
		const [tree, treeErr] = await file.merkleTree();
		if (treeErr || !tree) throw treeErr ?? new Error('merkleTree() returned no tree');
		const rootHash = tree.rootHash();

		const [tx, uploadErr] = await indexer.upload(file, rpcUrl, signer);
		await file.close();
		if (uploadErr) throw uploadErr;

		await db
			.update(vocabPoolBatches)
			.set({
				storageRootHash: rootHash,
				// Exact field name unconfirmed until this runs for real against the
				// live network — adjust here if the SDK's tx shape differs.
				storageTxSeq: tx && typeof tx === 'object' && 'txSeq' in tx ? String((tx as { txSeq: unknown }).txSeq) : null
			})
			.where(eq(vocabPoolBatches.id, batchId));
	} finally {
		await unlink(tmpPath).catch(() => {});
	}
}

/** Ensures today's Gauntlet question exists. Safe to call repeatedly (idempotent per day). */
export async function ensureTodaySeeded(
	today = new Date().toISOString().split('T')[0],
	fetchFn?: SvelteFetch
) {
	const existing = await db
		.select()
		.from(gauntletQuestions)
		.where(eq(gauntletQuestions.activeDate, sql`${today}::date`))
		.limit(1);

	if (existing.length > 0) return existing[0];

	const category = categoryForDate(today);
	let q: QuestionInput | null = null;

	if (category === 'vocab') {
		await ensureVocabPoolReady();
		q = await pickFromVocabPool(today);
		if (!q) q = pickVocabSeed(today);
	} else {
		for (let attempt = 0; attempt < 2 && !q; attempt++) {
			q = await generateAIMarketQuestion(fetchFn);
		}
		if (!q && fetchFn) {
			const live = await generateLiveQuestion(fetchFn);
			q = live ? { ...shuffleOptions(live), category: 'market', term: null } : null;
		}
		if (!q) q = pickMarketSeed(today);
	}

	const [inserted] = await db
		.insert(gauntletQuestions)
		.values({
			question: q.question,
			options: JSON.stringify(q.options),
			correctAnswer: q.correctAnswer,
			sector: q.sector,
			xpReward: q.xpReward,
			boostSector: q.boostSector,
			category: q.category,
			term: q.term,
			activeDate: sql`${today}::date`
		})
		.returning();

	return inserted;
}
