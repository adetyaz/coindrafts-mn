import { json } from '@sveltejs/kit';
import { getNews } from '$lib/server/sosovalue';
import {
	createChatCompletion,
	isInsufficientBalance,
	AiConfigError,
	activeBackend
} from '$lib/server/aiCompute';

interface Pick {
	sector: string;
	pick: string;
	pct: number;
	points: number;
}

function buildPrompt(picks: Pick[], status: string, newsHeadlines: string[]): string {
	const pickSummary = picks
		.map(
			(p) =>
				`  - ${p.sector}: ${p.pick} → ${p.pct >= 0 ? '+' : ''}${p.pct}% (${p.points.toFixed(1)} pts)`
		)
		.join('\n');

	const headlines =
		newsHeadlines.length > 0
			? newsHeadlines
					.slice(0, 6)
					.map((h) => `  • ${h}`)
					.join('\n')
			: '  • No recent headlines available.';

	return `You are CoinDraft's post-match AI analyst. Write a 2–3 sentence analysis of the player's performance.

Match outcome: ${status}

Their picks:
${pickSummary}

Recent crypto news context (from SoSoValue research feeds):
${headlines}

Rules:
- Be concise (2–3 sentences, max 80 words total)
- Reference 1–2 specific tokens by name
- Mention sector momentum or macro context from the news if relevant
- End on a forward-looking note (what to watch next draft)
- Do NOT use bullet points or headers — plain prose only`;
}

export async function POST({ request, cookies }) {
	// Auth check
	const { parseSessionToken } = await import('$lib/server/auth');
	const token = cookies.get('session');
	if (!token || !parseSessionToken(token)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { picks?: Pick[]; status?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const { picks, status } = body;
	if (!Array.isArray(picks) || picks.length === 0) {
		return json({ error: 'picks array required' }, { status: 400 });
	}

	// Fetch recent news headlines for context
	let newsHeadlines: string[] = [];
	try {
		const rawNews = (await getNews()) as unknown;
		if (Array.isArray(rawNews)) {
			newsHeadlines = rawNews
				.slice(0, 8)
				.map((n: Record<string, unknown>) => String(n?.title ?? n?.headline ?? ''))
				.filter(Boolean);
		}
	} catch {
		// News fetch failure is non-fatal — proceed without context
	}

	const prompt = buildPrompt(picks, status ?? 'MATCH ENDED', newsHeadlines);

	try {
		const chat = await createChatCompletion({
			messages: [{ role: 'user', content: prompt }],
			// gpt-oss is a reasoning model — it spends part of this budget on an
			// internal reasoning trace before emitting real content. 150 was tuned
			// for the old non-reasoning llama model and risks truncating before
			// any content comes through; verified 400 leaves headroom for both.
			max_tokens: 400,
			temperature: 0.7
		});

		const text = chat.choices[0]?.message?.content?.trim() ?? '';
		// Which backend answered, surfaced rather than assumed.
		return json({ breakdown: text, via: activeBackend().via });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error('[/api/breakdown]', message);
		if (e instanceof AiConfigError) {
			return json({ error: e.message, reason: 'ai_misconfigured' }, { status: 500 });
		}
		if (isInsufficientBalance(e)) {
			return json(
				{
					error: 'The AI provider account is out of balance, so the breakdown is unavailable.',
					reason: 'insufficient_balance'
				},
				{ status: 503 }
			);
		}
		return json({ error: 'AI breakdown unavailable', detail: message }, { status: 502 });
	}
}
