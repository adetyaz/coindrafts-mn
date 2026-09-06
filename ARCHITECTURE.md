# CoinDraft — Architecture

A technical overview for reviewers. Everything below reflects the current, working state of the repo — not the original plan (see `README.md` for the product PRD; some of its Wave 2/3 goals shipped differently than originally scoped).

## Stack

- **SvelteKit 5** (runes) — SSR pages + API routes in one repo, TypeScript throughout.
- **Drizzle ORM** over **Postgres** (Supabase) — schema in `src/lib/server/schema.ts`, applied via `drizzle-kit push` (no migration files; direct schema-to-DB sync).
- **Auth**: wallet-only. Reown AppKit for wallet connection (EVM + Solana), SIWE message signing for EVM, ed25519 signature verification for Solana. No passwords, no email. Session is an HMAC-signed cookie (`src/lib/server/auth.ts`) — `createHmac('sha256', SESSION_SECRET)`, compared with `crypto.timingSafeEqual`.
- **Market data**: Binance `/api/v3/ticker/24hr` (batch price + 24h change + volume for the whole draftable pool in one call) + SoSoValue API (sector performance, ETF whale-flow alerts, news).
- **AI**: pluggable backend, see below.

## Core game loop

1. **Draft** (`/draft`) — pick one token per sector (L1, L2, DeFi, Meme, Wildcard). Prices lock the instant a lineup is submitted (`entryPrice` captured from the same batch price map the draft screen itself uses — not a separate fragile per-token call, which used to be the source of silent $0 entry prices under rate-limit pressure).
2. **Match start** — for a real 1v1, the clock (`startAt`/`endAt`) only starts once **both** players have locked a lineup, not on the first submission. For Scrimmage, a bot opponent auto-drafts synchronously the moment the human submits, so both sides are always in place together.
3. **Race** (`/game/[id]`) — a live chart polls `/api/contest/[id]/live` every few seconds, sampling current prices server-side (again from the batch source) and persisting each tick to a `price_samples` table so the line survives a refresh and both players see the same race. Each of the up to 10 tokens in a match (5 per side) gets its own stable color from a fixed palette — colored by individual token, not by sector, so two players who both drafted an L1 pick are still visually distinguishable.
4. **Resolution** — refuses to run before `endAt`; refuses to score if any exit price is missing (an outage used to silently score as "no movement," which is wrong with a wager attached). A request-driven sweep (`hooks.server.ts` + `sweep.ts`) resolves due contests on any incoming request, not just a once-daily cron — needed because contests can now be as short as 10 minutes.

## Modes

