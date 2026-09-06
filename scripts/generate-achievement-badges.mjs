// One-off asset generator — produces the 9 achievement badge images as static
// SVGs in static/badges/. Re-run any time the art changes:
//   node scripts/generate-achievement-badges.mjs
//
// Design system
// ─────────────
// Every badge is a struck medallion on an ink ground: reeded coin edge, a
// beveled metal ring, an emblem field, a name plate and tier pips. Two things
// vary, and each carries real information:
//
//   • METAL (ring, plate border, pips) encodes TIER — how hard the achievement
//     actually is. Bronze = a first step, silver = sustained, gold = elite.
//   • ACCENT (the emblem itself) encodes WHICH achievement, drawn from
//     CoinDraft's own palette so the set sits inside the app's visual world.
//
// Emblems are hand-built from geometric primitives — no emoji, no icon font,
// nothing that depends on the viewer having anything installed. Type is the
// only font dependency and is set bold enough that a system fallback holds up.
//
// Slug/accent per typeId must stay in sync with src/lib/achievementArt.ts;
// name/description with ACHIEVEMENT_META in src/lib/server/achievements.ts.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'static', 'badges');

const INK = '#121A18'; // a touch deeper than the app's --color-ink, so the metal reads
const PAGE = '#F5FAFA';
const MUTED = '#7C8C87';

// Tier metals. Bronze/gold sit in the app's amber family, silver in its
// border/muted greys — so these read as CoinDraft, not as generic game loot.
const METALS = {
	1: { light: '#E8B98C', mid: '#C08457', dark: '#7A4B18', label: 'BRONZE' },
	2: { light: '#EDF3F2', mid: '#C2D0CB', dark: '#7E8E89', label: 'SILVER' },
	3: { light: '#FBE49B', mid: '#E9C25A', dark: '#A87C16', label: 'GOLD' }
};

// ── Emblems ────────────────────────────────────────────────────────────────
// Each is drawn in absolute coordinates inside a 512×512 canvas, centred on
// (256, 216) and staying within roughly ±76px of it.

