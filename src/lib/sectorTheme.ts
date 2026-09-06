// Sector → visual token map. Values are CSS custom properties (see
// src/routes/layout.css) — never hardcode a sector hex outside that file.
import { SECTORS } from './constants';

export type SectorTheme = { id: string; label: string; color: string; ink: string };

export const SECTOR_THEME: Record<string, SectorTheme> = {
	l1: { id: 'l1', label: 'L1', color: 'var(--color-sector-l1)', ink: 'var(--color-sector-l1-ink)' },
	l2: { id: 'l2', label: 'L2', color: 'var(--color-sector-l2)', ink: 'var(--color-sector-l2-ink)' },
	defi: {
		id: 'defi',
		label: 'DeFi',
		color: 'var(--color-sector-defi)',
		ink: 'var(--color-sector-defi-ink)'
	},
	meme: {
		id: 'meme',
		label: 'Meme',
		color: 'var(--color-sector-meme)',
		ink: 'var(--color-sector-meme-ink)'
	},
	wildcard: {
		id: 'wildcard',
		label: 'Wildcard',
		color: 'var(--color-sector-wildcard)',
		ink: 'var(--color-sector-wildcard-ink)'
	}
};

export const SECTOR_LIST: SectorTheme[] = SECTORS.map((s) => SECTOR_THEME[s.id]);

export function sectorTheme(id: string): SectorTheme {
	return SECTOR_THEME[id] ?? { id, label: id, color: 'var(--color-text-muted)', ink: 'var(--color-text-muted)' };
}
