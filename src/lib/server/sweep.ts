// Opportunistic resolution sweep.
//
// The problem: a contest can now be 10 minutes long, but the only *scheduled*
// job is a once-daily cron (Vercel Hobby caps it there). Resolution otherwise
// happens lazily when a player opens their own result page — so a short game
// that nobody looks at sits `live` for up to a day. Short games were playable
// but not reliably finishable, which undercut the point of building them.
//
// The fix: any request to the app can trigger a sweep of everything that's due,
// not just the caller's own game. So as long as *somebody* is using the site,
// *everybody's* finished games resolve within a minute or so.
//
// Three properties that make this safe to hang off ordinary traffic:
//   • Throttled — at most one sweep per interval, process-wide.
//   • Non-blocking — never awaited by the request that triggered it.
//   • Bounded — a capped batch per pass, so a backlog can't stall a request
//     path or hammer the price API.
import { and, eq, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lobbies } from '$lib/server/schema';
import { resolveContest } from '$lib/server/contest-resolution';
import { resolveLobby } from '$lib/server/lobby-resolution';

const SWEEP_INTERVAL_MS = 60_000;
const MAX_PER_SWEEP = 10;

let lastSweep = 0;
let running = false;

async function runSweep() {
	const now = new Date();

	const dueContests = await db
		.select({ id: contests.id })
		.from(contests)
		.where(and(eq(contests.status, 'live'), lte(contests.endAt, now)))
		.limit(MAX_PER_SWEEP);

	for (const c of dueContests) {
		try {
			await resolveContest(c.id);
		} catch (e) {
			// One bad contest must not stop the rest. Price outages already return
			// `prices_unavailable` rather than throwing, so this is for the unexpected.
			console.error(`[sweep] contest ${c.id} failed:`, e);
		}
	}

	const dueLobbies = await db
		.select({ id: lobbies.id })
		.from(lobbies)
		.where(and(eq(lobbies.status, 'live'), lte(lobbies.endAt, now)))
		.limit(MAX_PER_SWEEP);

	for (const l of dueLobbies) {
		try {
			await resolveLobby(l.id);
		} catch (e) {
			console.error(`[sweep] lobby ${l.id} failed:`, e);
		}
	}

	if (dueContests.length || dueLobbies.length) {
		console.info(
			`[sweep] resolved ${dueContests.length} contest(s), ${dueLobbies.length} lobby/lobbies`
		);
	}
}

/**
 * Fire-and-forget. Safe to call on every request — it self-throttles and never
 * blocks the caller.
 */
export function maybeSweep(): void {
	const now = Date.now();
	if (running || now - lastSweep < SWEEP_INTERVAL_MS) return;

	lastSweep = now;
	running = true;

	void runSweep()
		.catch((e) => console.error('[sweep] failed:', e))
		.finally(() => {
			running = false;
		});
}
