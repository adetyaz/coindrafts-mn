// Wave 1 Scoring Rules:
// - Simple % change scoring
// - 5 slots, equal weight
// - Winner: whoever has highest total score at end_at time

export interface PickScore {
	pctChange: number;
	score: number;
}

/** The duration this scale was originally tuned for: a 24-hour contest. */
const BASELINE_DURATION_MINUTES = 1440;

/**
 * How much to amplify a percentage move so that games of different lengths
 * produce comparable score spreads.
 *
 * Why this is needed: the scale is `50 + pct/2`, so a five-pick lineup always
 * starts from a 250-point baseline. Over 24 hours a token typically moves a few
 * percent, which spreads lineups by ~17 points — a readable margin. Over ten
 * minutes it moves ~0.2%, spreading lineups by **1 point out of 250**. Every
 * short game therefore lands on ~250 for both players and is decided by
 * hundredths, which reads as a tie and makes skill invisible.
 *
 * Price volatility scales with the square root of time, so the correction is
 * the inverse: sqrt(baseline / duration). A 10-minute game amplifies ~12x, a
 * 7-day game dampens to ~0.38x, and a 24-hour game is unchanged — meaning
 * existing contests score exactly as they always did.
 */
export function durationScale(durationMinutes?: number | null): number {
	const d = Number(durationMinutes);
	if (!Number.isFinite(d) || d <= 0) return 1;
	return Math.sqrt(BASELINE_DURATION_MINUTES / d);
}

/**
 * The multiplier a sector boost applies. Advertised as ×1.25 on the draft
 * screen and the Research Hub — this is the single place the number lives, so
 * the promise and the engine can't drift apart again.
 */
export const BOOST_MULTIPLIER = 1.25;

export type ActiveBoost = { sector: string; expiresAt: string };

/**
 * Whether a boost applies to a pick, at the moment it's scored.
 *
 * Checked against the contest's END time, not "now": a boost that was live when
 * the lineup locked but expired mid-contest should still count, and one earned
 * after the game finished shouldn't. Scoring at `now` would make results depend
 * on when someone happened to open the page.
 */
export function boostFactor(
	sector: string,
	boosts: ActiveBoost[] | null | undefined,
	at: Date
): number {
	if (!Array.isArray(boosts) || boosts.length === 0) return 1;
	const hit = boosts.some(
		(b) => b?.sector === sector && b?.expiresAt && new Date(b.expiresAt) > at
	);
	return hit ? BOOST_MULTIPLIER : 1;
}

/**
 * Calculate score for a single pick based on % change.
 *   -50% = 0 points · 0% = 50 points · +100% = 150 points
 * (at the 24-hour baseline; shorter games amplify, longer games dampen —
 * see `durationScale`.)
 *
 * `boost` multiplies the *movement*, not the final score — so a boost amplifies
 * a gain and also amplifies a loss. Multiplying the score instead would make a
 * boosted losing pick score higher than an unboosted one, which is nonsense.
 */
export function calcPickScore(
	entryPrice: number,
	currentPrice: number,
	durationMinutes?: number | null,
	boost = 1
): number {
	const pctChange = ((currentPrice - entryPrice) / entryPrice) * 100;
	const scaled = pctChange * durationScale(durationMinutes) * boost;
	// Clamp between -100% and +200%
	const clamped = Math.max(-100, Math.min(200, scaled));
	// 50 + (clamped / 2) = linear scale
	return Math.max(0, 50 + clamped / 2);
}

/**
 * Determine winner between two lineups
 */
export function determineWinner(scoreA: number, scoreB: number): 'a' | 'b' | 'tie' {
	if (scoreA > scoreB) return 'a';
	if (scoreB > scoreA) return 'b';
	return 'tie';
}

export function calcLineupScore(picks: { score: number | string }[]): number {
	return picks.reduce((sum, p) => sum + Number(p.score), 0);
}

export function detectEtfStreaks(
	history: Array<{ netFlow?: number; net_inflow?: number; date?: string }>
) {
	if (!Array.isArray(history) || history.length < 2) return [];

	const alerts = [];
	let streak = 1;
	let streakType = '';

	for (let i = 1; i < history.length; i++) {
		const prev = history[i - 1] ?? {};
		const curr = history[i] ?? {};

		const prevFlow = Number(prev.net_inflow);
		const currFlow = Number(curr.net_inflow);
		if (!Number.isFinite(prevFlow) || !Number.isFinite(currFlow)) {
			streak = 1;
			streakType = '';
			continue;
		}

		const bothOut = prevFlow < 0 && currFlow < 0;
		const bothIn = prevFlow > 0 && currFlow > 0;

		if (bothOut || bothIn) {
			streak++;
			streakType = currFlow < 0 ? 'outflow' : 'inflow';
		} else {
			streak = 1;
			streakType = '';
		}

		if (streak >= 3 && streakType) {
			alerts.push({
				type: streakType,
				streak,
				amount: Math.abs(currFlow),
				date: curr.date ?? null
			});
		}
	}

	return alerts.slice(-3);
}
