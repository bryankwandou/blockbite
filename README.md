# BlockBite

An 8×8 block puzzle on Solana. **Adventure mode is free** (500,000 levels, no
wallet needed). **Ranked mode** is one board per UTC day, the same pieces for
everyone; the best scores share a USDC prize pool that sits in a small
on-chain program, and winners claim their prize themselves with a merkle proof.

Status: **website live; prize program live on mainnet since 2026-10-02.
Ranked ticket sales are closed** (`RANKED_SALES_OPEN = false` in
`lib/ranked/config.ts`), so no player money is in the vault yet. **Internal
tests only; no independent audit yet.** Earlier versions of this README named
`8uNGjem4k2DAfyBrmW3hDctJ6ySMv3UeKNSkaUsekLZo` as the mainnet program. That
program was never deployed (the address has no account on mainnet); the
vesting code it refers to is still in `programs/blockbite-vesting` but is not
used by the site.

Live site: https://blockbite.vercel.app (same build: https://blockbite-game.vercel.app)

## Mainnet (2026-10-02)

| | Address |
|---|---|
| Prize program | `4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn` (5,496 bytes, SBPF v3, binary SHA-256 `362f584d…a36d7`, identical to a local build of `programs/blockbite-prize`), deployed in slot 452,338,795 |
| Upgrade authority | Deployer key `J4GDuELnfkhUqqQobhZEuzTK2SfpncdE9tXWq77Z1H4D` (single key, not a multisig) |
| Vault authority | PDA `["vault"]` = `5Dpz47x9QHTdbgYWD6KA2tanbKbag7xp4c2NoVEV13DS` |
| Prize vault | USDC token account of the vault PDA: `9Pd853EqvQgNc2t4wAsXmTcynsEj6LWpKQiAbprpMqmj`. Only the program can move funds out |
| Poster | Server hot key `BDpy3zpYyQRvz8bFngN6tCvx2rk6PA1jtsWSo5FfoBgP`: may post results, cannot move funds |
| State | `FQBH9iXq8MqEh1pBcwa7kfEoYTXXyvxKSQgJz56BdBZw` (`createWithSeed(poster, "state", program)`); created with the first round |
| Veto | Team wallet compiled into the program (`VETO` in `programs/blockbite-prize/src/lib.rs`) |

Deploy cost, measured: 0.029682 SOL including fees (program account rent
0.029632 SOL). The `deploy_rent_is_under_0_03_sol` test fails the build if the
program ever grows past that budget.

## What is on-chain and what is not

| Data | Where | Why |
|---|---|---|
| Prize vault, round results (merkle root), claims | Solana program | Money must not depend on the server's honesty |
| Ticket purchases | Plain USDC transfers, verified by the server at `finalized` commitment | No program call needed to pay |
| Scores, levels, achievements, avatars, settings | Postgres / browser | Free for players; writing each of these on-chain would cost a fee per action |
| Ranked boards | Server seed, revealed after the day ends; anyone can replay a run with `scripts/verify-ranked-day.ts` | Same pieces for everyone, checkable afterwards |

## Game modes

| | Adventure (free) | Daily Ranked | Monthly Ranked |
|---|---|---|---|
| Cost | Free, no wallet | 1 USDC per attempt | Comes from Daily attempts |
| Board | 500,000 generated levels: 1,000 acts × 500 levels, 8 map themes repeating, difficulty never repeats | One board per UTC day, same pieces for everyone | — |
| Limits | None | 3 attempts per wallet per UTC day | — |
| Score | Per level; progress shown on the map | Best attempt of the day | Sum of the wallet's 10 best daily scores in the month |
| Prize | None | Top 10 of the day share 40% of that day's vault inflow | Top 10 of the month share the other 60% |

Payout curve for a round's top 10, in percent of the pool:
25 · 18 · 13 · 10 · 8 · 7 · 6 · 5 · 4 · 4.

Per 1 USDC ticket: 0.70 USDC goes straight into the prize vault, 0.05 USDC to
the referrer (if any), the rest to the team.

## Prize program design

`programs/blockbite-prize` (Pinocchio 0.11, no Anchor, `no_std`, four
instructions). It never creates accounts, which keeps it small: the poster
creates the state and each round with `CreateAccountWithSeed` in the same
transaction.

