import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lineups, lineupPicks } from '$lib/server/schema';
import { parseSessionToken } from '$lib/server/auth';
import { getSnapshot, extractPrice, getTokensWithPrices } from '$lib/server/sosovalue';
import { pickScrimmageBot, draftBotLineup } from '$lib/server/botDraft';
import { DEFAULT_DURATION_MINUTES } from '$lib/constants';

export async function POST({ params, request, cookies }) {
	const token = cookies.get('session');
	const parsed = token ? parseSessionToken(token) : null;
	if (!parsed) return json({ error: 'Unauthorized' }, { status: 401 });

	const contestId = params.id;
	if (!contestId) return json({ error: 'Contest id is required' }, { status: 400 });

	const body = await request.json();
	const picks = Array.isArray(body?.picks) ? body.picks : [];
	if (picks.length !== 5) {
		return json({ error: 'Exactly 5 picks are required' }, { status: 400 });
	}

	const existingContest = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!existingContest) return json({ error: 'Contest not found' }, { status: 404 });
	if (existingContest.userAId !== parsed.userId && existingContest.userBId !== parsed.userId) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	// Once the contest is live, a "re-lock" isn't a re-lock — it's a redraft
	// mid-race, silently overwriting the entry prices scoring already keyed
	// off. Re-locking while still 'open' (contest not started yet, or waiting
	// on the opponent) is fine — nothing has been scored against it yet.
	if (existingContest.status === 'live') {
		return json({ error: 'This contest is already live — your lineup is locked in.' }, { status: 409 });
	}

	const existingLineup = await db
		.select()
		.from(lineups)
		.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, parsed.userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	// ── Price FIRST, write second ────────────────────────────────────────────
	// Order matters, and getting it wrong corrupted real games. This used to
	// mark the lineup `locked` and DELETE its picks up front, then fetch prices,
	// then write the picks back. Any failure in the fetch left a lineup flagged
	// locked and holding nothing — permanently, since a re-lock is refused once
	// the contest goes live. That is exactly how contest 352fc4db ended up with
	// a player who had zero picks, scored 0, and lost a match they never played;
	// the trigger was getTokensWithPrices() throwing on production for weeks
	// (Binance geo-blocks the API from US regions, see src/lib/server/prices.ts).
	//
	// Nothing below touches the database until every pick has a price in hand.
	//
	// Priced from the same batch pool the draft screen itself is built from —
	// one cached call, not five parallel single-token requests. That per-token
	// burst (here and in the bot path below) was the actual cause of entry
	// prices silently landing on $0 under any rate-limit blip: extractPrice()
	// treats a failed fetch as "$0", not "unknown", and a $0 entry gets
	// filtered out of the race chart client-side, making it read as blank.
	const priceByCurrency = new Map((await getTokensWithPrices()).map((t) => [t.currency_id, t.price]));
	async function priceFor(currencyId: string): Promise<number> {
		const cached = priceByCurrency.get(currencyId);
		if (cached != null && cached > 0) return cached;
		// Rare fallback — a token that's dropped out of the pool since the user
		// drafted it. Single-token lookup is fine as a one-off, just not as a burst.
		try {
			return extractPrice(await getSnapshot(currencyId));
		} catch {
			return 0;
		}
	}

	const pickRows: {
		tokenSymbol: string;
		tokenName: string;
		sector: string;
		currencyId: string;
		entryPrice: string;
		exitPrice: string;
		pctChange: string;
		score: string;
	}[] = [];
	for (const pick of picks) {
		const entryPrice = await priceFor(String(pick.currencyId));
		pickRows.push({
			tokenSymbol: String(pick.symbol ?? '').toUpperCase(),
			tokenName: String(pick.name ?? pick.symbol ?? ''),
			sector: String(pick.sector ?? 'wildcard'),
			currencyId: String(pick.currencyId),
			entryPrice: String(entryPrice),
			exitPrice: String(entryPrice),
			pctChange: '0',
			score: '0'
		});
	}

	// ── Then write it all, atomically ────────────────────────────────────────
	// Wrapped in a transaction so the lock, the clearing of any previous picks
	// and the new picks land together or not at all. Without it, a failure
	// between the delete and the inserts leaves the same empty-locked-lineup
	// state the reordering above is meant to prevent.
	let lineupId: string;
	await db.transaction(async (tx) => {
		if (!existingLineup?.id) {
			const inserted = await tx
				.insert(lineups)
				.values({ contestId, userId: parsed.userId, locked: true, finalScore: '0' })
				.returning({ id: lineups.id });
			lineupId = inserted[0].id;
		} else {
			lineupId = existingLineup.id;
			await tx.update(lineups).set({ locked: true }).where(eq(lineups.id, lineupId));
			await tx.delete(lineupPicks).where(eq(lineupPicks.lineupId, lineupId));
		}
		await tx.insert(lineupPicks).values(pickRows.map((r) => ({ ...r, lineupId })));
	});
	lineupId = lineupId!;

	// Scrimmage contests are created directly (never via matchmaking_queue), so
	// bots-service never sees them. Assign a real bot opponent right here, the
	// moment the human submits — same instant the human's entry prices are
	// captured, so both sides reflect the same market moment.
	//
	// This used to swallow a failure here and mark the contest live anyway, on
	// the assumption that resolution had a fallback for a missing bot lineup.
	// It doesn't — a missing userBId makes resolution skip scoring entirely and
	// record the human as the loser of a game that never had an opponent. So
	// this now retries once, and refuses to start the game at all rather than
	// start it broken. Priced from `botPicks[i].price`, carried straight from
	// draftBotLineup's own batch fetch — no separate per-token price burst here.
	if (existingContest.isPaper && !existingContest.userBId) {
		let botReady = false;
		for (let attempt = 0; attempt < 2 && !botReady; attempt++) {
			try {
				const bot = pickScrimmageBot();
				const botPicks = await draftBotLineup();
				if (botPicks.length !== 5) throw new Error('Bot draft returned an incomplete lineup');

				const [botLineup] = await db
					.insert(lineups)
					.values({ contestId, userId: bot.id, locked: true, finalScore: '0' })
					.returning({ id: lineups.id });

				for (const p of botPicks) {
					const entryPrice = p.price ?? 0;
					await db.insert(lineupPicks).values({
						lineupId: botLineup.id,
						tokenSymbol: p.symbol.toUpperCase(),
						tokenName: p.name,
						sector: p.sector,
						currencyId: p.currencyId,
						entryPrice: String(entryPrice),
						exitPrice: String(entryPrice),
						pctChange: '0',
						score: '0'
					});
				}

				await db.update(contests).set({ userBId: bot.id }).where(eq(contests.id, contestId));
				botReady = true;
			} catch (e) {
				console.error(`[contest/lineup] Scrimmage bot draft failed (attempt ${attempt + 1}/2):`, e);
			}
		}

		if (!botReady) {
			// The human's own lineup is already saved (locked:true, above) —
			// retrying this same request will find it and just re-lock picks,
			// so nothing is lost by bailing out here.
			return json(
				{ error: "Couldn't set up your Scrimmage opponent — please try locking your lineup again." },
				{ status: 503 }
			);
		}
	}

	// Start the clock only once BOTH sides have actually locked a lineup — never
	// on the first submission alone. It used to go live the instant userA (the
	// creator) submitted, so userB's entire draft time was silently eaten by a
	// timer they didn't know was already running, and a slow userB's game could
	// resolve before they'd ever picked. Refetch first: the scrimmage block
	// above may have just set userBId on this same request.
	const contestNow = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0]!);

	if (contestNow.status !== 'live') {
		const otherUserId =
			contestNow.userAId === parsed.userId ? contestNow.userBId : contestNow.userAId;
		// Requires actual PICKS, not merely a lineup row. Checking only for the
		// row let a half-written lineup count as "ready", so the contest would go
		// live with one player holding nothing — they'd score 0 and lose a match
		// they never played. The transaction above should prevent that state
		// arising at all now; this is the second line of defence, and it also
		// covers rows already corrupted before the fix.
		const otherLineupReady = otherUserId
			? await db
					.select({ id: lineupPicks.id })
					.from(lineupPicks)
					.innerJoin(lineups, eq(lineups.id, lineupPicks.lineupId))
					.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, otherUserId)))
					.limit(1)
					.then((rows) => rows.length > 0)
			: false;

		if (otherLineupReady) {
			const durationMinutes = contestNow.durationMinutes ?? DEFAULT_DURATION_MINUTES;
			const startAt = new Date();
			const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
			await db
				.update(contests)
				.set({ status: 'live', startAt, endAt })
				.where(eq(contests.id, contestId));
		}
	}

	return json({ ok: true, contestId, lineupId });
}
