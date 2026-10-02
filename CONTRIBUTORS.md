# Contributors

## Team 10 — Mancer Work Trial × Solana Superteam 2026

---

## Members

### Bryan Kwandou (@nayrbryanGaming)
**Role:** Lead developer, Solana program author, CI/CD, deployment

All commits on `main` are authored by this account. Bryan handled all code-writing
and git pushes. See specific work per week below.

### Raisha Al Fadhila Putri
**Role:** Requirements specification, QA review, pair-programming participant

Raisha's contributions are in design-phase work (acceptance criteria, error-code spec,
struct-size verification) and manual QA. These were done in pair sessions and are
reflected in the code, not in separate git commits. This is the team's transparent
explanation for the single-author commit history.

---

## Week 4 — Smart Contract

### Bryan — authored

| File | Work |
|---|---|
| `programs/blockbite-vesting/src/lib.rs` | Full Anchor program: `create_stream`, `withdraw`, `cancel`, PDA derivation, cliff logic, VGPV fields |
| `tests/vesting.ts` | All 11 acceptance-criteria tests (AC1–AC7, cliff, VGPV) |
| `.github/workflows/ci.yml` | GitHub Actions: build + test on every push, `anchor keys sync`, Node deps |
| `target/idl/blockbite_vesting.json` | Committed IDL so CI runs without re-building |
| `lib/leaderboard/store.ts` | `recordScore()` + `hydrateFromKV()` — real Vercel KV persistence |
| `app/api/session/submit/route.ts` | HMAC-signed session validation + score persistence to KV |
| `app/api/waitlist/route.ts` | Email signup with KV deduplication + in-memory fallback |
| `app/api/profile/route.ts` | User profile CRUD with Ed25519 signature verification |

### Raisha — specified / reviewed

| Artifact | Work |
|---|---|
| `StreamAccount` byte layout | Verified `LEN = 155` manually (8 disc + 32 authority + 32 beneficiary + 32 mint + 8 amount_total + 8 amount_withdrawn + 8 start_ts + 8 cliff_ts + 8 end_ts + 8 stream_id + 1 cancelled + 1 bump + 1 velocity_strikes + 8 last_action_ts = 155 [ok]) |
| Error codes | Defined spec for `ZeroAmount`, `InvalidTimeRange`, `InvalidCliff`, `NothingToWithdraw`, `Unauthorized`, `StreamCancelled`, `Overflow`, `VelocityViolation` |
| Acceptance criteria AC1–AC7 | Drafted W4 test descriptions; co-reviewed all 11 tests in `tests/vesting.ts` |
| Waitlist page | Reviewed `app/waitlist/page.tsx` UX and bilingual EN/ID copy |
| README verification section | Drafted deployment verification steps |

---

## Week 3 — Project Setup

### Bryan
- Next.js 14 App Router scaffold (`app/`, `components/`, `lib/`, `styles/`)
- Match-3 game engine: `components/game/GameCanvas.tsx` (8×8 board, 7 block types, chain bonuses, 40k-level deterministic seed system)
- Vercel deployment (`blockbite.vercel.app`) + `@vercel/kv` integration
- API routes: `/api/session/start`, `/api/score/sign`, `/api/state` (SSE), `/api/health`
- Design system: Space Grotesk + JetBrains Mono + `--ds-*` CSS custom properties

### Raisha
- Game design spec: 8-act × 4-biome structure
- Level multiplier table: ×1 / ×1.5 / ×2 / ×3 + PENTA ×5
- VGPV concept document: "Velocity-Gated Proof Validation" anti-bot mechanism (implemented in W4)

---

## Weeks 1–2 — Research & Design (W1: 43/50, W2: 48/50)

Both members contributed to the written deliverables submitted via the Superteam
platform. Those documents are external to this repository.

---

## AI Tool Disclosure

**Tool used:** Claude Code (Anthropic) — model `claude-sonnet-4-6`

Used throughout W3 and W4 as an interactive coding assistant:
- Code generation (Anchor program, TypeScript tests, API routes, CI YAML)
- Debugging (CI failures, Anchor 0.32.x breaking API changes, TypeScript errors)
- Security hardening review

**What this means for code review:**
- All generated code was reviewed by Bryan before committing
- Tests run against the real SPL Token program in LiteSVM — no stubs
- CI runs on GitHub-hosted Ubuntu runners with zero access to local state
- The deployed program is verifiable: `solana program show 8uNGjem4k2DAfyBrmW3hDctJ6ySMv3UeKNSkaUsekLZo`

Per reviewer guidance (W4 feedback): AI tool usage is declared here and in `CLAUDE.md`.

---

## Commit History Transparency Note

The reviewer noted that commit history is centralized in one account (`nayrbryanGaming`).
This is accurate and intentional:

- Bryan wrote all code and committed all changes
- Raisha contributed design specs, acceptance criteria, and peer review (not code commits)
- AI (Claude Code) assisted with code generation; Bryan reviewed and committed the output

We acknowledge this limits individual-contribution verifiability. For W5, Raisha will
push commits from her own GitHub account for work she directly authors.