| # | Instruction | What it does |
|---|---|---|
| 0 | `PostResults` | Poster publishes a merkle root of `(index, wallet, amount)` winners for one round. The total may not exceed what the vault holds minus what earlier rounds already promised (`reserved`) |
| 1 | `Veto` | For 24 hours the veto wallet can block a round. Vetoing the latest round of its kind reopens its id so corrected results can be posted |
| 2 | `Claim` | After the veto window, anyone can trigger a payout with a merkle proof. The USDC goes only to a token account owned by the winning wallet |
| 3 | `Close` | After 90 days unclaimed amounts return to the pool and the round account is closed, refunding its rent to the poster |

- Round ids: a day is `YYYYMMDD` (`20261001`), a month is `YYYYMM00`. Ids only
  move forward (one high-water mark for days, one for months), so a round id
  can never be posted twice, even after its account was closed.
- Leaf = `sha256(index u32 ‖ amount u64 ‖ round_id u64 ‖ wallet)` (52 bytes).
  Node = `sha256(0x01 ‖ min(a,b) ‖ max(a,b))` (65 bytes). Different lengths, so
  a leaf can never pass as a node.
- Each round account holds a claimed-bitmap, so every leaf pays once.
- A stolen poster key can post a bad round, but cannot move funds: the veto
  window exists for exactly that case, and claims only pay wallets in the root.

## Measured numbers

| | Value |
|---|---|
| Program binary | 5,496 bytes |
| Program deploy cost | 0.029682 SOL including fees |
| State account | 24 bytes, ~0.00077 SOL rent (once) |
| Round account | 80 + ⌈winners / 8⌉ bytes, ~0.001 SOL rent, refunded on close |
| Winners per round | up to 1,024 (proofs of ≤ 16 hashes) |
| Prize program tests (LiteSVM) | 20/20 pass, each asserts the exact error code |

## Accounts and recovery

A player's identity is their Solana wallet. Recovery methods restore the
**game profile** (scores, avatar, achievements), never wallet funds or keys.

| Method | Notes |
|---|---|
| Passkey (fingerprint / face) | WebAuthn ES256 and RS256, verified server-side (`lib/auth/webauthn.ts`): challenge, origin, rpId hash, user-presence flag, sign-count replay check. 10 failures per hour lock it |
| Recovery codes | 10 one-time codes, stored as scrypt hashes |
| Email + password | scrypt, rate limited |
| Google | Only shown when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` are set |

Binding any method needs a fresh wallet signature of a plain-text message (not
a transaction). A passkey only works on the domain it was created on;
`WEBAUTHN_ORIGIN` takes a comma-separated list of the site's domains.

## Partner token distribution

`/partner` lets a project that wants to give its token to players create a
campaign, deposit tokens, and watch allocated, paid and remaining amounts,
with a recipients CSV export. Allocations are atomic and can never exceed the
verified deposit; double claims, paused campaigns and expired campaigns are
refused (`lib/partner/`). The player pays the transaction fee for their own
payout; the distributor key (`PARTNER_DISTRIBUTOR_SECRET`) only co-signs, so it
needs no SOL and is never the prize program's key.

## Web app

- **Next.js 14** (App Router), deployed on Vercel. Installable as an app
  (PWA) on Android, iOS, Windows and macOS.
- **Avatars:** 126 ready-made BlockBite avatars plus a modular builder with
  3,686,400 combinations, stored as a short code (e.g. `m1-b03-p11-e07-m04-a15-g02`).
- **Achievements:** 5,300, each with its own generated emblem.
- **Music:** 5 albums, 23 tracks (BlockBite Originals, Rex's Royal Court, Tide
  Pool Tapes, Brawler Arena Mix, Sunny Side Up), synthesized live with Web
  Audio, so no audio files are downloaded. Album and track order are set in
  Settings.
- **Themes:** 12 soft pastel palettes named after the mascots and map regions
  (e.g. Rex Crown Lilac, Tide Seafoam Hush, Verdant Hollow Matcha), plus
  custom themes shared as a short code.
- **Versus:** 1 vs Bot (Rookie, Pro, Master, Legend) and friend challenges on
  the same deal of pieces.
- **Graphics:** Auto, Low, Balanced, High. Auto measures the frame rate after
  the page has loaded and steps down one level at a time.
- **Languages:** 29, including right-to-left Arabic, Hebrew, Persian and Urdu.
- **Admin console** (`/admin`): traffic, errors, money flow and partner
  campaigns; sign-in with a wallet listed in `ADMIN_WALLETS`.

## Environment variables

Copy `.env.local.example` to `.env.local`. Nothing secret is committed.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_RPC_URL` | Public site URL, browser RPC |
| `SESSION_SECRET`, `RANKED_SECRET`, `ACCOUNT_SECRET` | Signing sessions, ranked seeds, account cookies |
| `RANKED_DATABASE_URL`, `RANKED_DB_SCHEMA`, `RANKED_RPC_URL` | Postgres for ranked, accounts, achievements, partners; server RPC |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Rate limits and leaderboard cache (falls back to memory when unset) |
| `ADMIN_TOKEN`, `ADMIN_SECRET`, `ADMIN_SESSION_SECRET`, `ADMIN_WALLETS`, `ADMIN_RPC_URL` | Admin console |
| `WEBAUTHN_ORIGIN` | Passkey domains, comma-separated |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Optional Google sign-in |
| `PARTNER_DISTRIBUTOR_SECRET` | Hot key that sends partner tokens |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Waitlist and partnership leads |

