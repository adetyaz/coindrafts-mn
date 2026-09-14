// Dev-only faucet for the Midnight KYC local devnet (see AGENTS/task notes on
// contracts/midnight). Sends NIGHT from the genesis wallet to a freshly
// derived player identity so it can register for DUST and pay contract-call
// fees. Hard-gated to `dev` — this must never exist in a deployed build; it
// hands out funds to any caller with no auth, which is fine for a throwaway
// local chain and not fine for anything else.
import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { fundPlayerFromGenesis } from '$lib/server/midnightFunding';

export async function POST({ request }) {
	if (!dev) {
		return json({ error: 'Not available outside local development.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const address = typeof body?.address === 'string' ? body.address : '';
	if (!address.startsWith('mn_addr_undeployed')) {
		return json({ error: 'Expected an `address` field with an undeployed-network unshielded address.' }, { status: 400 });
	}

	try {
		const { txId } = await fundPlayerFromGenesis(address);
		return json({ txId });
	} catch (e) {
		console.error('[midnight-fund] failed:', e);
		const message = e instanceof Error ? e.message : 'Funding failed';
		return json({ error: message }, { status: 500 });
	}
}
