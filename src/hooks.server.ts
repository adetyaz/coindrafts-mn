import type { Handle } from '@sveltejs/kit';
import { maybeSweep } from '$lib/server/sweep';

// Ordinary traffic drives resolution.
//
// A contest can be as short as 10 minutes, but the only scheduled job is a
// once-daily cron. Rather than leave short games waiting on their own player to
// open a result page, every request nudges a throttled sweep of everything
// that's due — so any visitor's page load finishes other people's games too.
//
// The call is deliberately fire-and-forget and self-throttling: it never awaits,
// never blocks the response, and runs at most once a minute process-wide.
export const handle: Handle = async ({ event, resolve }) => {
	maybeSweep();
	return resolve(event);
};