## Build and test

```bash
npm install
npm run dev                      # http://localhost:3000
npm run build && npm start       # production build

# Prize program
cargo build-sbf --arch v3 --manifest-path programs/blockbite-prize/Cargo.toml
cargo test --release --manifest-path programs/blockbite-prize/Cargo.toml

# Off-chain checks
npx tsx scripts/test-prize-math.ts       # payout split and merkle tree vs. the program
RANKED_TEST_DATABASE_URL=… npx tsx scripts/test-ranked.ts   # ranked database paths
npx tsx lib/auth/auth.check.ts           # passkeys, codes, passwords
npx tsx lib/achievements/catalog.check.ts
node scripts/i18n-check.mjs              # every key in all 29 languages
npx tsx scripts/partner-selftest.ts      # partner distribution against a local chain

# Browser tests: Android, low-end Android, iPhone 14, iPhone SE, iPad,
# Windows Chrome, macOS Safari (WebKit), Firefox
npx playwright install chromium webkit firefox
npm run test:e2e
```

Results of the last full run (2026-10-02):

| Suite | Result |
|---|---|
| Prize program (LiteSVM) | 20/20 |
| Partner distribution self-test | 54/54 (27 in-memory, 27 on Postgres) |
| Auth checks | 19/19 |
| Achievements | 5,300 achievements, 5,300 unique emblems |
| Browser suite (8 device profiles) | 171 passed, 12 skipped (Chrome-only checks on other engines); 1 WebKit timeout under load that passed 6/6 on rerun |
| Live passkey test (real Chromium WebAuthn against the deployed site) | 7/7 on each domain |

See [docs/TESTING.md](docs/TESTING.md) for what emulation covers and what
still needs a physical device.

## Before opening ranked sales

1. ~~Prize program deployed under 0.03 SOL~~ done (0.029682 SOL).
2. ~~Program tests for replay, veto, double claim, failed transfer, closed-round reuse~~ done (20 tests).
3. Fund the poster with ~0.002 SOL for the state account and the first round.
4. Independent audit of `programs/blockbite-prize`.
5. Move the upgrade authority from the single deployer key to a multisig, or set it final.
6. Set `RANKED_SALES_OPEN = true`.

## Repository layout

```
app/                      Next.js pages and API routes
components/               UI (game canvas, map, versus, avatar builder, audio)
lib/                      game rules, ranked, auth, partner, achievements, i18n
programs/blockbite-prize  the live prize program (Pinocchio)
programs/blockbite-vesting  vesting program, not deployed
scripts/                  result posting, verification and test scripts
tests/e2e/                Playwright suite
public/                   mascots, icons, manifest, service worker
```

Security reports: see [SECURITY.md](SECURITY.md).
