// Client-accessible badge catalog — no secrets, safe to import anywhere.

export interface BadgeDef {
	code: string;
	name: string;
	description: string;
	emoji: string;
}

export const BADGES: BadgeDef[] = [
	{
		code: 'first_blood',
		name: 'First Blood',
		description: 'Win your first contest',
		emoji: '🩸'
	},
	{
		code: 'win_streak_3',
		name: 'On Fire',
		description: 'Win 3 contests in a row',
		emoji: '🔥'
	},
	{
		code: 'win_streak_5',
		name: 'Unstoppable',
		description: 'Win 5 contests in a row',
		emoji: '⚡'
	},
	{
		code: 'veteran_10',
		name: 'Veteran',
		description: 'Win 10 contests total',
		emoji: '🎖️'
	},
	{
		code: 'veteran_25',
		name: 'Champion',
		description: 'Win 25 contests total',
		emoji: '🏆'
	},
	{
		code: 'league_founder',
		name: 'League Founder',
		description: 'Create your first league',
		emoji: '👑'
	}
];

export const BADGE_MAP = new Map(BADGES.map((b) => [b.code, b]));