- **Single Match** — real-opponent-only matchmaking (`matchmaking_queue` table, survives cold starts), matched on duration + stake tier together.
- **Scrimmage** — same UI/scoring, bot opponent, XP earned goes to a separate `paperXpTotal` so it never touches competitive stats.
- **Multiplayer / Tournament** — a `lobbies` row tagged with `tournamentId`/`tournamentStage` *is* a bracket stage; tournaments and plain multiplayer lobbies share the same underlying primitive rather than two implementations. Tournaments support public browsing and private invite-only access (`tournament_invites` — the invite token is the actual credential, single-use, claimed only after a successful join).
- **Wager** — tier-matched (0/25/50/100/250 XP) + blind commit: either player can privately raise before the game starts, and it settles at the **lower** of the two numbers, so raising can never cost more than your own figure. Settlement sits behind a `SettlementProvider` interface (`src/lib/server/settlement.ts`) with one real implementation today (XP, via Postgres) — the seam exists so a real-money implementation can be swapped in without touching the wager logic above it.
  **Roadmap note:** real-money wager rewards are planned once the escrow question is resolved — a custom 0G Chain escrow contract is the leading candidate (0G's own Payment Layer + an undocumented-but-verified ERC-4337 EntryPoint on both testnet and mainnet make a deposit-once/debit-off-chain pattern possible), pending a decision on custodial vs. fully on-chain holding. See `docs-project/wager-and-money-mode-plan.md` for the full research.

## 0G Integration

The AI backend is fully pluggable (`src/lib/server/aiCompute.ts`):

```
USE_0G_COMPUTE=true  →  0G Compute Router (testnet, model qwen2.5-omni)
USE_0G_COMPUTE=false →  Groq (fallback)
```

Both are called through one function, `createChatCompletion()`, with an identical OpenAI-shaped request/response — call sites never know or care which backend actually answered. This exists because 0G's Router is OpenAI-compatible but not byte-identical to Groq's SDK path (a hardcoded `/openai/v1/...` prefix in `groq-sdk` produces a 404 against 0G's base URL unless routed through the SDK's generic `.post()` with the corrected path — found live, not from documentation).

**Four features currently run on this:**

| Feature | What it does |
|---|---|
| AI Mentor | Live chat grounded in real-time sector/token/news data |
| Post-match breakdown | Short AI analysis of what drove a contest's result |
| AI Draft Agent | Picks tokens on request; costs XP; every use logs a receipt |
| Daily Gauntlet quiz | Generates a fresh quiz question each day instead of a static bank |

**The AI Draft Agent's fairness fix:** two players in the same match asking the agent for help used to get the *exact same* recommendation, since both calls hit the same live data with the same fairly-deterministic model — defeating the point of competing. Fixed by asking the model for its top 3 ranked candidates per sector instead of one, then sampling from that ranking (weighted 55/30/15% toward 1st/2nd/3rd) server-side, so two simultaneous calls diverge.

**The `x_0g_trace` receipt**, attached to every 0G-backed response: `{ billing: {...}, provider: "0x...", request_id: "..." }`. This is a real, signed billing record naming a TEE-attested provider, independently addressable by request id — but 0G's Router exposes no `/attestation` endpoint, so it is **not** a self-verifiable cryptographic proof. UI copy says "verified on 0G," deliberately never "cryptographically proven" — this distinction was checked against the actual API surface, not assumed from docs.

**What's not yet on 0G:**
- **0G Storage** — the write path exists (`pushToStorage()` in `src/lib/server/gauntlet.ts`, intended to record each day's AI-generated quiz content with a real root hash) but hasn't executed yet — the `@0gfoundation/0g-storage-ts-sdk` package isn't installed. A dedicated testnet wallet key is already configured (`ZG_STORAGE_PRIVATE_KEY`) and `ethers` is already available.
- **0G Chain / on-chain escrow** — researched in depth (0G's own Payment Layer contracts and an undocumented ERC-4337 EntryPoint were verified live on both testnet and mainnet via direct bytecode reads), but no contract is deployed by this project. The wager mechanic above settles in XP through the `SettlementProvider` seam specifically so this can be swapped in later without a rewrite.

## Achievement Badges (0G Chain)

`contracts/` — a separate Hardhat project (own `package.json`, not part of the SvelteKit app's dependency tree) holding `CoinDraftAchievements.sol`: a soulbound (non-transferable) ERC-721 badge contract, **claimed by the player themselves**, not pushed to their wallet by the backend.

- The contract **owner** can define new achievement types at any time (`addAchievementType`) — no redeploy needed as the badge catalog grows.
- The backend never mints anything directly. It decides off-chain when a player has earned a type, and signs a **voucher** — a message scoped to `(this contract, that player's address, that typeId)`. The player's own wallet then calls `claimAchievement(typeId, signature)` themselves, paying their own gas; the contract verifies the signature on-chain (`ECDSA.recover`) before minting. One-shot per type per player, enforced on-chain (`hasAchievement`).
- Badges can't be transferred, sold, or approved to anyone once claimed — every path except the initial claim-mint reverts.

Seeded initial catalog (`contracts/scripts/seed-achievements.ts`): first win vs. a real opponent, first win vs. a bot (Scrimmage), a correct Gauntlet quiz answer, and a 5-answer quiz streak.

**App-side wiring, built:**
- `src/lib/server/achievements.ts` — checks off-chain eligibility (queries `contests`/`gauntlet_attempts` directly — no separate tracking columns), checks on-chain `hasAchievement` to avoid re-offering an already-claimed badge, and signs vouchers with the same wallet as `ZG_STORAGE_PRIVATE_KEY` (signing costs nothing, so no separate funded key is needed for this role).
- `GET /api/achievements/eligible`, `POST /api/achievements/claim-voucher` — the two endpoints the UI needs.
- Profile page (`/profile`) — an "Achievements — unclaimed on 0G" card lists what's claimable; clicking Claim fetches the voucher, then sends the transaction directly from the player's connected wallet via `ethers.BrowserProvider` (see `src/lib/evmWallet.ts` for provider access, extracted from the same pattern Nav.svelte already used for SIWE sign-in).

**Known gap:** claiming requires an EVM wallet address — Solana-signed-in users have nothing this contract can mint to. Same limitation already flagged for the escrow idea.

**Status: live on 0G testnet.**
- Contract: [`0xf1aff3eaaf85d61ba6ba61b8f5f9a7c5f7164a8d`](https://chainscan-galileo.0g.ai/address/0xf1aff3eaaf85d61ba6ba61b8f5f9a7c5f7164a8d) (0G Galileo testnet, chain id 16602)
- Signer role set and all 4 achievement types seeded — confirmed on-chain: [`setSigner`](https://chainscan-galileo.0g.ai/tx/0x4ac1c75b1a06f29f6a70adbbfad5af8224397e340b0516b014940bf2e8bc5fbc), 4× `addAchievementType`.
- `ACHIEVEMENTS_CONTRACT_ADDRESS` is set in `.env` — the claim flow is fully live end to end, pending mainnet redeploy.

## Known architectural notes (for reviewers, not hidden)

- The matchmaking queue and wager tables are Postgres-backed (not in-memory), specifically because an earlier in-memory version didn't survive serverless cold starts.
- Session tokens are HMAC-signed and time-boxed (7 days) — an earlier version used a bare base64 encoding with no real signature, forgeable by anyone; this was found and fixed by reading the code, not reported externally.
- The race chart's price series is captured live during the game window, not reconstructed after the fact — scoring itself only ever compares entry vs. exit price, so the mid-game line is a genuine live sample, not a scoring input.
