import { json } from '@sveltejs/kit';
import { parseSessionToken } from '$lib/server/auth';
import { commitToStake } from '$lib/server/wager';

// POST /api/stake/[id]/commit — a player privately commits what they'll risk.
//
// Blind by construction: the response never reveals what the opponent
// committed, only whether they have. Their number is knowable solely through
// the settled amount once both are in, which is the minimum of the two.
export async function POST({ params, request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const stakeId = params.id;
	if (!stakeId) return json({ error: 'Stake id required' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const amount = Number(body?.amount);
	const confirmedAdult = body?.confirmedAdult === true;

	if (!Number.isFinite(amount) || amount <= 0) {
		return json({ error: 'A positive amount is required' }, { status: 400 });
	}

	const result = await commitToStake(stakeId, parsed.userId, amount, confirmedAdult);

	if (!result.ok) {
		const status =
			result.reason === 'age_not_confirmed' ? 403 :
			result.reason === 'not_found' ? 404 :
			result.reason === 'insufficient_balance' ? 402 : 400;
		const message =
			result.reason === 'age_not_confirmed'
				? 'You must confirm you are 18 or over before staking.'
				: result.reason === 'insufficient_balance'
					? "One player couldn't cover the stake, so the wager was cancelled and nothing was taken."
					: result.reason === 'already_committed'
						? 'You have already committed to this wager.'
						: result.reason;
		return json({ error: message, reason: result.reason }, { status });
	}

	return json(result);
}
