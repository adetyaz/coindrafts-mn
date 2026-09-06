import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { neon, neonConfig } from '@neondatabase/serverless';
import pg from 'pg';
import { DATABASE_URL } from '$env/static/private';
import * as schema from './schema';

// Two drivers, chosen from the connection string.
//
// `@neondatabase/serverless` speaks Neon's HTTP endpoint and cannot connect to
// an ordinary Postgres — so moving to Supabase needed a real driver swap, not
// just a new URL. Detecting from the host keeps both working: Supabase (or any
// standard Postgres) locally, Neon if it's ever pointed back, with no code
// change either way.
const isNeon = /\.neon\.tech/i.test(DATABASE_URL);

// ── Neon path ───────────────────────────────────────────────────────────────
// The Neon HTTP endpoint has been intermittently unreachable from this project's
// network — DNS resolves, but the TLS connection sometimes hangs and then fails
// (observed repeatedly at ~10.6s). A single dropped connection was enough to
// 500 a request as ordinary as signing in, so every query retries transient
// *connection* failures before giving up.
//
// Deliberately narrow: this retries only when fetch itself throws, i.e. the
// request never reached Postgres. A query that reaches the database and comes
// back with an error — a constraint violation, bad SQL — is returned untouched
// and is never re-sent, so this can't silently duplicate a write.
//
// Attempts and timeout are tuned against observed behaviour, not guessed: a
// healthy query returns in ~2s and the failure mode is a hang that gives up at
// ~10.6s, so each attempt is capped at 6s — above a good query, below the hang.
const MAX_ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 250;

if (isNeon) {
	const originalFetch = globalThis.fetch;

	neonConfig.fetchFunction = async (input: unknown, init: unknown) => {
		let lastError: unknown;

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
			try {
				return await originalFetch(input as RequestInfo, {
					...(init as RequestInit),
					signal: controller.signal
				});
			} catch (error) {
				lastError = error;
				if (attempt === MAX_ATTEMPTS) break;
				console.warn(`[db] connection failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`);
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
			} finally {
				clearTimeout(timer);
			}
		}

		console.error(`[db] connection failed after ${MAX_ATTEMPTS} attempts — Neon unreachable`);
		throw lastError;
	};
}

// ── Standard Postgres path (Supabase) ───────────────────────────────────────
// A small pool rather than a single client: the app issues several queries per
// request and a lone connection would serialise them. Kept small because the
// direct-connection endpoint (port 5432) has a modest connection cap — if this
// ever runs on serverless at scale, switch the URL to Supabase's transaction
// pooler on 6543 instead of raising this number.
function makePgDb() {
	const pool = new pg.Pool({
		connectionString: DATABASE_URL,
		max: 5,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
		// Supabase requires TLS; its certs aren't in Node's default trust store.
		ssl: { rejectUnauthorized: false }
	});

	pool.on('error', (err) => {
		// An idle client erroring must not take the process down.
		console.error('[db] idle pool client error:', err.message);
	});

	return drizzlePg(pool, { schema });
}

export const db = isNeon ? drizzleNeon(neon(DATABASE_URL), { schema }) : makePgDb();
