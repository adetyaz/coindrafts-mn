import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { contests, lineups, lineupPicks, users } from '$lib/server/schema';

// Returns raw HTML directly (not a Svelte component) so link-preview crawlers
// (Twitter/Discord/etc — no JS execution, no cookies) get real og: meta tags
// in the initial response. This app runs ssr = false everywhere else because
// the root layout pulls in wallet SDKs that break under Node SSR; going
// through +page.svelte here would inherit that layout and crash the same
// way. A plain +server.ts endpoint never renders Svelte components or
// layouts, so it sidesteps that entirely.
export async function GET({ params, url }) {
	const contestId = params.id;
	const userId = url.searchParams.get('u');
	if (!contestId || !userId) return new Response('Not found', { status: 404 });

	const contest = await db
		.select()
		.from(contests)
		.where(eq(contests.id, contestId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!contest || contest.status !== 'resolved') return new Response('Not found', { status: 404 });
	if (contest.userAId !== userId && contest.userBId !== userId) {
		return new Response('Not found', { status: 404 });
	}

	const lineup = await db
		.select()
		.from(lineups)
		.where(and(eq(lineups.contestId, contestId), eq(lineups.userId, userId)))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!lineup) return new Response('Not found', { status: 404 });

	const picks = await db.select().from(lineupPicks).where(eq(lineupPicks.lineupId, lineup.id));
	const user = await db
		.select({ username: users.username })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	const didWin = contest.winnerId === userId;
	const yourScore = Number(Number(lineup.finalScore ?? 0).toFixed(0));
	const username = user?.username ?? 'Player';
	const contestType = contest.type ?? 'daily';

	const cardUrl = `${url.origin}/api/contest/${contestId}/card?u=${userId}`;
	const pageUrl = `${url.origin}/share/${contestId}?u=${userId}`;
	const title = `${didWin ? 'I won' : 'I played'} a ${contestType} contest on CoinDraft — ${yourScore} pts`;
	const description = picks
		.map((p) => `${p.tokenSymbol} ${Number(p.pctChange ?? 0) >= 0 ? '+' : ''}${Number(p.pctChange ?? 0).toFixed(1)}%`)
		.join(' · ');
	const tweetText = encodeURIComponent(
		`${didWin ? '🏆 I just won' : 'Just played'} a ${contestType} contest on CoinDraft — ${yourScore} pts`
	);
	const tweetUrl = `https://twitter.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(pageUrl)}`;

	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

	// Mirrors src/lib/server/resultCard.ts and src/routes/layout.css's design
	// tokens — this is a standalone HTML document (see the file header), so it
	// can't load app.css or the Google Fonts <link> from app.html and has to
	// duplicate both. Keep in sync if either changes.
	const SECTOR_COLOR: Record<string, string> = {
		l1: '#68C2A8',
		l2: '#5FA8D8',
		defi: '#F7C978',
		meme: '#F78E79',
		wildcard: '#81BBE3'
	};

	const pickChips = picks
		.map((p) => {
			const pct = Number(p.pctChange ?? 0);
			const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
			const color = SECTOR_COLOR[p.sector.toLowerCase()] ?? '#5C6B66';
			const pctColor = pct >= 0 ? '#1F7A63' : '#B04A32';
			return `<span style="display:inline-flex;align-items:baseline;gap:6px;background:#EDF3F2;border:1px solid ${color}66;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;margin:3px"><span>${esc(p.tokenSymbol)}</span><span style="font-family:'JetBrains Mono',ui-monospace,monospace;color:${pctColor}">${esc(pctStr)}</span></span>`;
		})
		.join('');

	const html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${esc(title)}</title>
	<meta name="description" content="${esc(description)}" />

	<meta property="og:type" content="website" />
	<meta property="og:title" content="${esc(title)}" />
	<meta property="og:description" content="${esc(description)}" />
	<meta property="og:image" content="${esc(cardUrl)}" />
	<meta property="og:url" content="${esc(pageUrl)}" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="${esc(title)}" />
	<meta name="twitter:description" content="${esc(description)}" />
	<meta name="twitter:image" content="${esc(cardUrl)}" />

	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
	/>

	<style>
		* { box-sizing: border-box; }
		body { font-family: 'Archivo', ui-sans-serif, system-ui, sans-serif; background: #F5FAFA; margin: 0; padding: 56px 16px; color: #1A2421; }
		.card { max-width: 620px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; align-items: center; }
		.brand { display: flex; align-items: center; gap: 10px; }
		.brand .mark { width: 18px; height: 18px; border-radius: 5px; background: #F78E79; transform: rotate(45deg); }
		.brand span { font-size: 16px; font-weight: 900; letter-spacing: -0.02em; }
		img.og { width: 100%; border-radius: 20px; box-shadow: 0 16px 40px rgba(26,36,33,0.16); display: block; }
		.result { width: 100%; border: 1px solid #E1E8E6; border-radius: 20px; background: #FFFFFF; padding: 24px; box-shadow: 0 2px 10px rgba(26,36,33,0.04); }
		.result h1 { margin: 0 0 12px; font-size: 17px; font-weight: 800; }
		.status {
			display: inline-block;
			font-weight: 900;
			font-size: 12px;
			letter-spacing: 0.06em;
			padding: 7px 14px;
			border-radius: 999px;
			margin-bottom: 14px;
			background: ${didWin ? '#F78E79' : '#EDF3F2'};
			color: ${didWin ? '#1A2421' : '#5C6B66'};
		}
		.status .pts { font-family: 'JetBrains Mono', ui-monospace, monospace; }
		.chips { display: flex; flex-wrap: wrap; gap: 0; }
		.actions { display: flex; gap: 10px; width: 100%; }
		.actions a { flex: 1; box-sizing: border-box; height: 50px; display: flex; align-items: center; justify-content: center; border-radius: 999px; font-weight: 800; font-size: 14px; text-decoration: none; transition: transform 0.15s ease; }
		.actions a:hover { transform: translateY(-1px); }
		.share-x { background: #F78E79; color: #1A2421; }
		.play { background: #FFFFFF; color: #5C6B66; border: 1px solid #E1E8E6; }
	</style>
</head>
<body>
	<div class="card">
		<div class="brand"><div class="mark"></div><span>CoinDraft</span></div>
		<img class="og" src="${esc(cardUrl)}" alt="${esc(title)}" />
		<div class="result">
			<h1>${esc(username)}'s ${esc(contestType)} contest</h1>
			<div class="status">${didWin ? 'YOU WON' : 'YOU LOST'} <span class="pts">· ${yourScore} pts</span></div>
			<div class="chips">${pickChips}</div>
		</div>
		<div class="actions">
			<a class="share-x" href="${esc(tweetUrl)}" target="_blank" rel="noopener noreferrer">Share to X</a>
			<a class="play" href="${url.origin}/dashboard">Play CoinDraft</a>
		</div>
	</div>
</body>
</html>`;

	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
