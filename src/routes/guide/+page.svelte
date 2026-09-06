<script lang="ts">
	interface StepItem {
		num: number;
		title: string;
		body: string;
		callout?: { type: 'accent' | 'positive'; text: string };
		paths?: { label: string; title: string; body: string }[];
	}

	const STEPS: { group: string; groupSub: string; items: StepItem[] }[] = [
		{
			group: 'Getting in',
			groupSub: 'No email, no password — your wallet is your account.',
			items: [
				{
					num: 1,
					title: 'Connect your wallet',
					body: "Open the app and connect Phantom, MetaMask, or any supported EVM/Solana wallet. You'll be asked to sign a message — this proves you own the wallet, it doesn't cost gas or move funds.",
					callout: { type: 'accent', text: 'You land on the Dashboard, signed in' }
				},
				{
					num: 2,
					title: 'Read the room before you draft',
					body: 'The Dashboard shows Sector Wars (24h performance by sector), Whale Watch (institutional ETF flow alerts), and Hot Tokens — check these before locking a lineup, not after.'
				},
				{
					num: 3,
					title: "Answer today's Gauntlet question",
					body: 'One multiple-choice question a day, generated from live market data. Answer correctly for XP and a 24-hour boost on that sector — it shows as a badge on the matching draft slot.',
					callout: { type: 'positive', text: '+XP and a sector boost, once per day' }
				}
			]
		},
		{
			group: 'Playing',
			groupSub: 'Every contest starts the same way — five picks, one per slot.',
			items: [
				{
					num: 4,
					title: 'Pick your five',
					body: 'Fill each slot with one token: L1, L2, DeFi, Meme, Wildcard. Prices lock the moment you submit — that’s your entry price for scoring.'
				},
				{
					num: 5,
					title: 'Choose how you’re competing',
					body: 'From the Dashboard, pick a format before you draft.',
					paths: [
						{
							label: 'Head-to-head',
							title: 'Find Match',
							body: 'Queues you against another live player — real opponents only, no bots. No one around? A "Try Scrimmage instead" option appears while the search keeps running in the background.'
						},
						{
							label: 'Group play',
							title: 'Tournament',
							body: 'Join by invite (private) or browse public tournaments and join before the registration window closes. Brackets run qualifier rounds into a final; free-to-play or real stakes.'
						},
						{
							label: 'Contest length',
							title: 'Daily vs. Weekly',
							body: 'Daily resolves in 24 hours. Weekly runs a full 7 days and pays 2× XP — same draft screen, longer clock.'
						},
						{
							label: 'Zero risk',
							title: 'Scrimmage',
							body: "Same UI, same scoring, a bot opponent — draft against bots and earn XP, without touching your real rank. Built for learning the scoring system first."
						}
					]
				},
				{
					num: 6,
					title: "Ask the Mentor if you're unsure",
					body: 'Open Mentor and ask something like "Should I pick ETH or SOL right now?" — you’ll get a streamed answer grounded in the same live data the Dashboard shows. Any token it mentions is a tap-through straight into your draft, highlighted and ready to add.'
				}
			]
		},
		{
			group: 'After the draft',
			groupSub: "Contest resolves on its own — you don't have to do anything to close it out.",
			items: [
				{
					num: 7,
					title: 'Let the clock run',
					body: 'Contests resolve automatically once their window ends — daily at 24 hours, weekly at 7 days, lobbies once full or timed out. No need to check back at an exact moment.'
				},
				{
					num: 8,
					title: 'Read the result',
					body: 'The Result page shows your score against the field, a per-pick breakdown, and a short AI-generated explanation of what actually moved the outcome. Real contests unlock Share Result — a shareable card for X/Twitter.',
					callout: { type: 'positive', text: 'New badge? You’ll see the unlock toast right here' }
				},
				{
					num: 9,
					title: 'Check your standing',
					body: "The Leaderboard ranks everyone globally by XP. If you're in a League — create one and share the invite code with friends — standings there update the same way."
				},
				{
					num: 10,
					title: "Read for a boost, on the days you'd rather not draft",
					body: 'The Knowledge Base is sector-tagged news pulled live. Read one article a day for XP and a 24-hour boost — same mechanic as the Gauntlet, different input.'
				}
			]
		}
	];

	const FAQ = [
		{
			q: 'What happens if my opponent never drafts?',
			a: 'The contest stays open until both sides submit a lineup — nothing resolves against half a matchup.'
		},
		{
			q: 'Is there a dark mode?',
			a: 'Not currently — CoinDraft ships with a single light theme.'
		},
		{
			q: 'Does Scrimmage XP count toward my rank?',
			a: 'No — it earns its own separate Scrimmage XP, never your real rank. Clearly labeled throughout — draft header, contest list, and result page — specifically so it never gets confused with a real result.'
		},
		{
			q: 'How many badges are there right now?',
			a: 'Six: First Blood (first win), On Fire and Unstoppable (3- and 5-win streaks), Veteran and Champion (10 and 25 total wins), and League Founder.'
		}
	];

