import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { parseSessionToken } from '$lib/server/auth';
import { signClaimVoucher } from '$lib/server/achievements';

// POST /api/achievements/claim-voucher { typeId } — signs a voucher the
// caller then submits themselves, from their own wallet, to
// claimAchievement() on-chain. This endpoint never sends a transaction.
export async function POST({ request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const typeId = Number(body?.typeId);
	if (!Number.isInteger(typeId) || typeId < 0) {
		return json({ error: 'A valid typeId is required' }, { status: 400 });
	}

	const user = await db
		.select({ walletAddress: users.walletAddress, chainType: users.chainType })
		.from(users)
		.where(eq(users.id, parsed.userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);
	if (!user) return json({ error: 'User not found' }, { status: 404 });
	if (user.chainType !== 'evm') {
		return json({ error: 'Achievement badges are on 0G Chain (EVM) — not available for Solana accounts yet.' }, { status: 400 });
	}

	const result = await signClaimVoucher(parsed.userId, user.walletAddress, typeId);
	if (!result.ok) return json({ error: result.error }, { status: 400 });

	return json({ signature: result.signature, contractAddress: result.contractAddress, typeId });
}
