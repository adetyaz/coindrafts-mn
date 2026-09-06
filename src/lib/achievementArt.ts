// Per-achievement-type art config — client-safe (no secrets). Shared by the
// NFT metadata endpoint (src/routes/api/achievements/metadata/[typeId]) and
// the profile page's badge display.
//
// typeId keys must match ACHIEVEMENT_TYPES in src/lib/server/achievements.ts.
// slug/accent/tier must match the BADGES table in
// scripts/generate-achievement-badges.mjs, which draws the actual images —
// that script is standalone (runs outside Vite) so it keeps its own copy.
//
// `tier` is the difficulty band the badge's metal encodes: 1 bronze (a first
// step), 2 silver (sustained), 3 gold (elite). It's surfaced as an NFT trait.
export type AchievementArt = { slug: string; accent: string; tier: 1 | 2 | 3 };

export const TIER_LABEL: Record<number, string> = { 1: 'Bronze', 2: 'Silver', 3: 'Gold' };

export const ACHIEVEMENT_ART: Record<number, AchievementArt> = {
	0: { slug: 'first-blood', accent: '#F78E79', tier: 1 }, // FIRST_WIN_OPPONENT
	1: { slug: 'scrimmage-starter', accent: '#81BBE3', tier: 1 }, // FIRST_WIN_BOT
	2: { slug: 'sharp-shooter', accent: '#F7C978', tier: 1 }, // QUIZ_CORRECT
	3: { slug: 'know-it-all', accent: '#5FA8D8', tier: 2 }, // QUIZ_STREAK_5
	4: { slug: 'on-fire', accent: '#F78E79', tier: 2 }, // WIN_STREAK_3
	5: { slug: 'unstoppable', accent: '#FFB27A', tier: 3 }, // WIN_STREAK_5
	6: { slug: 'veteran', accent: '#68C2A8', tier: 2 }, // VETERAN_10
	7: { slug: 'champion', accent: '#8FE0C6', tier: 3 }, // VETERAN_25
	8: { slug: 'league-founder', accent: '#F7C978', tier: 3 } // LEAGUE_FOUNDER
};

/** Path to a badge image, relative to the site root. */
export function badgeImagePath(typeId: number): string | null {
	const art = ACHIEVEMENT_ART[typeId];
	return art ? `/badges/${art.slug}.svg` : null;
}