</script>

<div class="mx-auto flex max-w-2xl flex-col gap-3">
	<section class="rounded-[20px] border border-border bg-surface px-5 py-6">
		<span class="inline-flex items-center gap-2 text-[11px] font-bold tracking-widest text-primary uppercase">
			<span class="h-1.5 w-1.5 rounded-full bg-primary"></span>Guide
		</span>
		<h1 class="mt-3 text-[32px] leading-tight font-black tracking-tight text-text">How to play CoinDraft</h1>
		<p class="mt-2 max-w-md text-[15px] text-text-secondary">
			Draft a 5-token lineup, compete against real price movement, and climb the leaderboard. This walks
			through every screen in the order you'll actually hit them.
		</p>
		<div class="mt-5 flex flex-wrap gap-2">
			<a
				href="/dashboard"
				class="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-bold text-text no-underline transition hover:bg-primary-hover"
				>Open the app →</a
			>
			<a
				href="/docs"
				class="inline-flex h-10 items-center rounded-full border border-border px-5 text-sm font-medium text-text-secondary no-underline transition hover:bg-hover"
				>Full documentation</a
			>
		</div>
	</section>

	{#each STEPS as group (group.group)}
		<section class="rounded-[20px] border border-border bg-surface px-5 py-5">
			<div class="mb-1">
				<span class="text-[11px] font-bold tracking-widest text-primary uppercase">{group.group}</span>
				<p class="mt-1 text-xs text-text-muted">{group.groupSub}</p>
			</div>
			<div class="mt-3 flex flex-col divide-y divide-border">
				{#each group.items as item (item.title)}
					<div class="grid grid-cols-[36px_1fr] gap-3 py-4 first:pt-0 last:pb-0">
						<div class="font-mono text-lg font-black text-primary">
							{String(item.num).padStart(2, '0')}
						</div>
						<div>
							<h3 class="text-[15px] font-bold text-text">{item.title}</h3>
							<p class="mt-1.5 text-sm text-text-secondary">{item.body}</p>
							{#if item.callout}
								<span
									class="mt-2.5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold {item.callout.type ===
									'positive'
										? 'bg-positive/15 text-positive'
										: 'bg-primary-muted text-primary'}"
								>
									<span
										class="h-1.5 w-1.5 shrink-0 rounded-full {item.callout.type === 'positive'
											? 'bg-positive'
											: 'bg-primary'}"
									></span>
									{item.callout.text}
								</span>
							{/if}
							{#if item.paths}
								<div class="mt-3 grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
									{#each item.paths as p (p.title)}
										<div class="rounded-lg border border-border bg-surface-raised p-3.5">
											<span class="text-[10px] font-bold tracking-widest text-primary uppercase"
												>{p.label}</span
											>
											<h4 class="mt-1 text-sm font-bold text-text">{p.title}</h4>
											<p class="mt-1 text-[13px] text-text-secondary">{p.body}</p>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}

	<section class="rounded-[20px] border border-border bg-surface px-5 py-5">
		<span class="text-[11px] font-bold tracking-widest text-primary uppercase">Reference</span>
		<h2 class="mt-1 mb-2 text-lg font-black text-text">Common questions</h2>
		<div class="flex flex-col divide-y divide-border">
			{#each FAQ as item (item.q)}
				<div class="py-3.5 first:pt-0 last:pb-0">
					<h4 class="text-[14.5px] font-bold text-text">{item.q}</h4>
					<p class="mt-1 text-sm text-text-secondary">{item.a}</p>
				</div>
			{/each}
		</div>
	</section>

	<footer class="flex flex-wrap items-center justify-between gap-2 px-1 py-4 text-xs text-text-muted">
		<span>CoinDraft · How to Use Guide</span>
		<a href="/docs" class="text-text-muted no-underline hover:text-primary">Full documentation →</a>
	</footer>
</div>
