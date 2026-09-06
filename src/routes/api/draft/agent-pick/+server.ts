import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users, aiAssists } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { pickForSectors } from '$lib/server/draftAgent';
import { isInsufficientBalance, AiConfigError } from '$lib/server/aiCompute';

const XP_COST_PER_SLOT = 15;

export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const sectors = Array.isArray(body?.sectors) ? body.sectors.filter((s: unknown) => typeof s === 'string') : [];
	if (sectors.length === 0 || sectors.length > 5) {
		return json({ error: '1-5 sectors required' }, { status: 400 });
	}
	// Scrimmage contests carry no real stakes by design (H-03/G-01) — the
	// agent's XP toll would contradict that if it hit real xpTotal here.
	const isPaper = body?.isPaper === true;

	const user = await db
		.select()
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!user) return json({ error: 'User not found' }, { status: 404 });

	let picks;
	let trace;
	try {
		({ picks, trace } = await pickForSectors(sectors));
	} catch (e) {
		console.error('[/api/draft/agent-pick]', e);
		// 0G bills per inference, so an empty balance is an expected operational
		// state, not a crash. It used to surface as a generic 502 with nothing
		// pointing at the actual cause.
		if (e instanceof AiConfigError) {
			return json({ error: e.message, reason: 'ai_misconfigured' }, { status: 500 });
		}
		if (isInsufficientBalance(e)) {
			return json(
				{
					error: 'The AI provider account is out of balance, so the draft agent is unavailable. Your XP was not charged.',
					reason: 'insufficient_balance'
				},
				{ status: 503 }
			);
		}
		return json({ error: 'Draft agent unavailable' }, { status: 502 });
	}

	const freeHitUsed = !isPaper && (user.freeHitsAvailable ?? 0) > 0;
	const xpCharged = isPaper || freeHitUsed ? 0 : XP_COST_PER_SLOT * sectors.length;

	if (xpCharged > 0 || freeHitUsed) {
		await db
			.update(users)
			.set({
				xpTotal: Math.max(0, (user.xpTotal ?? 0) - xpCharged),
				freeHitsAvailable: freeHitUsed ? (user.freeHitsAvailable ?? 0) - 1 : user.freeHitsAvailable
			})
			.where(eq(users.id, parsed.userId));
	}

	// Receipt. Only recorded when an inference actually produced the picks —
	// `trace` is null when the model failed and the procedural fallback ran, and
	// recording that as AI-assisted would be a lie in the player's disfavour.
	// Never allowed to fail the request: the picks are already made and the XP
	// already charged, so a bookkeeping error must not undo the user's action.
	if (trace) {
		try {
			await db.insert(aiAssists).values({
				userId: parsed.userId,
				contestId: typeof body?.contestId === 'string' ? body.contestId : null,
				sectors: sectors.join(','),
				slotCount: sectors.length,
				xpCharged,
				freeHitUsed,
				isPaper,
				via: trace.via,
				model: trace.model,
				provider: trace.provider,
				requestId: trace.requestId,
				totalCost: trace.totalCost
			});
		} catch (e) {
			console.error('[/api/draft/agent-pick] receipt write failed:', e);
		}
	}

	return json({
		picks,
		xpCharged,
		freeHitUsed,
		isPaper,
		// Handed back so the draft screen can show what backed the picks.
		verifiedOn: trace?.via === '0g' ? '0g' : null,
		requestId: trace?.requestId ?? null
	});
}
