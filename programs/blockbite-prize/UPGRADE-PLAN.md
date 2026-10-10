# blockbite-prize upgrade plan (veto chain fix)

Program `4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn`, programdata `2hfRGirMiVSj2dzN82N6ofhzxuTbmwgbtij8PaSSXyxM`,
upgrade authority `J4GDuELnfkhUqqQobhZEuzTK2SfpncdE9tXWq77Z1H4D`.

**DEPLOYED 2026-10-06** in slot 453898755, tx
`65EyEA3XNAbYn3TUVANYaPHNLTSkwnMaCu2q53C3X8EvvSfNwAC2gazPcbpdRYSy6ZmmbfyXeisKFJBX9m2cjrbA`.
The live bytes equal sha256 `e1cae101…`. The plan below assumed 328 bytes of extension,
but ExtendProgram has a 10,240-byte on-chain minimum, so programdata was extended by
10,240 B (data length now 15,736 B, ~0.052 SOL rent, paid by 42azYT). The buffer
was written by 42azYT and its rent returned to 42azYT on deploy. VETO is still
`ETcQ…` (owner decision, see Go / no-go).

## What changed

Bug: post A, post B, veto A (not latest, so the mark is untouched), veto B → the
mark goes back to B's stored previous mark, which is A. A's id is then used forever
and corrected results can never be posted under it.

Fix (`src/lib.rs`, `veto`): Veto takes an optional 4th account, the live round
posted right after the one being vetoed (the round whose stored `R_PREV` equals
the vetoed id). The veto copies the vetoed round's `R_PREV` into it, unlinking the
vetoed round from the chain. A later veto of that successor then walks the mark
past both ids.

- 3-account Veto behaves exactly as before, so existing scripts keep working, and a
  veto can never be blocked by a missing account.
- The successor must be a program-owned round, not vetoed, with `R_PREV == id`.
  Anything else fails with 6001.
- Paid rounds can't be vetoed (the window is closed), so they stay in the chain.
  The mark can never drop below them, and a closed, paid id can never be posted again.
- Limit (comes from having a single high-water mark): a vetoed id comes back only
  once every live round after it is also vetoed. If B stays live, A stays used.
- No layout change: state stays 24 B, the round header stays 80 B + bitmap, and the
  offsets are unchanged. Live accounts need no migration.

Tests: 24/24 pass (the 20 old ones plus 4 new ones):
`veto_a_then_b_gives_both_ids_back`, `veto_of_a_middle_round_splices_a_longer_chain`,
`veto_with_a_bad_next_account_is_refused`, `paid_and_closed_round_can_never_be_reposted`.
`deploy_rent_is_under_0_03_sol` was replaced by `upgrade_cost_from_the_deployed_5496_byte_program`.
A fresh deploy of the new .so would cost 0.0313 SOL, which is over the old 0.03 limit.

## Size and cost (mainnet rent 5080 lamports/byte incl. 128 B overhead)

| item | bytes | lamports | kept? |
|---|---|---|---|
| new .so | 5,824 (+328 vs 5,496 deployed) | | |
| buffer account (37 + .so) | 5,861 | 30,424,120 | refunded to the spill account at upgrade |
| programdata extend (deployed with exact size 5,496 → must grow) | +328 | 1,666,240 | permanent |
| tx fees (create buffer, ~6 write txs, extend, upgrade, about 10 sigs) | | ~50,000–60,000 | spent |

Peak cash needed: about 0.0322 SOL. Net cost after the refund: about 0.0017 SOL.
J4GD held 0.002824479 SOL (read-only RPC, 2026-10-06), which is less than the
~0.0043 noted earlier and not enough to fund the buffer itself. A separate funder
wallet can pay for the buffer and the extend. J4GD then only signs the upgrade
(one 5,000-lamport fee).

## Commands (owner runs; `FUNDER` = any wallet holding ≥ 0.033 SOL)

```
cargo build-sbf --arch v3 --manifest-path programs/blockbite-prize/Cargo.toml
cargo test --manifest-path programs/blockbite-prize/Cargo.toml          # expect 26 passed
solana program write-buffer target/deploy/blockbite_prize.so -u m -k FUNDER.json
#   -> prints BUFFER
solana program set-buffer-authority BUFFER --new-buffer-authority J4GDuELnfkhUqqQobhZEuzTK2SfpncdE9tXWq77Z1H4D -u m -k FUNDER.json
solana program extend 4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn 10240 -u m -k FUNDER.json   # on-chain minimum is 10240; 328 is refused
solana program upgrade BUFFER 4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn \
  --upgrade-authority J4GD.json --spill FUNDER_PUBKEY -u m -k J4GD.json
solana program show 4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn -u m   # Data Length: 15736 (as deployed)
```
If anything fails after write-buffer: `solana program close BUFFER --recipient FUNDER_PUBKEY`
gets the 0.0304 SOL back.
The server/app veto script must pass the successor round as the 4th (writable)
account when it vetoes a round that isn't the latest.

## Go / no-go

- **VETO key kept as `ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m` (owner decision 2026-10-06).**
  A 2026-10-02 note called this key leaked. That was never verified. The owner says
  it never leaked, that they hold it, and that it has never been opened. The VETO key
  can only freeze a round inside its 24 h window and can't move USDC. Any later
  rotation needs its own upgrade.
- The 0.0322 SOL spend needs an explicit yes from the owner.
- Upgrades are atomic. A bad binary can be replaced by another upgrade while J4GD
  holds the authority. Keep the old binary (sha256
  `362f584d73fcff96759481f998f91ea72b9a0c8bb92be04b3ad743e4388a36d7`) for rollback.
  New binary sha256: `e1cae1014c88ea84af009e20502066e4df08e678f4f54e73a951868da8692e92`.
- Don't upgrade during a round's open 24 h veto window if you might need to veto
  in the middle of the upgrade sequence.
