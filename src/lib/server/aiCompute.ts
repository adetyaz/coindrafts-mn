// Shared AI-inference client for /api/mentor, /api/breakdown and the AI draft
// agent — Groq by default, 0G Compute Router when USE_0G_COMPUTE=true and
// fully configured. See docs-project/0g-compute-integration-findings.md for
// the research behind this (testnet/mainnet URLs, contract addresses, setup).
//
// ⚠️ Why call sites must use `createChatCompletion()` and not
// `client.chat.completions.create()` directly:
//
// groq-sdk HARDCODES the request path as `/openai/v1/chat/completions`
// (node_modules/groq-sdk/src/resources/chat/completions.ts). That's correct
// for api.groq.com, but appending it to 0G's baseURL (which already ends in
// `/v1`) produces `.../v1/openai/v1/chat/completions` — a 404. The 0G Router
// expects `/v1/chat/completions`.
//
// Found live 2026-08-28: the very first real request through the app on the
// 0G path 404'd, despite the endpoint having been curl-verified as healthy.
// Prior verification had only ever hit the Router directly, never through
// groq-sdk, so this was invisible until the flag was actually flipped.
//
// Fix: reuse groq-sdk's HTTP/auth/streaming layer via its generic `.post()`,
// just with the correct path. No new dependency, and the 0G Router is
// OpenAI-shaped so the request/response bodies are already identical.
import { env } from '$env/dynamic/private';
import { GROQ_API_KEY } from '$env/static/private';
import { ZG_COMPUTE, ZG_IS_MAINNET } from '$lib/server/zgNetwork';
import Groq from 'groq-sdk';
import type { ChatCompletion, ChatCompletionChunk } from 'groq-sdk/resources/chat/completions';
import type { Stream } from 'groq-sdk/lib/streaming';

const GROQ_MODEL = 'openai/gpt-oss-120b';

export class AiConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiConfigError';
	}
}

/**
 * Resolves the active inference backend.
 *
 * **0G is not best-effort.** When `USE_0G_COMPUTE=true`, an incomplete 0G config
 * now throws instead of quietly serving Groq. The previous behaviour logged a
 * warning to a server console nobody reads and carried on — so the app could
 * claim to be running on 0G while every answer came from Groq, and the only
 * evidence was a line in a terminal. That is exactly the failure you can't
 * afford when "verified on 0G" is written on the screen: a receipt is worthless
 * if the thing it attests to might silently not have happened.
 *
 * Groq remains available, but only as a deliberate choice — set
 * `USE_0G_COMPUTE=false`. It is no longer something the app can fall into.
 */
export function getAiClient(): { client: Groq; model: string; via: '0g' | 'groq' } {
	const wants0G = env.USE_0G_COMPUTE === 'true';
	const apiKey = ZG_COMPUTE.apiKey;
	const baseURL = ZG_COMPUTE.baseURL;
	const model = ZG_COMPUTE.model;

	if (wants0G) {
		// Var names reflect ZG_IS_MAINNET (zgNetwork.ts) — dev always reads the
		// plain names, anything deployed reads the _MAINNET-suffixed ones.
		const suffix = ZG_IS_MAINNET ? '_MAINNET' : '';
		const missing = [
			!apiKey && `ZG_COMPUTE_API_KEY${suffix}`,
			!baseURL && `ZG_COMPUTE_BASE_URL${suffix}`,
			!model && `ZG_COMPUTE_MODEL${suffix}`
		].filter(Boolean);

		if (missing.length > 0) {
			throw new AiConfigError(
				`USE_0G_COMPUTE=true but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
					'Refusing to silently fall back to Groq — set the missing value(s), or set USE_0G_COMPUTE=false to use Groq deliberately.'
			);
		}

		return { client: new Groq({ apiKey, baseURL }), model: model!, via: '0g' };
	}

	if (!GROQ_API_KEY) {
		throw new AiConfigError('USE_0G_COMPUTE is not true and GROQ_API_KEY is not set — no AI backend is configured.');
	}

	return { client: new Groq({ apiKey: GROQ_API_KEY }), model: GROQ_MODEL, via: 'groq' };
}

type ChatParams = {
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
	max_tokens?: number;
	temperature?: number;
	stream?: boolean;
};

/**
 * What 0G returns alongside a completion, in `x_0g_trace`. Probed directly
 * against the Router — this is the real shape, not documentation:
 *
 *   { billing: { input_cost, output_cost, total_cost },
 *     provider: "0xa48f01287233509FD694a22Bf840225062E67836",
 *     request_id: "23ff4dbb-9bc4-4186-9ec7-0ad720433a3a" }
 *
 * Deliberate limitation, stated so nobody overclaims on it: the Router exposes
 * **no attestation endpoint** (`/attestation`, `/verify`, `/attestations`,
 * `/tee/attestation` all 404). So this is a signed billing receipt naming a
 * TEE-attested provider — tamper-evident and independently addressable by
 * request id — but NOT a TDX quote we can verify ourselves. Language in the UI
 * should say "verified on 0G", never "cryptographically proven".
 */
export type ComputeTrace = {
	provider: string | null;
	requestId: string | null;
	totalCost: string | null;
	model: string;
	via: '0g' | 'groq';
};

/** Pulls the 0G trace off a completion. Returns a Groq-shaped trace when 0G isn't the active path. */
export function extractTrace(res: unknown, model: string, via: '0g' | 'groq'): ComputeTrace {
	const base: ComputeTrace = { provider: null, requestId: null, totalCost: null, model, via };
	if (!res || typeof res !== 'object') return base;
	const trace = (res as Record<string, unknown>).x_0g_trace as Record<string, unknown> | undefined;
	if (!trace) return base;
	const billing = trace.billing as Record<string, unknown> | undefined;
	return {
		provider: typeof trace.provider === 'string' ? trace.provider : null,
		requestId: typeof trace.request_id === 'string' ? trace.request_id : null,
		totalCost: billing && typeof billing.total_cost === 'string' ? billing.total_cost : null,
		model,
		via
	};
}

/** Which backend served the last call — needed to label a trace correctly. */
export function activeBackend(): { model: string; via: '0g' | 'groq' } {
	const { model, via } = getAiClient();
	return { model, via };
}

/**
 * 0G charges per inference, so an exhausted balance is a real, expected failure
 * mode rather than a bug — and one that surfaced as a generic 502 before this.
 * Detected from the Router's own error shape.
 */
export function isInsufficientBalance(e: unknown): boolean {
	const msg = e instanceof Error ? e.message : String(e ?? '');
	return (
		msg.includes('402') ||
		msg.toLowerCase().includes('insufficient_balance') ||
		msg.toLowerCase().includes('insufficient balance')
	);
}

/**
 * Backend-agnostic chat completion. Routes to the right path for whichever
 * provider is active (see the path note at the top of this file) and injects
 * that provider's model, so call sites never hardcode either.
 */
export function createChatCompletion(
	params: ChatParams & { stream: true }
): Promise<Stream<ChatCompletionChunk>>;
export function createChatCompletion(
	params: ChatParams & { stream?: false }
): Promise<ChatCompletion>;
export function createChatCompletion(
	params: ChatParams
): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
	const { client, model, via } = getAiClient();
	const body = { ...params, model };

	if (via === '0g') {
		return client.post('/chat/completions', {
			body,
			stream: params.stream ?? false
		}) as Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
	}

	return client.chat.completions.create(
		body as Parameters<typeof client.chat.completions.create>[0]
	) as Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
}
