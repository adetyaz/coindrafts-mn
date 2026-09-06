<script lang="ts">
	import architectureDiagram from '$lib/assets/coindraft_architecture.svg';
	import userFlowDiagram from '$lib/assets/coindraft_user_flow.svg';
	import walletAuthDiagram from '$lib/assets/wallet_auth_flow.svg';
	import scoringFlowDiagram from '$lib/assets/scoring_resolution_flow.svg';
	import rateLimitDiagram from '$lib/assets/rate_limit_flow.svg';

	// Each diagram sits inside the section it documents — they ARE the
	// architecture and the technical flows, not a gallery bolted on the side.
	const TECHNICAL_FLOWS = [
		{
			id: 'flow-auth',
			title: 'Signing in',
			lead: 'Two wallet families, one session. EVM signs a SIWE message, Solana signs the same nonce with ed25519, and both converge on a single HMAC-signed cookie — no passwords, no session table.',
			src: walletAuthDiagram
		},
		{
			id: 'flow-scoring',
			title: 'Scoring and resolution',
			lead: 'What happens when a contest\'s window closes. The two guards are the important part: it refuses to settle before the real end time, and refuses to score at all if any exit price is missing rather than treating a failed fetch as "didn\'t move".',
			src: scoringFlowDiagram
		},
		{
			id: 'flow-prices',
			title: 'Getting prices without getting rate-limited',
			lead: 'The draft pool used to be capped at 30 tokens because each one cost its own request. One batch call now covers the whole market, which is what made ~170 tokens draftable.',
			src: rateLimitDiagram
		}
	];

	const SECTORS_LEGEND = [
		{ label: 'L1', desc: 'blue-chip base layers', color: 'var(--color-sector-l1)' },
		{ label: 'L2', desc: 'scaling networks', color: 'var(--color-sector-l2)' },
		{ label: 'DeFi', desc: 'protocols & yield', color: 'var(--color-sector-defi)' },
		{ label: 'Meme', desc: 'high-volatility culture coins', color: 'var(--color-sector-meme)' },
		{ label: 'Wildcard', desc: 'any token allowed', color: 'var(--color-sector-wildcard)' }
	];

	const FLOW = [
		{ step: 'Connect a wallet', desc: 'Sign a message to prove it\'s yours. No email, no password.' },
		{ step: 'See live market data', desc: 'Sector moves and token prices, pulled fresh, no manual updates.' },
		{ step: 'Draft 5 tokens', desc: 'One per sector. Prices lock the moment you submit.' },
		{ step: 'Get matched', desc: '1v1, a tournament bracket, or a wager — same draft either way.' },
		{ step: 'Watch the race', desc: 'A live chart tracks every pick until time runs out.' },
		{ step: 'Contest settles itself', desc: 'No one has to click resolve — it happens on its own, checked either by a scheduled sweep or the next time anyone loads the site.' },
		{ step: 'Earn XP, badges, and quiz rewards', desc: 'Some badges are on-chain — you claim those yourself, from your own wallet.' }
	];

	const BUILT = [
		{
			id: 'core-loop',
			title: 'Core loop',
			sub: 'Connect, draft, resolve, learn why.',
			features: [
				{ name: 'Wallet-only login', desc: 'Works with EVM or Solana wallets. No password, ever.' },
				{ name: 'Live market data', desc: 'Sector performance and whale-flow alerts on the dashboard.' },
				{ name: '5-token draft', desc: 'Prices lock the instant you submit your lineup.' },
				{ name: 'Self-resolving contests', desc: 'Scores itself against real price movement — never settles early, never guesses a missing price.' },
				{ name: 'Live race view', desc: 'Every token in a match gets its own color on the chart, so picks never blur together.' }
			]
		},
		{
			id: 'compete',
			title: 'Compete',
			sub: 'Real opponents, real formats, real stakes.',
			features: [
				{ name: 'Matchmaking', desc: 'Queued 1v1 against real players only — never a bot.' },
				{ name: 'Tournaments', desc: 'Public or invite-only. Brackets, a closing time, a minimum player count.' },
				{ name: 'Wager mode', desc: 'Both players pick a stake; it settles at whichever is lower, so raising never costs you more than your own number.' },
				{ name: 'Weekly contests', desc: 'A slower 7-day format that pays double XP.' },
				{ name: 'Private leagues', desc: 'Create one, share a code, standings update on their own.' },
				{ name: 'Leaderboard', desc: 'Ranked by total XP, top 3 get a medal.' }
			]
		},
		{
			id: 'learn',
			title: 'Learn',
			sub: 'AI that sees the same live data you do.',
			features: [
				{ name: 'AI Mentor', desc: 'Ask it a question before you draft — it answers from live data, not guesses.' },
				{ name: 'AI Draft Agent', desc: 'Fills a slot or your whole lineup for an XP fee. Picks vary between players so two opponents don\'t get the same answer.' },
				{ name: 'AI match summary', desc: 'A short explanation of what actually happened after every game.' },
				{ name: 'Daily Gauntlet', desc: 'One AI-written question a day — sometimes about the market, sometimes a vocab term.' },
				{ name: 'Word of the Day', desc: 'A crypto term + quiz on the Knowledge Base page, pulled from the same question bank the Gauntlet uses.' }
			]
		},
		{
			id: 'engagement',
			title: 'Engagement',
			sub: 'Everything on top of the core loop.',
			features: [
				{ name: 'Scrimmage', desc: 'Practice against a real bot lineup — no stakes, tracked separately.' },
				{ name: 'Badges', desc: 'Earned automatically for streaks, wins, and milestones.' },
				{ name: 'Share cards', desc: 'A ready-to-post image after a real win or loss.' }
			]
		}
	];

	const ZG_INTEGRATION = [
		{
			layer: '0G Compute — runs the AI',
			status: 'Live · testnet',
			desc: 'Every AI feature — Mentor, match summaries, the Draft Agent, and the daily quiz — can run on 0G instead of a normal AI provider, checked with a simple on/off switch. Each AI Draft Agent use leaves a receipt you can verify.'
		},
		{
			layer: '0G Storage — keeps a permanent copy',
			status: 'Live · testnet',
			desc: 'The AI-written quiz questions are saved permanently on 0G, not just in our own database — confirmed with a real, checkable upload.'
		},
		{
			layer: '0G Chain — holds the badges',
			status: 'Live · testnet',
			desc: 'Achievement badges live on 0G as digital collectibles you claim yourself, from your own wallet — not something we hand you. New badge types can be added any time without touching the contract.'
		}
	];

	const NEXT = [
		{ name: 'Real-money wagers', desc: 'Wagers work end to end right now, using in-game points. Real money is the next step, on the same system.' },
		{ name: 'More badges', desc: 'Four exist today. Adding more doesn\'t need new code — just deciding what to add.' },
		{ name: 'Fair tiebreaks in tournaments', desc: 'Right now a tie is broken arbitrarily. Needs a real rule.' },
		{ name: 'Spending limits', desc: 'Daily caps and cooldowns, planned for once real money is involved.' }
	];

	const ARCH_ROWS = [
		{ concern: 'Login', approach: 'A signed cookie that can\'t be faked or edited. Expires after 7 days automatically.' },
		{ concern: 'AI', approach: 'One switch decides whether 0G or a backup provider answers — the rest of the app never knows the difference.' },
		{ concern: 'Contest settling', approach: 'Checked automatically in the background, and again on the real end time — never early, never with a missing price.' },
		{ concern: 'Matchmaking', approach: 'Saved to the database, not memory — a server restart never loses your place in the queue.' },
		{ concern: 'Prices', approach: 'One request covers the whole token list, not one request per token.' },
		{ concern: 'Badges', approach: 'We sign off that you earned it; you mint it yourself. We can never mint it for you.' },
		{ concern: 'Look & feel', approach: 'One shared style file — change a color once, it updates everywhere.' }
	];

	const STACK_ROWS = [
		{ layer: 'Framework', choice: 'SvelteKit' },
		{ layer: 'Styling', choice: 'Tailwind v4' },
		{ layer: 'Database', choice: 'Postgres (Supabase)' },
		{ layer: 'Login', choice: 'Reown AppKit — EVM + Solana wallets' },
		{ layer: 'AI', choice: '0G Compute (primary), Groq (backup)' },
		{ layer: 'On-chain badges', choice: '0G Chain' },
		{ layer: 'Permanent records', choice: '0G Storage' },
		{ layer: 'Market data', choice: 'SoSoValue + Binance' },
		{ layer: 'Hosting', choice: 'Vercel' }
	];

	const LIMITATIONS = [
		{ name: 'Wagers use points, not money', desc: 'Fully working, just not real cash yet.' },
		{ name: 'Badge claiming needs an EVM wallet', desc: 'Solana-only accounts can\'t claim one yet.' },
		{ name: 'Tournament ties', desc: 'Broken arbitrarily for now.' },
		{ name: 'Mobile', desc: 'Built to work down to small screens, not yet checked on every real device.' }
	];

	const NAV = [
		{ label: 'Overview', href: '#overview' },
		{ label: 'Sectors', href: '#sectors' },
		{ label: 'How It Works', href: '#flow' },
		{ label: 'Core Loop', href: '#core-loop' },
		{ label: 'Compete', href: '#compete' },
		{ label: 'Learn', href: '#learn' },
		{ label: 'Engagement', href: '#engagement' },
		{ label: '0G Integration', href: '#0g' },
		{ label: 'Architecture', href: '#architecture' },
		{ label: 'Technical Flows', href: '#flows', sub: true },
		{ label: 'Tech Stack', href: '#stack' },
		{ label: "What's Next", href: '#next' },
		{ label: 'Known Limitations', href: '#limitations' }
	];
