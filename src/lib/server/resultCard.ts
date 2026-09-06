export type ResultCardData = {
	username: string;
	didWin: boolean;
	yourScore: number;
	opponentScore: number;
	contestType: string;
	picks: Array<{ sector: string; pick: string; pct: number }>;
};

// Mirrors src/lib/sectorTheme.ts — this file can't import CSS custom
// properties (it renders a standalone SVG document), so the hex values are
// duplicated here. Keep both in sync if the palette changes.
const SECTOR_COLOR: Record<string, string> = {
	l1: '#68C2A8',
	l2: '#5FA8D8',
	defi: '#F7C978',
	meme: '#F78E79',
	wildcard: '#81BBE3'
};

const INK = '#1A2421';
const PAGE = '#F5FAFA';
const CORAL = '#F78E79';
const MUTED = '#5C6B66';
const BORDER = '#E1E8E6';
const MINT = '#68C2A8';

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders a 1200x630 OG-sized result card as an SVG string. */
export function renderResultCardSvg(data: ResultCardData): string {
	const win = data.didWin;
	const bg = win ? INK : PAGE;
	const fg = win ? PAGE : INK;
	const sub = win ? 'rgba(245,250,250,0.6)' : MUTED;
	const status = win ? 'WON' : 'LOST';

	const n = Math.min(5, data.picks.length) || 1;
	const chipW = Math.floor((1112 - (n - 1) * 16) / n);
	const chipY = 460;

	const pickChips = data.picks
		.slice(0, 5)
		.map((p, i) => {
			const x = 44 + i * (chipW + 16);
			const color = SECTOR_COLOR[p.sector.toLowerCase()] ?? MUTED;
			const pctStr = p.pct >= 0 ? `+${p.pct.toFixed(1)}%` : `${p.pct.toFixed(1)}%`;
			const pctColor = p.pct >= 0 ? MINT : CORAL;
			return `
				<rect x="${x}" y="${chipY}" width="${chipW}" height="120" rx="14" fill="${win ? 'rgba(245,250,250,0.06)' : '#FFFFFF'}" stroke="${color}" stroke-width="1.5" />
				<text x="${x + 18}" y="${chipY + 32}" font-family="monospace" font-size="12" font-weight="700" letter-spacing="1.5" fill="${sub}">${esc(p.sector.toUpperCase())}</text>
				<text x="${x + 18}" y="${chipY + 70}" font-family="sans-serif" font-size="26" font-weight="900" fill="${fg}">${esc(p.pick)}</text>
				<text x="${x + 18}" y="${chipY + 98}" font-family="monospace" font-size="16" font-weight="700" fill="${pctColor}">${esc(pctStr)}</text>
			`;
		})
		.join('');

	const pillW = status === 'WON' ? 130 : 150;

	return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
		<rect width="1200" height="630" fill="${bg}" />

		<g transform="translate(44,44)">
			<rect x="0" y="0" width="26" height="26" rx="7" fill="${CORAL}" transform="rotate(45 13 13)" />
			<text x="38" y="20" font-family="sans-serif" font-size="22" font-weight="900" letter-spacing="-0.5" fill="${fg}">CoinDraft</text>
		</g>
		<text x="1156" y="60" text-anchor="end" font-family="monospace" font-size="14" font-weight="700" letter-spacing="1.5" fill="${sub}">${esc(data.contestType.toUpperCase())} CONTEST &middot; SEASON 01</text>

		<rect x="44" y="222" width="${pillW}" height="40" rx="20" fill="${win ? CORAL : '#FFFFFF'}" stroke="${win ? 'none' : BORDER}" />
		<text x="${44 + pillW / 2}" y="248" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="900" letter-spacing="1.5" fill="${win ? INK : MUTED}">${esc(status)}</text>

		<text x="44" y="360" font-family="monospace" font-size="74" font-weight="700" letter-spacing="-2" fill="${fg}">${data.yourScore}<tspan fill="${sub}" font-size="44"> / </tspan><tspan fill="${sub}" font-size="44">${data.opponentScore}</tspan></text>
		<text x="44" y="400" font-family="sans-serif" font-size="19" fill="${sub}">${esc(data.username)}'s ${esc(data.contestType)} contest</text>

		${pickChips}
	</svg>`;
}
