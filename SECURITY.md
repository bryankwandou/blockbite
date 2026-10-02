# Security Policy

## Status

| Component | Network | Notes |
|---|---|---|
| `blockbite-prize` (Pinocchio) | Solana mainnet | Program ID `4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn`, live since 2026-10-02 |
| `blockbite-vesting` (Pinocchio) | Not deployed | Kept in `programs/blockbite-vesting`; not used by the site |

- **Not independently audited.** The prize program is covered by 20 LiteSVM
  tests (`programs/blockbite-prize/tests/`) and an internal review
  (`lib/ranked/AUDIT.md`), but has had no third-party audit.
  Only spend what you can afford to lose.
- **Upgradeable.** The upgrade authority is a single deployer key held by the
  BlockBite team. It is not a multisig and not immutable.
- Prizes are claimed by the winners themselves with a merkle proof after a
  24-hour veto window; the server can post results but cannot move funds.
- Ranked ticket sales are closed (`RANKED_SALES_OPEN = false`).
- Rate limiting (`lib/rate-limit.ts`) is active on the auth, session, score,
  challenge, profile, achievement-sync and redeem API routes.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: nayrbryangaming3@gmail.com
We aim to acknowledge within 48 hours and triage within 7 days.

Please include a description, steps to reproduce, impact, and (optionally) a fix.
Reports are handled confidentially.

There is no paid bug bounty program at this time.

## Scope

In scope: the prize program (`programs/blockbite-prize/`), API routes
(`app/api/`), session, account-recovery and passkey logic (`lib/auth/`), ranked
seeds and score verification (`lib/ranked/`), partner distribution
(`lib/partner/`) and the leaderboard.

Out of scope: third-party dependencies (report upstream), social engineering,
physical attacks.
