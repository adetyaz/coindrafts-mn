import { json } from '@sveltejs/kit';
import { SiweMessage } from 'siwe';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createSessionToken } from '$lib/server/auth';

export async function POST({ request, cookies }) {
	const body = await request.json();
	const { type, message, signature, address } = body;
	// type: 'evm' | 'solana'

	const nonce = cookies.get('siwe_nonce');
	if (!nonce) return json({ error: 'Nonce expired — try again' }, { status: 400 });

	let verifiedAddress: string | null = null;

	if (type === 'evm') {
		// ── EVM: verify SIWE message ──────────────────────────────────────────
		try {
			const siweMessage = new SiweMessage(message);
			const result = await siweMessage.verify({ signature, nonce });
			if (!result.success) throw new Error('Invalid signature');
			verifiedAddress = siweMessage.address.toLowerCase();
		} catch {
			return json({ error: 'EVM signature verification failed' }, { status: 401 });
		}
	} else if (type === 'solana') {
		// ── Solana: verify ed25519 signature ─────────────────────────────────
		try {
			const messageBytes = new TextEncoder().encode(message);
			const signatureBytes = bs58.decode(signature);
			const publicKeyBytes = bs58.decode(address);
			const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
			if (!valid) throw new Error('Invalid signature');
			verifiedAddress = address;
		} catch {
			return json({ error: 'Solana signature verification failed' }, { status: 401 });
		}
	} else {
		return json({ error: 'Unknown chain type' }, { status: 400 });
	}

	// Ensure we have a verified address
	if (!verifiedAddress) {
		return json({ error: 'Verification failed' }, { status: 401 });
	}

	// ── Upsert user by wallet address ──────────────────────────────────────
	// The signature is already verified by this point, so any failure here is
	// infrastructure, not the user. It used to throw and surface as a bare 500
	// with no explanation — the wallet had signed, and the app just died. A
	// database problem is not the signer's fault and shouldn't look like a
	// rejected login.
	let user;
	try {
		user = await db
			.select()
			.from(users)
			.where(eq(users.walletAddress, verifiedAddress))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!user) {
			// First time — create user record
			const [newUser] = await db
				.insert(users)
				.values({
					walletAddress: verifiedAddress,
					username: `player_${verifiedAddress.slice(2, 8)}`, // default username
					chainType: type
				})
				.returning();
			user = newUser;
		}
	} catch (e) {
		const raw = e instanceof Error ? e.message : String(e);
		// Neon returns 402 when a project exceeds its compute quota. That's an
		// account/billing state, not an outage, and it needs saying plainly —
		// otherwise it's indistinguishable from "the app is broken".
		const quotaExhausted = raw.includes('402') || raw.toLowerCase().includes('quota');
		console.error('[auth/verify] database unavailable:', raw);
		return json(
			{
				error: quotaExhausted
					? 'The database has hit its usage limit, so sign-in is unavailable right now. Your wallet signature was fine — nothing was charged.'
					: "Couldn't reach the database. Your wallet signature was fine — please try again in a moment.",
				retryable: true,
				reason: quotaExhausted ? 'db_quota' : 'db_unavailable'
			},
			{ status: 503 }
		);
	}

	if (!user) {
		return json(
			{ error: 'Could not create your account. Please try again.', retryable: true },
			{ status: 503 }
		);
	}

	// ── Create session cookie ───────────────────────────────────────────────
	const token = createSessionToken(user.id);
	cookies.delete('siwe_nonce', { path: '/' });
	cookies.set('session', token, {
		path: '/',
		httpOnly: true,
		maxAge: 60 * 60 * 24 * 7, // 7 days
		sameSite: 'strict'
	});

	return json({
		ok: true,
		user: { id: user.id, username: user.username, walletAddress: user.walletAddress }
	});
}
