import { json, error } from '@sveltejs/kit';
import { ACHIEVEMENT_META } from '$lib/server/achievements';
import { ACHIEVEMENT_ART, TIER_LABEL, badgeImagePath } from '$lib/achievementArt';

// ERC-721 metadata for one achievement type — this is what the contract's
// `tokenURI()` points at, so it's what wallets and explorers read to render a
// claimed badge. Public and unauthenticated by necessity: the caller is a
// wallet, an indexer or a marketplace crawler, never a logged-in session.
//
// Served dynamically rather than as static JSON files so name/description stay
// single-sourced from ACHIEVEMENT_META — the same copy the claim UI shows.
//
// `image` is built from the request's own origin, so the same code yields the
// right absolute URL in dev, preview and production without hardcoding a
// domain. Note the on-chain metadataURI is what actually gets crawled, so
// whichever origin is baked into that URI (see
// contracts/scripts/set-achievement-metadata.ts) is the one that must stay up.
export async function GET({ params, url, setHeaders }) {
	const typeId = Number(params.typeId);
	if (!Number.isInteger(typeId) || typeId < 0) error(400, 'Invalid typeId');

	const meta = ACHIEVEMENT_META[typeId];
	const art = ACHIEVEMENT_ART[typeId];
	const imagePath = badgeImagePath(typeId);
	if (!meta || !art || !imagePath) error(404, 'Unknown achievement type');

	// Deliberately short, not immutable: wallets and indexers cache metadata
	// hard, and an eternal max-age makes updated art effectively unshippable.
	setHeaders({ 'Cache-Control': 'public, max-age=300' });

	return json({
		name: meta.name,
		description: meta.description,
		image: `${url.origin}${imagePath}`,
		external_url: `${url.origin}/profile`,
		attributes: [
			{ trait_type: 'Tier', value: TIER_LABEL[art.tier] },
			{ trait_type: 'Type ID', value: typeId },
			{ trait_type: 'Soulbound', value: 'Yes' }
		]
	});
}
