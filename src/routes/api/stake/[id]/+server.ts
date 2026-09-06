import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { stakes, stakeParticipants } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { getSettlementProvider } from '$lib/server/settlement';

// GET /api/stake/[id] — state of a wager, from this player's perspective.
export async function GET({ params, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const stakeId = params.id;
	const stake = await db
		.select()
		.from(stakes)
		.where(eq(stakes.id, stakeId))
		.limit(1)
		.then((r) => r[0] ?? null);
	if (!stake) return json({ error: 'Stake not found' }, { status: 404 });

	const parts = await db
		.select()
		.from(stakeParticipants)
		.where(eq(stakeParticipants.stakeId, stakeId));

	const me = parts.find((p) => p.userId === parsed.userId);
	if (!me) return json({ error: 'Forbidden' }, { status: 403 });

	const balance = await getSettlementProvider().balanceOf(parsed.userId);

	return json({
		id: stake.id,
		tierAmount: stake.tierAmount,
		currency: stake.currency,
		status: stake.status,
		// Only revealed once locked — before that it would leak the opponent's number.
		agreedAmount: stake.status === 'locked' || stake.status === 'settled' ? stake.agreedAmount : null,
		myCommit: me.committed,
		myPayout: me.payout,
		confirmedAdult: Boolean(me.confirmedAdult),
		// Whether they've committed, never how much.
		opponentCommitted: parts.some((p) => p.userId !== parsed.userId && p.committed != null),
		balance
	});
}
