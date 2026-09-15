# CoinDraft — Midnight Submission

A privacy-preserving age verification feature for CoinDraft, a fantasy-sports-style crypto drafting game. Built on Midnight's commit-reveal privacy model — players prove they're 18+ without their name, birth year, or country ever reaching a server in plaintext.

> The full product (drafting, matchmaking, scoring, leagues) is shared with CoinDraft's other chain submissions — see [What this repo shares vs. adds](#what-this-repo-shares-vs-adds) below. This README covers the Midnight-specific work only.

---

## What this is

CoinDraft gates real-money wagering behind an 18+ check. Every other version of that check — a self-reported checkbox, a wallet-signed attestation — either trusts the player's word or stores their birth date on a server. This one doesn't do either.

`KycAttestation.compact` is a real, compiled, mechanically-verified Compact contract:
- A player submits their name, birth year, and country as **witnesses** — private inputs that never leave their own machine as plaintext.
- The contract computes a cryptographic commitment (`persistentCommit`) over that bundle and writes only the commitment to the public ledger — opaque bytes, not the real data.
- It separately discloses exactly one boolean: `isOver18`, derived by comparing the real (private) birth year against a publicly pinned cutoff year. The comparison happens inside the zero-knowledge proof; only its result crosses the public boundary.

Verified, not just claimed: a real PLONK proof was generated and checked, and the raw public transcript was inspected byte-for-byte to confirm the birth year is structurally absent from it while the public cutoff year is present — proof the inspection method actually works, not just that nothing obviously leaked.

## Architecture

```
Player's browser
  → signs one message with their existing EVM/Solana wallet (no new wallet install)
  → that signature deterministically derives a Midnight identity (HDWallet.fromSeed)
  → player fills in name / birth year / country
  → client builds a real ZK proof, submits submitKyc() to the deployed contract
  → contract writes: a commitment (opaque) + isOver18 (public boolean)

CoinDraft's backend
  → never sees the raw name/birth year/country — not encrypted, not sent, period
  → independently re-reads the real on-chain ledger state via the Midnight indexer
    before trusting an "18+" claim at wager time — never trusts a client-reported boolean
```

Identity is derived from a witness-held secret via a domain-separated hash (`persistentHash(pad(32,"coindraft:kyc:participant:v1"), secretKey)`) — not `ownPublicKey()`, which is prover-supplied and therefore forgeable. This is the same pattern Midnight's own security guidance recommends for exactly this reason.

## Midnight integration — what it actually hides, and what it doesn't

**Hidden:** full name, birth year, country. None of these ever exist outside the player's own browser as plaintext — not in a database, not in a log, not in a network request to CoinDraft's servers.

**Not hidden, by design:** the fact that a submission happened (the commitment is public), and the one derived boolean (`isOver18`). A stable pseudonymous identity (`participantId`) is also public — necessary so the contract can enforce one submission per identity, at the cost of that identity's actions being linkable to each other.

**The honest limitation:** this is self-attested. There's no issuer, no document check — the contract proves "the prover committed to a bundle, and `isOver18` is consistent with the birth year inside it," not that the underlying identity is real. Nothing here manufactures trust in the claim; it only makes the claim non-repudiable and keeps the birth year itself private. Real KYC (identity-verified, not just privacy-preserving) would need a credential issuer — a materially bigger, separate build, out of scope here.

## Setup / reproduction

```bash
npm install
cd contracts/midnight && npm install
```

The contract is already compiled (`contracts/midnight/src/managed/kyc/`) — reproduce from source with:
```bash
cd contracts/midnight
compact compile src/KycAttestation.compact src/managed/kyc
npm test          # 10 tests: commit/reveal correctness, binding, hiding, no-leak transcript scan
```

**Toolchain note:** pinned to Compact compiler `0.31.0` deliberately (not the latest) — it emits `compact-runtime@0.16.0`, matching the only stable (non-prerelease) Midnight deploy SDK. A newer compiler (0.34.0) was tried and produces a real, hard version-incompatibility wall with the deploy SDK. Don't upgrade without also verifying the SDK line supports the new runtime.

To stand up a full local Midnight network (node + indexer + proof server) and deploy fresh:
```bash
docker compose -f <path-to-midnight-local-dev>/standalone.yml up -d
cd contracts/midnight && npm run deploy:local
```

## How to test/evaluate this submission

**Current state, stated plainly:** the contract is deployed and has been exercised end-to-end for real — real proof generation (~28s measured), real submission, real independent on-chain read-back — but currently against a **local devnet**, not yet Midnight's public `preview` testnet. `[TODO before final submission: redeploy to preview testnet and replace this section with the real, publicly-verifiable contract address + a live app URL judges can click through themselves.]`

Until that redeploy, the most concrete way to evaluate this is to reproduce it locally:
1. Follow the setup steps above.
2. Run the full flow rehearsal: `cd contracts/midnight && npm run test:full-flow` — submits a real identity, generates a real proof, and independently re-queries the chain to confirm `isOver18` reads back correctly.
3. In the app itself: `npm run dev`, visit `/profile/kyc`, connect a wallet, submit the form. Watch the real staged progress (identity derivation → funding → proof generation → confirmation) — none of it is simulated.

## What this repo shares vs. adds

Drafting, matchmaking, scoring, leagues, leaderboards — the whole game loop — is shared, chain-agnostic CoinDraft product, synced from the same private hub that also feeds CoinDraft's 0G submission. What's genuinely new and Midnight-specific in this repo: `contracts/midnight/` (the Compact contract and its deploy tooling), `src/lib/midnightWallet.ts` and `src/lib/midnight/` (identity derivation and the client SDK wiring), `src/routes/profile/kyc/` (the submission UI), and the server-side independent verification path in `src/lib/server/midnightKyc.ts`.