const emblems = {
	droplet: () => `
		<path d="M256 144 C 288 196, 314 224, 314 252 A 58 58 0 0 1 198 252 C 198 224, 224 196, 256 144 Z"
			fill="url(#accent)" />
		<path d="M256 196 C 272 222, 284 238, 284 252 A 28 28 0 0 1 228 252 C 228 238, 240 222, 256 196 Z"
			fill="${PAGE}" fill-opacity="0.22" />`,

	robot: () => `
		<circle cx="256" cy="142" r="9" fill="url(#accent)" />
		<rect x="252" y="150" width="8" height="20" fill="url(#accent)" />
		<rect x="184" y="196" width="12" height="38" rx="6" fill="url(#accent)" fill-opacity="0.75" />
		<rect x="316" y="196" width="12" height="38" rx="6" fill="url(#accent)" fill-opacity="0.75" />
		<rect x="196" y="170" width="120" height="106" rx="24" fill="url(#accent)" />
		<circle cx="228" cy="208" r="13" fill="${INK}" />
		<circle cx="284" cy="208" r="13" fill="${INK}" />
		<circle cx="231" cy="204" r="4.5" fill="${PAGE}" fill-opacity="0.9" />
		<circle cx="287" cy="204" r="4.5" fill="${PAGE}" fill-opacity="0.9" />
		<rect x="224" y="240" width="64" height="10" rx="5" fill="${INK}" fill-opacity="0.8" />`,

	target: () => `
		<circle cx="256" cy="216" r="74" fill="none" stroke="url(#accent)" stroke-width="11" />
		<circle cx="256" cy="216" r="52" fill="none" stroke="url(#accent)" stroke-width="9" stroke-opacity="0.8" />
		<circle cx="256" cy="216" r="30" fill="none" stroke="url(#accent)" stroke-width="8" stroke-opacity="0.62" />
		<circle cx="256" cy="216" r="13" fill="url(#accent)" />
		<path d="M330 140 L 274 198" stroke="${INK}" stroke-width="18" stroke-linecap="round" />
		<path d="M330 140 L 274 198" stroke="url(#accent)" stroke-width="10" stroke-linecap="round" />
		<path d="M258 214 L 274 186 L 288 200 Z" fill="url(#accent)" stroke="${INK}" stroke-width="3" stroke-linejoin="round" />
		<path d="M322 132 L 352 124 L 344 154 Z" fill="url(#accent)" stroke="${INK}" stroke-width="3" stroke-linejoin="round" />`,

	bulb: () => `
		<g stroke="url(#accent)" stroke-width="9" stroke-linecap="round" stroke-opacity="0.55">
			<path d="M256 108 V 132" />
			<path d="M344 146 L 327 163" />
			<path d="M168 146 L 185 163" />
			<path d="M360 204 H 336" />
			<path d="M152 204 H 176" />
		</g>
		<circle cx="256" cy="198" r="60" fill="url(#accent)" />
		<path d="M241 238 h30 v16 h-30 z" fill="url(#accent)" fill-opacity="0.85" />
		<rect x="234" y="256" width="44" height="11" rx="5.5" fill="url(#accent)" fill-opacity="0.9" />
		<rect x="234" y="272" width="44" height="11" rx="5.5" fill="url(#accent)" fill-opacity="0.7" />
		<path d="M256 290 a 9 9 0 0 0 9 -8 h-18 a 9 9 0 0 0 9 8 z" fill="url(#accent)" fill-opacity="0.55" />
		<g fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">
			<path d="M238 226 V 208" />
			<path d="M274 226 V 208" />
			<path d="M238 208 L 247 186 L 256 206 L 265 186 L 274 208" />
		</g>`,

	// Real flame, not a teardrop: asymmetric, with a lick rising on the left.
	flame: () => `
		<path d="M256 126
			C 290 176, 320 208, 320 250
			A 64 64 0 0 1 192 250
			C 192 222, 204 206, 216 192
			C 221 212, 231 226, 242 234
			C 232 200, 238 158, 256 126 Z"
			fill="url(#accent)" />
		<path d="M256 202
			C 274 228, 288 242, 288 260
			A 32 32 0 0 1 224 260
			C 224 244, 240 228, 256 202 Z"
			fill="${PAGE}" fill-opacity="0.30" />`,

	bolt: () => `
		<path d="M286 132 L 200 238 L 246 238 L 228 300 L 314 194 L 268 194 Z"
			fill="url(#accent)" fill-opacity="0.28" transform="translate(14,6)" />
		<path d="M286 132 L 200 238 L 246 238 L 228 300 L 314 194 L 268 194 Z" fill="url(#accent)" />`,

	chevrons: () => `
		<g fill="none" stroke="url(#accent)" stroke-width="19" stroke-linecap="round" stroke-linejoin="round">
			<path d="M198 208 L 256 158 L 314 208" stroke-opacity="0.5" />
			<path d="M198 246 L 256 196 L 314 246" stroke-opacity="0.75" />
			<path d="M198 284 L 256 234 L 314 284" />
		</g>`,

	trophy: () => `
		<path d="M206 146 a 30 30 0 0 0 0 60" fill="none" stroke="url(#accent)" stroke-width="12" stroke-linecap="round" />
		<path d="M306 146 a 30 30 0 0 1 0 60" fill="none" stroke="url(#accent)" stroke-width="12" stroke-linecap="round" />
		<path d="M204 142 h104 l-9 78 a 43 43 0 0 1 -86 0 z" fill="url(#accent)" />
		<rect x="244" y="258" width="24" height="28" fill="url(#accent)" fill-opacity="0.85" />
		<rect x="214" y="286" width="84" height="15" rx="5" fill="url(#accent)" />
		<rect x="200" y="303" width="112" height="14" rx="5" fill="url(#accent)" fill-opacity="0.8" />
		<path d="M256 166 l9 19 21 3 -15 15 4 21 -19 -10 -19 10 4 -21 -15 -15 21 -3 z" fill="${INK}" fill-opacity="0.5" />`,

	crown: () => `
		<path d="M188 266 L 200 172 L 232 214 L 256 156 L 280 214 L 312 172 L 324 266 Z" fill="url(#accent)" />
		<rect x="184" y="266" width="144" height="24" rx="8" fill="url(#accent)" fill-opacity="0.85" />
		<circle cx="200" cy="178" r="9" fill="${PAGE}" fill-opacity="0.92" />
		<circle cx="256" cy="161" r="10.5" fill="${PAGE}" fill-opacity="0.98" />
		<circle cx="312" cy="178" r="9" fill="${PAGE}" fill-opacity="0.92" />
		<circle cx="256" cy="278" r="7" fill="${INK}" fill-opacity="0.45" />`
};

// ── The set ────────────────────────────────────────────────────────────────
// tier: 1 = a first step, 2 = sustained, 3 = elite. League Founder is a role
// rather than a difficulty, but it's a permanent founder marker — gold.
const BADGES = [
	{ typeId: 0, slug: 'first-blood', name: 'First Blood', emblem: 'droplet', accent: '#F78E79', tier: 1 },
	{ typeId: 1, slug: 'scrimmage-starter', name: 'Scrimmage Starter', emblem: 'robot', accent: '#81BBE3', tier: 1 },
	{ typeId: 2, slug: 'sharp-shooter', name: 'Sharp Shooter', emblem: 'target', accent: '#F7C978', tier: 1 },
	{ typeId: 3, slug: 'know-it-all', name: 'Know-It-All', emblem: 'bulb', accent: '#5FA8D8', tier: 2 },
	{ typeId: 4, slug: 'on-fire', name: 'On Fire', emblem: 'flame', accent: '#F78E79', tier: 2 },
	{ typeId: 5, slug: 'unstoppable', name: 'Unstoppable', emblem: 'bolt', accent: '#FFB27A', tier: 3 },
	{ typeId: 6, slug: 'veteran', name: 'Veteran', emblem: 'chevrons', accent: '#68C2A8', tier: 2 },
	{ typeId: 7, slug: 'champion', name: 'Champion', emblem: 'trophy', accent: '#8FE0C6', tier: 3 },
	{ typeId: 8, slug: 'league-founder', name: 'League Founder', emblem: 'crown', accent: '#F7C978', tier: 3 }
];

