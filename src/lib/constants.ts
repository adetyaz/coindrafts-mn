// Client-accessible constants (not in src/lib/server/)

export interface Sector {
	id: string;
	name: string;
}

export const SECTORS: Sector[] = [
	{ id: 'l1', name: 'L1' },
	{ id: 'l2', name: 'L2' },
	{ id: 'defi', name: 'DeFi' },
	{ id: 'meme', name: 'Meme' },
	{ id: 'wildcard', name: 'Wildcard' }
];

// ─── Game duration ───────────────────────────────────────────────────────────
// Duration is chosen before matching and players are matched on it, so this
// list is the matching vocabulary as much as it is a UI menu — every extra
// option splits the pool, which is why it's a fixed set rather than free entry.

/** Hard floor for any game. */
export const MIN_DURATION_MINUTES = 10;

export interface DurationOption {
	minutes: number;
	label: string;
	/** Contest type carried alongside — drives the existing XP multiplier. */
	type: 'daily' | 'weekly';
}

export const DURATION_OPTIONS: DurationOption[] = [
	{ minutes: 10, label: '10 min', type: 'daily' },
	{ minutes: 20, label: '20 min', type: 'daily' },
	{ minutes: 45, label: '45 min', type: 'daily' },
	{ minutes: 180, label: '3 hours', type: 'daily' },
	{ minutes: 1440, label: '24 hours', type: 'daily' },
	{ minutes: 10080, label: '7 days', type: 'weekly' }
];

export const DEFAULT_DURATION_MINUTES = 1440;

export function durationLabel(minutes: number | null | undefined): string {
	const m = minutes ?? DEFAULT_DURATION_MINUTES;
	const known = DURATION_OPTIONS.find((d) => d.minutes === m);
	if (known) return known.label;
	if (m < 60) return `${m} min`;
	if (m < 1440) return `${Math.round(m / 60)} hours`;
	return `${Math.round(m / 1440)} days`;
}

/** Clamps an arbitrary requested duration to something legal. */
export function normalizeDuration(minutes: unknown): number {
	const n = Number(minutes);
	if (!Number.isFinite(n)) return DEFAULT_DURATION_MINUTES;
	const match = DURATION_OPTIONS.find((d) => d.minutes === Math.round(n));
	return match ? match.minutes : Math.max(MIN_DURATION_MINUTES, Math.round(n));
}
