# Ranked prize vault: money-path audit

Date: 2026-10-01. Scope: ticket purchase to prize claim. All amounts are integer
USDC base units (6 decimals, `bigint` in TS, `u64` on-chain).

Line numbers for `programs/blockbite-prize/src/lib.rs` are from the 525-line
version read on 2026-10-01. That file is being resized by another session, so
search by function name (`post`, `veto`, `claim`, `close`) if lines moved.

Tests:
- `T-math` = `npx tsx scripts/test-prize-math.ts` (no database)
- `T-db` = `RANKED_TEST_DATABASE_URL=… npx tsx scripts/test-ranked.ts` (throwaway schema)
- `T-svm` = `cargo test -p blockbite-prize` (LiteSVM against `target/deploy/blockbite_prize.so`)

| # | Money path | Where handled | Test |
|---|---|---|---|
| 1 | Ticket purchase verify: tx exists, succeeded, signed by buyer, only allowed programs | `lib/ranked/purchase-verify.ts:56-75` | T-db "underpaying, skimming…"; T-math "wrong mint…" |
| 1a | Read at `finalized` so a rolled-back block cannot credit tickets | `lib/ranked/purchase-verify.ts:121` (`PURCHASE_COMMITMENT`, config.ts). **Changed today** from `confirmed`. | T-math "splits are whole" asserts the constant |
| 1b | Sales are closed until the program is live | `app/api/ranked/credit/route.ts:18` (`RANKED_SALES_OPEN=false`) | T-db "ticket sales stay closed" |
| 2 | Split 70 / 25 / 5, team 30 without referrer | `purchase-verify.ts:92-108`; constants `config.ts` (`VAULT_SHARE`, `REFERRAL_SHARE`, `TEAM_SHARE`) | T-db "valid purchases…"; T-math "splits are whole" |
| 3 | Rounding / dust | Payouts: floor division `results.ts:77`; dust stays in the vault as `unallocated` (`results.ts:107`). Pools: `dailyPool` floors, the remainder goes to the month (`results.ts:42-51`), so day + month = inflow exactly. Ticket split has no rounding (shares are whole base units). | T-math "sum never exceeds the pool" (20k random boards), "dust", "day + month = inflow" |
| 3a | Sum of payouts never exceeds the pool | Floor math, plus an explicit guard that throws `planRound` `results.ts:106` (**added today**). On-chain: `post` refuses a total above vault minus reserved (`lib.rs:377-380`), `claim` refuses `claimed > total` (`lib.rs:472-475`). | T-math property test; T-svm `cannot_promise_more_than_the_vault_holds` |
| 4 | Double credit of one purchase | `rk_purchases.sig` PRIMARY KEY + `ON CONFLICT (sig) DO NOTHING` in one statement with the credit (`db.ts:103-116`) | T-db "a purchase signature is credited only once" |
| 5 | Replayed tx signature (same sig, other wallet) | Same row as #4: the sig is spent once whoever sends it; and the tx must be signed by the session wallet (`purchase-verify.ts:58`) and every transfer authorised by it (`:71`) | T-db "credited only once", "someone else pays" |
| 6 | Wrong mint | `transferChecked`: mint must be USDC (`purchase-verify.ts:72`). Plain `transfer` to vault/team: those are fixed USDC accounts, so the token program refuses any other mint. Referral: post-tx balance mint must be USDC (`:105`). | T-db "referral paid in another token"; T-math "wrong mint" |
| 7 | Wrong recipient | Only `PRIZE_VAULT`, `TEAM_USDC_ACCOUNT` and at most one referral account (`purchase-verify.ts:88-90`); self-referral refused (`:106`); inner transfers refused (`:84`). Claims: payout goes only to a token account whose owner is the leaf's wallet (`lib.rs:452-456`), vault address pinned (`lib.rs:430`). | T-db "extra recipients"; T-svm `a_proof_cannot_be_redirected_or_inflated`, `claim_cannot_pay_from_vault_to_vault` |
| 8 | Period overlap | Day pool = 40% of that day's inflow, month pool = the other 60% of the same days (`results.ts:42-51`): a base unit is in exactly one pool. Day ids `YYYYMMDD`, month ids `YYYYMM00` never collide. Inflow is counted by credit time `[from, to)` (`db.ts:238-245`), half-open, no day counted twice. A period is only computed after it ends + 10 min (`results.ts:131`). | T-math "round ids never collide", "day + month = inflow"; T-db "periods" |
| 9 | Recompute / different leaves for one round | Round stored once (`db.ts:321-328` `ON CONFLICT DO NOTHING`; `results.ts:170`); proofs rebuilt from stored leaves and checked against stored root and total (`results.ts` `treeOf`); post script stops if on-chain root differs (`scripts/post-results.ts:127`) and refuses if the vault can't cover (`:135`). | T-db "stored once and never recomputed" |
| 10 | Claim twice | Bitmap bit per leaf (`lib.rs:447-450`, set `:477`); a second claim to a different token account of the same wallet also refused | T-svm `claims_open_after_24h_pay_the_winner_once` |
| 11 | Claim after expiry | `now >= posted + CLAIM_WINDOW` → `E_WINDOW` (`lib.rs:440-442`); proof API hides rounds older than 90 days (`app/api/ranked/proof/route.ts:28`) | T-svm `close_returns_rent_and_releases_unclaimed_after_90_days` (claims at day 90 → E_WINDOW) |
| 12 | Unclaimed funds destination | They never leave the vault. `close` after expiry subtracts `total - claimed` from `reserved` (`lib.rs:511-514`), so the USDC becomes free for later rounds. Only rent lamports go to POSTER (`lib.rs:519`). | T-svm `close_returns_rent…` (re-promises the freed USDC) |
| 13 | Veto | Only `VETO` cold key, only within 24 h, releases the whole unclaimed total (`lib.rs:397-413`); claims impossible inside the window (`lib.rs:440`) and after a veto (`lib.rs:436`) | T-svm `veto_only_by_cold_wallet_inside_24h`, `fully_claimed_or_vetoed_rounds_close_early` |
| 14 | Poster key exposure | Key read only from env `PRIZE_POSTER_KEY`, only with `--send`, checked against the pinned poster, never printed (`scripts/post-results.ts:28-43`); dry run by default | T-db "post-results: the dry run prints…" |
| 15 | Leaf format TS vs program | `lib/ranked/merkle.ts` = `lib.rs:456-467` | T-math "leaf bytes match"; T-svm `ts_built_rounds_post_and_claim` (instructions generated by `scripts/prize-fixture.ts`) |
| 16 | Prize pool display counted promised USDC as available | `app/api/prizepool/route.ts` now returns `balance`, `promised` (state `reserved`) and `free`. **Changed today**; `balance` kept for existing callers. | none (needs RPC) |