function esc(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Reeded coin edge — 72 ticks around the rim, the detail that sells "struck". */
function reededEdge(cx, cy, rInner, rOuter, count = 72) {
	let out = '';
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2;
		const x1 = cx + Math.cos(a) * rInner;
		const y1 = cy + Math.sin(a) * rInner;
		const x2 = cx + Math.cos(a) * rOuter;
		const y2 = cy + Math.sin(a) * rOuter;
		out += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" />`;
	}
	return out;
}

/** Tier pips — 1-3 small diamonds under the name plate. */
function tierPips(tier) {
	const gap = 22;
	const startX = 256 - ((tier - 1) * gap) / 2;
	let out = '';
	for (let i = 0; i < tier; i++) {
		const x = startX + i * gap;
		out += `<rect x="${x - 5}" y="466" width="10" height="10" rx="2" fill="url(#metal)" transform="rotate(45 ${x} 471)" />`;
	}
	return out;
}

function renderBadge({ name, emblem, accent, tier }) {
	const metal = METALS[tier];
	const cx = 256;
	const cy = 216;

	return `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(name)} — CoinDraft achievement badge" font-family="Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif">
	<defs>
		<linearGradient id="metal" x1="0" y1="0" x2="0.35" y2="1">
			<stop offset="0%" stop-color="${metal.light}" />
			<stop offset="45%" stop-color="${metal.mid}" />
			<stop offset="100%" stop-color="${metal.dark}" />
		</linearGradient>
		<!-- userSpaceOnUse so every part of a multi-piece emblem (trophy handles,
		     robot ears, crown band) shares ONE light source instead of each shape
		     re-mapping the gradient to its own bounding box. -->
		<linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="200" y1="120" x2="300" y2="316">
			<stop offset="0%" stop-color="${accent}" />
			<stop offset="55%" stop-color="${accent}" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0.68" />
		</linearGradient>
		<radialGradient id="halo" cx="50%" cy="42%" r="52%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.30" />
			<stop offset="65%" stop-color="${accent}" stop-opacity="0.06" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0" />
		</radialGradient>
		<radialGradient id="field" cx="50%" cy="34%" r="72%">
			<stop offset="0%" stop-color="#1E2A27" />
			<stop offset="100%" stop-color="#0C1211" />
		</radialGradient>
		<linearGradient id="sheen" x1="0" y1="0" x2="0.6" y2="1">
			<stop offset="0%" stop-color="${PAGE}" stop-opacity="0.10" />
			<stop offset="52%" stop-color="${PAGE}" stop-opacity="0" />
		</linearGradient>
	</defs>

	<rect width="512" height="512" rx="40" fill="${INK}" />
	<rect width="512" height="512" rx="40" fill="url(#halo)" />
	<rect x="1.5" y="1.5" width="509" height="509" rx="38.5" fill="none" stroke="url(#metal)" stroke-opacity="0.45" stroke-width="3" />

	<g stroke="url(#metal)" stroke-width="2.4" stroke-opacity="0.55" stroke-linecap="round">
		${reededEdge(cx, cy, 150, 160)}
	</g>

	<circle cx="${cx}" cy="${cy}" r="143" fill="none" stroke="url(#metal)" stroke-width="9" />
	<circle cx="${cx}" cy="${cy}" r="132" fill="url(#field)" />
	<circle cx="${cx}" cy="${cy}" r="132" fill="url(#sheen)" />
	<circle cx="${cx}" cy="${cy}" r="126" fill="none" stroke="url(#metal)" stroke-width="1.5" stroke-opacity="0.55" />

	${emblems[emblem]()}

	<rect x="66" y="392" width="380" height="56" rx="16" fill="#0C1211" fill-opacity="0.85" stroke="url(#metal)" stroke-width="1.5" stroke-opacity="0.7" />
	<text x="256" y="429" font-size="29" font-weight="900" letter-spacing="-0.4" fill="${PAGE}" text-anchor="middle">${esc(name)}</text>

	${tierPips(tier)}

	<g transform="translate(186,486)">
		<rect x="0" y="0" width="13" height="13" rx="3.5" fill="${accent}" transform="rotate(45 6.5 6.5)" />
		<text x="24" y="11" font-size="13" font-weight="800" letter-spacing="1.6" fill="${MUTED}">COINDRAFT</text>
		<text x="140" y="11" font-size="13" font-weight="800" letter-spacing="1.6" fill="url(#metal)">${metal.label}</text>
	</g>
</svg>`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const badge of BADGES) {
	writeFileSync(join(OUT_DIR, `${badge.slug}.svg`), renderBadge(badge), 'utf-8');
	console.log(`Wrote static/badges/${badge.slug}.svg  (tier ${badge.tier} ${METALS[badge.tier].label})`);
}
console.log(`\nDone — ${BADGES.length} badges.`);