</script>

<div
	class="mx-auto grid max-w-[1180px] grid-cols-[210px_1fr] gap-12 px-7 pt-7 pb-18 max-[860px]:grid-cols-1 max-[860px]:gap-6"
>
	<aside class="max-[860px]:hidden">
		<div class="sticky top-16 flex flex-col gap-0.5 border-l border-border pl-3">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class="rounded py-1.5 no-underline transition hover:bg-hover hover:text-text {item.sub
						? 'pr-2 pl-5 text-[13px] font-medium text-text-muted'
						: 'px-2 text-sm font-medium text-text-secondary'}">{item.label}</a
				>
			{/each}
		</div>
	</aside>

	<main class="flex min-w-0 flex-col gap-10 pb-16">
		<div class="border-b border-border pb-7">
			<span class="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest text-primary uppercase">
				<span class="h-1.5 w-1.5 rounded-full bg-primary"></span>Documentation
			</span>
			<h1 class="mt-3 text-[34px] leading-tight font-black tracking-tight text-text max-sm:text-[28px]">
				CoinDraft, end to end
			</h1>
			<p class="mt-2 max-w-xl text-[15px] text-text-secondary">
				Connect a wallet, draft 5 tokens, compete against real price moves, earn XP and badges — some of
				it running on 0G. This page is the full reference; for a walkthrough of the app itself see the
				<a href="/guide" class="text-primary hover:underline">How to Use Guide</a>.
			</p>
		</div>

		<section id="overview" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">Overview</h2>
			<p class="mt-1 mb-4 text-sm text-text-muted">Wallet-only identity. No email, no password, ever.</p>

			<div class="grid grid-cols-4 gap-3 max-sm:grid-cols-2">
				<div class="rounded-[20px] border border-border bg-surface p-4">
					<span class="block font-mono text-2xl font-bold text-text">5</span>
					<span class="text-[11px] font-bold tracking-wide text-text-muted uppercase">Draft slots</span>
				</div>
				<div class="rounded-[20px] border border-border bg-surface p-4">
					<span class="block font-mono text-2xl font-bold text-text">3</span>
					<span class="text-[11px] font-bold tracking-wide text-text-muted uppercase">0G layers used</span>
				</div>
				<div class="rounded-[20px] border border-border bg-surface p-4">
					<span class="block font-mono text-2xl font-bold text-text">3+</span>
					<span class="text-[11px] font-bold tracking-wide text-text-muted uppercase">Players/lobby</span>
				</div>
				<div class="rounded-[20px] border border-border bg-surface p-4">
					<span class="block font-mono text-2xl font-bold text-text">4</span>
					<span class="text-[11px] font-bold tracking-wide text-text-muted uppercase">On-chain badges</span>
				</div>
			</div>
		</section>

		<section id="sectors" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">Draft sectors</h2>
			<p class="mt-1 mb-4 text-sm text-text-muted">Every lineup fills exactly one slot per sector.</p>
			<div class="flex flex-wrap gap-2">
				{#each SECTORS_LEGEND as s (s.label)}
					<span
						class="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-text"
					>
						<span class="h-2 w-2 rounded-full" style="background: {s.color}"></span>
						{s.label} — {s.desc}
					</span>
				{/each}
			</div>
		</section>

		<section id="flow" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">How it works</h2>
			<p class="mt-1 mb-4 text-sm text-text-muted">Start to finish, in order.</p>
			<div class="flex flex-col gap-2.5">
				{#each FLOW as f, i (f.step)}
					<div class="flex items-start gap-3 rounded-[20px] border border-border bg-surface px-4 py-3.5">
						<span class="mt-0.5 shrink-0 font-mono text-sm font-bold text-primary">{i + 1}</span>
						<div>
							<h4 class="text-[15px] font-bold text-text">{f.step}</h4>
							<p class="mt-1 text-[13.5px] text-text-secondary">{f.desc}</p>
						</div>
					</div>
				{/each}
			</div>
			<div class="mt-5 overflow-x-auto rounded-[20px] border border-border bg-white p-5">
				<img src={userFlowDiagram} alt="User flow — landing through wallet connect, mode choice, draft, race, result and badge claim" class="mx-auto block h-auto max-w-full" />
			</div>
		</section>

		{#each BUILT as group (group.id)}
			<section id={group.id} class="scroll-mt-16">
				<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">{group.title}</h2>
				<p class="mt-1 mb-4 text-sm text-text-muted">{group.sub}</p>
				<div class="flex flex-col gap-2.5">
					{#each group.features as f (f.name)}
						<div
							class="flex items-start justify-between gap-3 rounded-[20px] border border-border bg-surface px-4 py-3.5"
						>
							<div>
								<h4 class="text-[15px] font-bold text-text">{f.name}</h4>
								<p class="mt-1 text-[13.5px] text-text-secondary">{f.desc}</p>
							</div>
							<span class="shrink-0 rounded-full bg-positive/15 px-2.5 py-1 text-[10px] font-bold tracking-wide text-positive uppercase"
								>Shipped</span
							>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<section id="0g" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">0G integration</h2>
			<p class="mt-1 mb-4 text-sm text-text-muted">
				Everything below was checked against the live network directly — not assumed from docs.
			</p>
			<div class="flex flex-col gap-2.5">
				{#each ZG_INTEGRATION as z (z.layer)}
					<div class="rounded-[20px] border border-border bg-surface px-4 py-3.5">
						<div class="flex items-center justify-between gap-3">
							<h4 class="text-[15px] font-bold text-text">{z.layer}</h4>
							<span class="shrink-0 rounded-full bg-positive/15 px-2.5 py-1 text-[10px] font-bold tracking-wide text-positive uppercase"
								>{z.status}</span
							>
						</div>
						<p class="mt-1.5 text-[13.5px] text-text-secondary">{z.desc}</p>
					</div>
				{/each}
			</div>
		</section>


		<section id="architecture" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">Architecture</h2>
			<div class="mt-3 mb-5 grid grid-cols-[1.35fr_1fr] gap-7 max-[720px]:grid-cols-1 max-[720px]:gap-4">
				<div>
					<p class="m-0 text-[15.5px] leading-[1.7] text-text-body">
						Two paths leave the browser. Everything game-related — drafting, matchmaking, scoring,
						settlement — goes through the SvelteKit server, which owns all state in Postgres and talks
						outward to market data and 0G Compute.
					</p>
					<p class="mt-3.5 mb-0 text-[15.5px] leading-[1.7] text-text-body">
						The badge claim deliberately does not. The server signs a voucher off-chain and hands it back;
						the player's own wallet sends the transaction straight to 0G Chain and pays its own gas. That
						split is the point — a badge is something the player provably did, not something we minted on
						their behalf.
					</p>
				</div>
				<div class="rounded-[18px] border border-border bg-surface p-5">
					<div class="mb-3 text-[10.5px] font-bold tracking-wide text-text-muted uppercase">At a glance</div>
					<p class="mt-0 mb-3 text-[12.5px] leading-[1.5] text-text-muted">
						Diagram below follows the <a href="https://c4model.com/" target="_blank" rel="noopener noreferrer" class="font-bold text-primary-ink hover:underline">C4 model</a> — level 2, containers.
					</p>
					<dl class="m-0 flex flex-col gap-3">
						<div>
							<dt class="text-[13px] font-extrabold text-text">State</dt>
							<dd class="m-0 text-[13px] leading-[1.5] text-text-secondary">One Postgres database. No queue, no cache server.</dd>
						</div>
						<div>
							<dt class="text-[13px] font-extrabold text-text">Rendering</dt>
							<dd class="m-0 text-[13px] leading-[1.5] text-text-secondary">Client-side; the server is API routes only.</dd>
						</div>
						<div>
							<dt class="text-[13px] font-extrabold text-text">Resolution</dt>
							<dd class="m-0 text-[13px] leading-[1.5] text-text-secondary">Triggered by any incoming request, plus a daily cron.</dd>
						</div>
						<div>
							<dt class="text-[13px] font-extrabold text-text">On-chain</dt>
							<dd class="m-0 text-[13px] leading-[1.5] text-text-secondary">Only the badge claim, and it's wallet-initiated.</dd>
						</div>
					</dl>
				</div>
			</div>
			<div class="mb-5 overflow-x-auto rounded-[20px] border border-border bg-white p-5">
				<img src={architectureDiagram} alt="System architecture — the browser's two outbound paths, the server's dependencies, and the direct wallet-to-chain badge claim" class="mx-auto block h-auto max-w-full" />
			</div>
			<div class="overflow-x-auto rounded-[20px] border border-border">
				<table class="w-full min-w-[480px] border-collapse text-[13.5px]">
					<thead>
						<tr class="bg-surface-raised">
							<th class="px-3.5 py-2.5 text-left text-[10.5px] font-bold tracking-wide text-text-muted uppercase"
								>Part</th
							>
							<th class="px-3.5 py-2.5 text-left text-[10.5px] font-bold tracking-wide text-text-muted uppercase"
								>How it works</th
							>
						</tr>
					</thead>
					<tbody>
						{#each ARCH_ROWS as row (row.concern)}
							<tr class="border-t border-border">
								<td class="px-3.5 py-3 font-semibold whitespace-nowrap text-text">{row.concern}</td>
								<td class="px-3.5 py-3 text-text-secondary">{row.approach}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div id="flows" class="mt-10 scroll-mt-16 border-t border-border pt-8">
				<h3 class="text-[18px] font-black tracking-[-0.02em] text-text">Technical flows</h3>
				<p class="mt-1.5 mb-6 text-sm text-text-muted">
					The three paths through that architecture worth tracing end to end.
				</p>
				<div class="flex flex-col gap-8">
					{#each TECHNICAL_FLOWS as f (f.id)}
						<div id={f.id} class="scroll-mt-16">
							<div class="mb-4 border-l-2 border-primary pl-4">
								<h4 class="text-[16px] font-extrabold tracking-[-0.01em] text-text">{f.title}</h4>
								<p class="mt-2 mb-0 text-[15px] leading-[1.7] text-text-body">{f.lead}</p>
							</div>
							<div class="overflow-x-auto rounded-[20px] border border-border bg-white p-5">
								<img src={f.src} alt={`${f.title} — ${f.lead}`} class="mx-auto block h-auto max-w-full" />
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>


		<section id="stack" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">Tech stack</h2>
			<div class="mt-4 overflow-x-auto rounded-[20px] border border-border">
				<table class="w-full min-w-[380px] border-collapse text-[13.5px]">
					<thead>
						<tr class="bg-surface-raised">
							<th class="px-3.5 py-2.5 text-left text-[10.5px] font-bold tracking-wide text-text-muted uppercase"
								>Layer</th
							>
							<th class="px-3.5 py-2.5 text-left text-[10.5px] font-bold tracking-wide text-text-muted uppercase"
								>Choice</th
							>
						</tr>
					</thead>
					<tbody>
						{#each STACK_ROWS as row (row.layer)}
							<tr class="border-t border-border">
								<td class="px-3.5 py-3 font-semibold whitespace-nowrap text-text">{row.layer}</td>
								<td class="px-3.5 py-3 text-text-secondary">{row.choice}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>


		<section id="next" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">What's next</h2>
			<p class="mt-1 mb-4 text-sm text-text-muted">In order.</p>
			<div class="flex flex-col gap-2.5">
				{#each NEXT as n, i (n.name)}
					<div class="flex items-start gap-3 rounded-[20px] border border-border bg-surface px-4 py-3.5">
						<span class="mt-0.5 shrink-0 font-mono text-sm font-bold text-primary">{i + 1}</span>
						<div>
							<h4 class="text-[15px] font-bold text-text">{n.name}</h4>
							<p class="mt-1 text-[13.5px] text-text-secondary">{n.desc}</p>
						</div>
					</div>
				{/each}
			</div>
		</section>
		<section id="limitations" class="scroll-mt-16">
			<h2 class="flex items-center gap-2.5 text-[22px] font-black tracking-[-0.02em] text-text before:h-2 before:w-2 before:rounded-full before:bg-primary">Known limitations</h2>
			<div class="mt-4 flex flex-col gap-2.5">
				{#each LIMITATIONS as l (l.name)}
					<div class="rounded-[20px] border border-border bg-surface px-4 py-3.5">
						<h4 class="text-[15px] font-bold text-text">{l.name}</h4>
						<p class="mt-1 text-[13.5px] text-text-secondary">{l.desc}</p>
					</div>
				{/each}
			</div>
		</section>

		<footer class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-5 text-xs text-text-muted">
			<span>CoinDraft Documentation</span>
			<a href="/guide" class="text-text-muted no-underline hover:text-primary">How to Use Guide →</a>
		</footer>
	</main>
</div>