## NOT HANDLED / residual risk

1. **Re-posting a closed round id.** HANDLED (program change, 2026-10-01). The state account keeps two high-water marks, the last day id (YYYYMMDD) and the last month id (YYYYMM00); `post` refuses any id at or below its mark with `E_EXISTS`, so an id can never come back, even after its round account was closed and deleted. Covered by `tests/prize.rs` `a_round_id_can_be_posted_once` (post, veto, close, re-post → E_EXISTS; an older day id → E_EXISTS; day and month marks move separately). Exception, by design: vetoing the *latest* round of its kind puts the mark back to the value stored in that round (`R_PREV`), so corrected results can be posted under the same id, and a far-future id posted with a stolen POSTER key stops blocking real dates once vetoed (`veto_of_the_latest_round_lets_corrected_results_be_posted`, `a_bogus_far_future_id_is_undone_by_its_veto`). Vetoing an older round never reopens anything. A closed round is left as an empty system account even if someone refunds it in the same transaction (`a_closed_round_cannot_be_kept_as_a_program_account`). Consequence for operations: post rounds in date order, and only after the previous round of the same kind is past its 24 h veto window (`post-results.ts` refuses otherwise). A late day round cannot be posted after a later one, so `post-results.ts` must run day by day without skipping ahead.
2. **POSTER key compromise in general.** A stolen hot key can post any root up to the free vault balance. The only defence is a human watching and vetoing within 24 h. NOT HANDLED: there is no automatic watcher that compares posted roots with `rk_rounds` and alerts the VETO holder. Suggested: a cron script that reads every round account and flags any root not in `rk_rounds`.
3. **Tickets bought but never played / refunds.** No refund path; the 70% stays in the pool by design. Not a leak, but it should be said plainly in player copy.
4. **Rounds with zero winners.** If nobody played a day, its 40% is never paid and is not added to the month either (it stays free in the vault and is spent by future rounds only when a later pool computes from *its own* inflow, which it never does). Result: that USDC is stuck in the vault with no rule that pays it out. NOT HANDLED. Suggested rule: carry unallocated pool forward into the next month's pool (`results.ts` `computeRound`, needs a stored "carried" amount per round).
5. **Unallocated dust and short-board slots** accumulate in the vault under the same issue as #4.
6. **Score integrity (speed-review flags)** is shown to the operator by `post-results.ts`, but flagged wallets are not excluded automatically; a human decides before `--send`.
7. **`scripts/test-ranked.ts` (T-db)** was not run in this session: no `RANKED_TEST_DATABASE_URL` is configured, and pointing it at the shared prod Neon was not acceptable.
