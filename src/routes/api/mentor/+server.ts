import { parseSessionToken } from '$lib/server/auth';
import { createChatCompletion, isInsufficientBalance, AiConfigError } from '$lib/server/aiCompute';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type SectorInfo = { id: string; name: string; change: number | null };
type TokenInfo = {
	symbol?: string;
	name?: string;
	price: number | null;
	change24h: number | null;
};
type NewsItem = { title?: string; source?: string };

const MAX_HISTORY = 8;

function buildSystemPrompt(sectors: SectorInfo[], tokens: TokenInfo[], news: NewsItem[]): string {
	const sectorLines = sectors
		.map((s) => `  - ${s.name}: ${(s.change ?? 0) >= 0 ? '+' : ''}${(s.change ?? 0).toFixed(2)}%`)
		.join('\n');

	const tokenLines = tokens
		.slice(0, 15)
		.map(
			(t) =>
				`  - ${(t.symbol ?? '').toUpperCase()} (${t.name ?? ''}): $${t.price ?? '—'} (${(t.change24h ?? 0) >= 0 ? '+' : ''}${(t.change24h ?? 0).toFixed(2)}% 24h)`
		)
		.join('\n');

	const newsLines =
		news.length > 0
			? news
					.slice(0, 6)
					.map((n) => `  - ${n.title}`)
					.join('\n')
			: '  - No recent headlines available.';

	return `You are the CoinDraft AI Mentor — a friendly market-literacy coach inside a fantasy-sports-style crypto drafting game. Players draft 5 tokens (L1, L2, DeFi, Meme, Wildcard) and compete on real price performance.

Your job: answer questions about tokens and sectors to help them draft smarter, grounded in the live data below. Be concise (2-4 sentences per answer unless asked for more detail). Mention specific token symbols by their exact uppercase ticker (e.g. "SOL", "ETH") when relevant, since the app links recognized tickers to the draft screen. Never give financial advice framed as certainty — frame it as "worth watching" / "here's the momentum," not guarantees. If asked something unrelated to crypto/markets/the app, gently redirect to what you can help with.

Live sector performance (24h):
${sectorLines || '  - unavailable'}

Live top tokens:
${tokenLines || '  - unavailable'}

Recent market news:
${newsLines}`;
}

export async function POST({ request, cookies, fetch }) {
	const token = cookies.get('session');
	if (!token || !parseSessionToken(token)) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let body: { messages?: ChatMessage[] };
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const messages = Array.isArray(body.messages) ? body.messages : [];
	if (messages.length === 0) {
		return new Response(JSON.stringify({ error: 'messages array required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const [sectorsRes, tokensRes, newsRes] = await Promise.allSettled([
		fetch('/api/sectors').then((r) => (r.ok ? r.json() : [])),
		fetch('/api/tokens').then((r) => (r.ok ? r.json() : [])),
		fetch('/api/news').then((r) => (r.ok ? r.json() : []))
	]);

	const sectors: SectorInfo[] = sectorsRes.status === 'fulfilled' ? sectorsRes.value : [];
	const tokens: TokenInfo[] = tokensRes.status === 'fulfilled' ? tokensRes.value : [];
	const news: NewsItem[] = newsRes.status === 'fulfilled' ? newsRes.value : [];

	const systemPrompt = buildSystemPrompt(sectors, tokens, news);
	const trimmedHistory = messages.slice(-MAX_HISTORY);

	try {
		const stream = await createChatCompletion({
			messages: [{ role: 'system', content: systemPrompt }, ...trimmedHistory],
			max_tokens: 400,
			temperature: 0.6,
			stream: true
		});

		const encoder = new TextEncoder();
		const readable = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of stream) {
						const delta = chunk.choices[0]?.delta?.content ?? '';
						if (delta) controller.enqueue(encoder.encode(delta));
					}
				} catch (e) {
					console.error('[/api/mentor] stream error', e);
				} finally {
					controller.close();
				}
			}
		});

		return new Response(readable, {
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error('[/api/mentor]', message);
		// 0G bills per inference — an exhausted balance is an operational state
		// with a specific fix, not a generic outage. Worth naming.
		if (e instanceof AiConfigError) {
			return new Response(JSON.stringify({ error: e.message, reason: 'ai_misconfigured' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		if (isInsufficientBalance(e)) {
			return new Response(
				JSON.stringify({
					error: 'The AI provider account is out of balance, so Mentor is unavailable right now.',
					reason: 'insufficient_balance'
				}),
				{ status: 503, headers: { 'Content-Type': 'application/json' } }
			);
		}
		return new Response(JSON.stringify({ error: 'Mentor unavailable', detail: message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
