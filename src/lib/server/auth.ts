import { createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_SECRET } from '$env/static/private';
import { db } from './db';
import { users } from './schema';
import { eq } from 'drizzle-orm';

export interface SessionPayload {
	userId: string;
	ts: number;
}

// Sessions expire server-side. `ts` was previously written into every token and
// then never read, so a leaked cookie stayed valid forever.
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matching the cookie

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signs a session payload.
 *
 * ## What was wrong before (H-01)
 *
 * The old signature was:
 *
 *     base64(payloadStr + SESSION_SECRET).slice(0, 16)
 *
 * Base64 encodes sequentially — every 3 input bytes produce 4 output characters —
 * so keeping the first 16 characters keeps only the first **12 input bytes**.
 * `payloadStr` is ~92 bytes, so the secret sat far beyond the cut and **never
 * influenced the output at all**. The "signature" was a pure function of the
 * payload, which anyone can compute.
 *
 * The practical effect: knowing a user id was enough to mint a valid session for
 * that account. Verified by producing identical signatures with the real secret,
 * a wrong secret, and an empty secret.
 *
 * ## What this does instead
 *
 * A real HMAC-SHA256 over the payload, keyed by the secret, compared with
 * `timingSafeEqual` so verification can't be attacked by measuring how long a
 * comparison takes.
 */
function sign(payloadStr: string): string {
	return createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('base64url');
}

export function createSessionToken(userId: string): string {
	const payload: SessionPayload = { userId, ts: Date.now() };
	const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${payloadStr}.${sign(payloadStr)}`;
}

export function parseSessionToken(token: string): SessionPayload | null {
	try {
		const [payloadStr, sig] = token.split('.');
		if (!payloadStr || !sig) return null;

		const expected = sign(payloadStr);

		// Length must match before timingSafeEqual, which throws on a mismatch.
		// Comparing lengths first leaks only the length, never the bytes.
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return null;
		if (!timingSafeEqual(a, b)) return null;

		const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString()) as SessionPayload;

		if (typeof payload?.userId !== 'string' || typeof payload?.ts !== 'number') return null;

		// The user id must look like a UUID before it reaches the database.
		// Without this, a token carrying a malformed id makes Postgres throw on
		// `where id = '...'`, which surfaces as a 500 on every authenticated
		// route rather than "your session is invalid, sign in again". Found by a
		// test harness accidentally minting a token with a non-UUID id.
		if (!UUID_RE.test(payload.userId)) return null;

		// Enforce expiry. A token whose clock has run out is rejected even though
		// its signature is genuine.
		if (Date.now() - payload.ts > SESSION_MAX_AGE_MS) return null;

		return payload;
	} catch {
		return null;
	}
}

export async function getUserById(id: string) {
	const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return user ?? null;
}

export async function getUserByWalletAddress(address: string) {
	const [user] = await db.select().from(users).where(eq(users.walletAddress, address)).limit(1);
	return user ?? null;
}
