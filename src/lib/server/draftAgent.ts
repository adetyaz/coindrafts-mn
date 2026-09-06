// AI Draft Agent (G-06) pick logic. The LLM never names a token freely — it
// chooses from the real, live candidate list per sector (same classifySector
// bucketing botDraft.ts uses for bots), and the answer is validated against
// that list. An invalid/unparseable response falls back to the best 24h
// performer in-sector, so a bad model response degrades gracefully instead
// of ever returning a token that doesn't actually exist in the live pool.
import { classifySector } from '$lib/sectors';
import { getTokensWithPrices, type TokenWithPrice } from '$lib/server/sosovalue';
import {
	createChatCompletion,
	extractTrace,
	activeBackend,
	type ComputeTrace
} from '$lib/server/aiCompute';

export type AgentPick = { sector: string; symbol: string; name: string; currencyId: string };

/** Picks plus the inference receipt that produced them (see ComputeTrace). */
export type AgentResult = { picks: AgentPick[]; trace: ComputeTrace | null };

function bestPerformer(tokens: TokenWithPrice[]): TokenWithPrice | undefined {
	if (tokens.length === 0) return undefined;
	return tokens.reduce((a, b) => ((a.change24h ?? -Infinity) >= (b.change24h ?? -Infinity) ? a : b));
}

// Weighted toward the model's top choice, but not locked to it. Two opponents
// asking the agent at the same time get the same candidate list and the same
// (fairly deterministic) model — without this, they'd get the exact same
// lineup, which defeats the point of competing. Ranks beyond the 3rd share
// the last weight rather than trailing to ~0.
const RANK_WEIGHTS = [0.55, 0.3, 0.15];
function weightedPick(rankedSymbols: string[]): string | null {
	if (rankedSymbols.length === 0) return null;
	const weights = rankedSymbols.map((_, i) => RANK_WEIGHTS[i] ?? RANK_WEIGHTS[RANK_WEIGHTS.length - 1]);
	const total = weights.reduce((a, b) => a + b, 0);
	let r = Math.random() * total;
	for (let i = 0; i < rankedSymbols.length; i++) {
		r -= weights[i];
		if (r <= 0) return rankedSymbols[i];
	}
	return rankedSymbols[rankedSymbols.length - 1];
}

/** Picks one token per requested sector, reasoning over live data via 0G Compute/Groq. */
export async function pickForSectors(sectors: string[]): Promise<AgentResult> {
	const tokens = await getTokensWithPrices();
	const priced = tokens.filter((t) => t.symbol && t.price != null);
	const bySector = new Map<string, TokenWithPrice[]>();
	for (const t of priced) {
		const s = classifySector([t.symbol as string]);
		if (!bySector.has(s)) bySector.set(s, []);
		bySector.get(s)!.push(t);
	}

	const wanted = sectors.filter((s, i) => sectors.indexOf(s) === i);
	const candidatesBySector = new Map<string, TokenWithPrice[]>();
	for (const sector of wanted) {
		const pool = bySector.get(sector);
		candidatesBySector.set(sector, pool && pool.length > 0 ? pool : priced);
	}

	const { chosen, trace } = await askAgent(candidatesBySector);

	// Resolved sequentially with a shared `used` set — multiple slots often
	// share the same fallback candidate pool (when a sector's own bucket is
	// empty in the live snapshot), and nothing stops the model from picking
	// the same "best" token for more than one of them without this. Found
	// live: 4 of 5 slots came back as the same token before this existed.
	const used = new Set<string>();
	const picks: AgentPick[] = [];
	for (const sector of wanted) {
		const candidates = candidatesBySector.get(sector)!;
		const validSymbols = new Set(candidates.map((t) => (t.symbol ?? '').toUpperCase()));
		// Only the model's real, unused-so-far suggestions are eligible — an
		// invented or already-picked symbol just falls out of the running list.
		const ranked = [
			...new Set((chosen.get(sector) ?? []).map((s) => s.toUpperCase()))
		].filter((s) => validSymbols.has(s) && !used.has(s));
		const pickedSymbol = weightedPick(ranked);
		const match = pickedSymbol
			? candidates.find((t) => (t.symbol ?? '').toUpperCase() === pickedSymbol)
			: null;
		const fallbackPool = candidates.filter((t) => !used.has((t.symbol ?? '').toUpperCase()));
		const token =
			match ??
			bestPerformer(fallbackPool) ??
			bestPerformer(priced.filter((t) => !used.has((t.symbol ?? '').toUpperCase())));
		if (!token) continue; // genuinely out of unique candidates — skip rather than duplicate

		used.add((token.symbol ?? '').toUpperCase());
		picks.push({
			sector,
			symbol: (token.symbol ?? '').toUpperCase(),
			name: token.name ?? (token.symbol ?? '').toUpperCase(),
			currencyId: token.currency_id
		});
	}
	return { picks, trace };
}

async function askAgent(
	candidatesBySector: Map<string, TokenWithPrice[]>
): Promise<{ chosen: Map<string, string[]>; trace: ComputeTrace | null }> {
	const lines: string[] = [];
	for (const [sector, candidates] of candidatesBySector) {
		lines.push(`${sector.toUpperCase()} slot — rank your top picks:`);
		for (const t of candidates.slice(0, 12)) {
			const chg = t.change24h ?? 0;
			lines.push(`  ${(t.symbol ?? '').toUpperCase()}: $${t.price} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% 24h)`);
		}
	}

	// Ranked lists rather than a single pick per slot — the caller samples from
	// the ranking (weighted toward #1) rather than always taking it verbatim, so
	// two players hitting the agent on the same live data at the same time
	// don't get handed each other's exact lineup.
	const systemPrompt = `You are the CoinDraft AI Draft Agent, helping a player fill their lineup. For each sector slot listed, choose your top 3 token symbols from that slot's own candidate list, ranked best to worst — never invent a symbol that isn't listed. Favor tokens with strong or improving 24h momentum, but use your judgment. Respond with ONLY a JSON object mapping each sector id to an array of up to 3 ranked symbols, e.g. {"l1":["ETH","SOL","AVAX"],"meme":["DOGE","SHIB"]}. No other text.`;

	try {
		const res = await createChatCompletion({
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: lines.join('\n') }
			],
			// gpt-oss is a reasoning model — it burns part of this budget on an
			// internal reasoning trace before real content, same footgun already
			// found and fixed in /api/breakdown. 200 risked truncating before any
			// JSON came through; matching the value proven to leave headroom there.
			max_tokens: 400,
			temperature: 0.4
		});
		const backend = activeBackend();
		const trace = extractTrace(res, backend.model, backend.via);
		const raw = res.choices[0]?.message?.content ?? '';
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return { chosen: new Map(), trace };
		const parsed = JSON.parse(jsonMatch[0]);
		const out = new Map<string, string[]>();
		for (const [sector, value] of Object.entries(parsed)) {
			// Accept a bare string too — cheap robustness against the model
			// occasionally reverting to the old single-symbol shape.
			if (typeof value === 'string') out.set(sector, [value]);
			else if (Array.isArray(value)) out.set(sector, value.filter((s): s is string => typeof s === 'string'));
		}
		return { chosen: out, trace };
	} catch (e) {
		console.error('[draftAgent] LLM pick failed, falling back to best-performer per sector:', e);
		// No trace on failure — the picks that follow are procedural, not AI, and
		// must not be recorded as AI-assisted.
		return { chosen: new Map(), trace: null };
	}
}
