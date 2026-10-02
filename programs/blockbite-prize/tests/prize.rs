//! Tests against the compiled mainnet binary (target/deploy/blockbite_prize.so)
//! in LiteSVM with the real SPL Token program, at the real program id, USDC
//! mint, vault and state addresses. Signature *verification* is switched off
//! so the pinned POSTER / VETO keys can sign without their private keys; the
//! signer *flags* are still enforced by the runtime and the program.
//!
//!   cargo build-sbf --arch v3 --manifest-path programs/blockbite-prize/Cargo.toml
//!   cargo test --manifest-path programs/blockbite-prize/Cargo.toml

use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

use blockbite_prize::*;

const PID: Address = Address::from_str_const("4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn");
const USDC: Address = Address::from_str_const("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const VAULT_AUTH: Address = Address::from_str_const("5Dpz47x9QHTdbgYWD6KA2tanbKbag7xp4c2NoVEV13DS");
const TOKEN: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM: Address = Address::from_str_const("11111111111111111111111111111111");
const T0: i64 = 1_800_000_000;
const DAY: i64 = 86_400;

// ─── merkle (same construction as lib/ranked/merkle.ts) ──────────────────────

fn leaf(round_id: u64, index: u32, wallet: &Address, amount: u64) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(index.to_le_bytes());
    h.update(amount.to_le_bytes());
    h.update(round_id.to_le_bytes());
    h.update(wallet.as_ref());
    h.finalize().into()
}

/// `Pubkey::create_with_seed`: sha256(base ‖ seed ‖ owner).
fn seeded(base: &Address, seed: &str, owner: &Address) -> Address {
    let mut h = Sha256::new();
    h.update(base.as_ref());
    h.update(seed.as_bytes());
    h.update(owner.as_ref());
    Address::new_from_array(h.finalize().into())
}

/// Rent-exempt minimum at LiteSVM's default rate.
fn rent(space: usize) -> u64 {
    (128 + space as u64) * 6960
}

fn seed_bytes(d: &mut Vec<u8>, seed: &str) {
    d.extend_from_slice(&(seed.len() as u64).to_le_bytes());
    d.extend_from_slice(seed.as_bytes());
}

/// System CreateAccountWithSeed, funded and signed by POSTER, owned by the program.
fn create_seeded(seed: &str, space: usize) -> Instruction {
    let mut d = 3u32.to_le_bytes().to_vec();
    d.extend_from_slice(POSTER.as_ref());
    seed_bytes(&mut d, seed);
    d.extend_from_slice(&rent(space).to_le_bytes());
    d.extend_from_slice(&(space as u64).to_le_bytes());
    d.extend_from_slice(PID.as_ref());
    let to = seeded(&POSTER, seed, &PID);
    Instruction::new_with_bytes(SYSTEM, &d, vec![AccountMeta::new(POSTER, true), AccountMeta::new(to, false), AccountMeta::new_readonly(POSTER, true)])
}

/// System AllocateWithSeed (also assigns the owner), for an address that already holds lamports.
fn allocate_seeded(seed: &str, space: usize) -> Instruction {
    let mut d = 9u32.to_le_bytes().to_vec();
    d.extend_from_slice(POSTER.as_ref());
    seed_bytes(&mut d, seed);
    d.extend_from_slice(&(space as u64).to_le_bytes());
    d.extend_from_slice(PID.as_ref());
    let to = seeded(&POSTER, seed, &PID);
    Instruction::new_with_bytes(SYSTEM, &d, vec![AccountMeta::new(to, false), AccountMeta::new_readonly(POSTER, true)])
}

fn transfer(from: &Address, to: &Address, lamports: u64) -> Instruction {
    let mut d = 2u32.to_le_bytes().to_vec();
    d.extend_from_slice(&lamports.to_le_bytes());
    Instruction::new_with_bytes(SYSTEM, &d, vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)])
}

fn node(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (x, y) = if a <= b { (a, b) } else { (b, a) };
    let mut h = Sha256::new();
    h.update([1u8]);
    h.update(x);
    h.update(y);
    h.finalize().into()
}

/// Levels bottom-up; an odd last node is carried up unchanged.
fn tree(leaves: &[[u8; 32]]) -> Vec<Vec<[u8; 32]>> {
    let mut levels = vec![leaves.to_vec()];
    while levels.last().unwrap().len() > 1 {
        let l = levels.last().unwrap();
        let next = l.chunks(2).map(|c| if c.len() == 2 { node(&c[0], &c[1]) } else { c[0] }).collect();
        levels.push(next);
    }
    levels
}

fn proof(levels: &[Vec<[u8; 32]>], mut i: usize) -> Vec<[u8; 32]> {
    let mut p = vec![];
    for l in &levels[..levels.len() - 1] {
        let sib = i ^ 1;
        if sib < l.len() {
            p.push(l[sib]);
        }
        i /= 2;
    }
    p
}

struct Round {
    id: u64,
    winners: Vec<(Address, u64)>,
    levels: Vec<Vec<[u8; 32]>>,
    address: Address,
}

impl Round {
    fn new(id: u64, winners: Vec<(Address, u64)>) -> Self {
        let leaves: Vec<_> = winners.iter().enumerate().map(|(i, (w, a))| leaf(id, i as u32, w, *a)).collect();
        let levels = tree(&leaves);
        let address = seeded(&POSTER, &id.to_string(), &PID);
        Round { id, winners, levels, address }
    }
    fn seed(&self) -> String {
        self.id.to_string()
    }
    fn space(&self) -> usize {
        ROUND_HDR + self.winners.len().div_ceil(8)
    }
    fn create(&self) -> Instruction {
        create_seeded(&self.seed(), self.space())
    }
    fn root(&self) -> [u8; 32] {
        self.levels.last().unwrap()[0]
    }
    fn total(&self) -> u64 {
        self.winners.iter().map(|w| w.1).sum()
    }
}

// ─── environment ─────────────────────────────────────────────────────────────

struct Env {
    svm: LiteSVM,
    payer: Keypair,
}

fn token_account(owner: &Address, amount: u64) -> Account {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(USDC.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    Account { lamports: 2_039_280, data: d, owner: TOKEN, executable: false, rent_epoch: 0 }
}

fn balance(e: &Env, a: &Address) -> u64 {
    let d = e.svm.get_account(a).unwrap().data;
    u64::from_le_bytes(d[64..72].try_into().unwrap())
}

fn reserved(e: &Env) -> u64 {
    let d = e.svm.get_account(&STATE).unwrap().data;
    u64::from_le_bytes(d[8..16].try_into().unwrap())
}

fn set_time(e: &mut Env, t: i64) {
    let mut c: Clock = e.svm.get_sysvar();
    c.unix_timestamp = t;
    c.slot += 1;
    e.svm.set_sysvar(&c);
    e.svm.expire_blockhash();
}

fn setup(vault_usdc: u64) -> Env {
    let mut svm = LiteSVM::new().with_sigverify(false);
    let so = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/blockbite_prize.so"))
        .expect("run cargo build-sbf first");
    svm.add_program(PID, &so).unwrap();
    let mut m = vec![0u8; 82];
    m[44] = 6;
    m[45] = 1;
    svm.set_account(USDC, Account { lamports: 1_461_600, data: m, owner: TOKEN, executable: false, rent_epoch: 0 })
        .unwrap();
    svm.set_account(VAULT, token_account(&VAULT_AUTH, vault_usdc)).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&POSTER, 1_000_000_000).unwrap();
    let mut e = Env { svm, payer };
    set_time(&mut e, T0);
    // One-time setup, as the post script does it before the first round.
    assert_eq!(seeded(&POSTER, STATE_SEED, &PID), STATE);
    send(&mut e, &[create_seeded(STATE_SEED, STATE_LEN)]).unwrap();
    e
}

/// Sends with `payer` as fee payer; other signer flags come from the metas.
fn send(e: &mut Env, ixs: &[Instruction]) -> Result<(), String> {
    let msg = Message::new(ixs, Some(&e.payer.pubkey()));
    let mut tx = Transaction::new_unsigned(msg);
    tx.partial_sign(&[&e.payer], e.svm.latest_blockhash());
    let r = e.svm.send_transaction(tx).map(|_| ()).map_err(|f| format!("{:?}", f.err));
    e.svm.expire_blockhash();
    r
}

fn code(r: Result<(), String>, c: u32) {
    let err = r.expect_err("expected failure");
    assert!(err.contains(&format!("Custom({c})")), "want {c}, got {err}");
}

fn post_ix(r: &Round, poster: &Address, poster_signs: bool, total: u64, count: u32) -> Instruction {
    let mut d = vec![0u8];
    d.extend_from_slice(&r.id.to_le_bytes());
    d.extend_from_slice(&r.root());
    d.extend_from_slice(&total.to_le_bytes());
    d.extend_from_slice(&count.to_le_bytes());
    Instruction::new_with_bytes(
        PID,
        &d,
        vec![
            AccountMeta::new(*poster, poster_signs),
            AccountMeta::new(STATE, false),
            AccountMeta::new(r.address, false),
            AccountMeta::new_readonly(VAULT, false),
        ],
    )
}

/// Create the round account and post it in one transaction, like the post script.
fn post(e: &mut Env, r: &Round) -> Result<(), String> {
    send(e, &[r.create(), post_ix(r, &POSTER, true, r.total(), r.winners.len() as u32)])
}

fn veto_ix(r: &Round, who: &Address, signs: bool) -> Instruction {
    Instruction::new_with_bytes(
        PID,
        &[1],
        vec![AccountMeta::new_readonly(*who, signs), AccountMeta::new(STATE, false), AccountMeta::new(r.address, false)],
    )
}

fn claim_raw(r: &Round, index: u32, amount: u64, proof: &[[u8; 32]], dest: &Address, vault: &Address) -> Instruction {
    let mut d = vec![2u8];
    d.extend_from_slice(&index.to_le_bytes());
    d.extend_from_slice(&amount.to_le_bytes());
    for p in proof {
        d.extend_from_slice(p);
    }
    Instruction::new_with_bytes(
        PID,
        &d,
        vec![
            AccountMeta::new(STATE, false),
            AccountMeta::new(r.address, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(VAULT_AUTH, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
    )
}

/// Token account for winner i, created on demand.
fn dest_for(e: &mut Env, wallet: &Address) -> Address {
    let a = Address::new_unique();
    e.svm.set_account(a, token_account(wallet, 0)).unwrap();
    a
}

fn claim(e: &mut Env, r: &Round, i: usize, dest: &Address) -> Result<(), String> {
    let p = proof(&r.levels, i);
    send(e, &[claim_raw(r, i as u32, r.winners[i].1, &p, dest, &VAULT)])
}

fn close_ix(r: &Round, poster: &Address) -> Instruction {
    Instruction::new_with_bytes(
        PID,
        &[3],
        vec![AccountMeta::new(STATE, false), AccountMeta::new(r.address, false), AccountMeta::new(*poster, false)],
    )
}

fn winners(n: usize, each: u64) -> Vec<(Address, u64)> {
    (0..n).map(|i| (Address::new_unique(), each + i as u64)).collect()
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[test]
fn only_the_poster_can_post() {
    let mut e = setup(1_000_000);
    let r = Round::new(1, winners(3, 1000));
    let stranger = Keypair::new().pubkey();
    code(send(&mut e, &[r.create(), post_ix(&r, &stranger, true, r.total(), 3)]), E_UNAUTHORIZED);
    // Without the create (where POSTER signs anyway, for the whole transaction).
    code(send(&mut e, &[post_ix(&r, &POSTER, false, r.total(), 3)]), E_UNAUTHORIZED);
    assert!(e.svm.get_account(&r.address).map_or(true, |a| a.data.is_empty()));
}

#[test]
fn post_creates_state_and_reserves_funds() {
    let mut e = setup(1_000_000);
    let r = Round::new(7, winners(10, 20_000));
    post(&mut e, &r).unwrap();
    assert_eq!(reserved(&e), r.total());
    let d = e.svm.get_account(&r.address).unwrap().data;
    assert_eq!(d.len(), ROUND_HDR + 2);
    assert_eq!(d[0], ROUND_TAG);
    assert_eq!(&d[16..48], &r.root());
    assert_eq!(u64::from_le_bytes(d[64..72].try_into().unwrap()), T0 as u64);
}

#[test]
fn cannot_promise_more_than_the_vault_holds() {
    let mut e = setup(100_000);
    let big = Round::new(1, vec![(Address::new_unique(), 100_001)]);
    code(post(&mut e, &big), E_INSUFFICIENT);
    let a = Round::new(2, vec![(Address::new_unique(), 60_000)]);
    post(&mut e, &a).unwrap();
    let b = Round::new(3, vec![(Address::new_unique(), 40_001)]);
    code(post(&mut e, &b), E_INSUFFICIENT); // 60_000 already promised
    let c = Round::new(4, vec![(Address::new_unique(), 40_000)]);
    post(&mut e, &c).unwrap();
    assert_eq!(reserved(&e), 100_000);
}

#[test]
fn bad_post_arguments_and_accounts_are_refused() {
    let mut e = setup(1_000_000);
    let r = Round::new(1, winners(2, 10));
    let fake_vault = Address::new_unique();
    e.svm.set_account(fake_vault, token_account(&VAULT_AUTH, u64::MAX)).unwrap();
    let mut ix = post_ix(&r, &POSTER, true, r.total(), 2);
    ix.accounts[3].pubkey = fake_vault;
    code(send(&mut e, &[r.create(), ix]), E_BAD_ACCOUNT);
    // State must be the pinned account, even when it is program-owned and zeroed.
    let fake_state = Address::new_unique();
    e.svm.set_account(fake_state, Account { lamports: rent(STATE_LEN), data: vec![0; STATE_LEN], owner: PID, executable: false, rent_epoch: 0 }).unwrap();
    let mut ix = post_ix(&r, &POSTER, true, r.total(), 2);
    ix.accounts[1].pubkey = fake_state;
    code(send(&mut e, &[r.create(), ix]), E_BAD_ACCOUNT);
    // The round account must exist, be owned by the program and sized for `count`.
    code(send(&mut e, &[post_ix(&r, &POSTER, true, r.total(), 2)]), E_BAD_ACCOUNT);
    code(send(&mut e, &[r.create(), post_ix(&r, &POSTER, true, r.total(), 9)]), E_BAD_ACCOUNT);
    code(send(&mut e, &[create_seeded(&r.seed(), ROUND_HDR + 5), post_ix(&r, &POSTER, true, r.total(), 2)]), E_BAD_ACCOUNT);
    // The same account twice is refused outright.
    let mut ix = post_ix(&r, &POSTER, true, r.total(), 2);
    ix.accounts[2].pubkey = STATE;
    code(send(&mut e, &[ix]), E_BAD_IX);
    post(&mut e, &r).unwrap();
}

#[test]
fn a_round_id_can_be_posted_once() {
    let mut e = setup(1_000_000);
    let r = Round::new(20261009, winners(2, 10));
    post(&mut e, &r).unwrap();
    // The address is taken, and the id may not come back either.
    assert!(post(&mut e, &r).is_err());
    code(post(&mut e, &Round::new(20261008, winners(2, 10))), E_EXISTS);
    // A round that ran its course and was closed (account gone) stays used.
    set_time(&mut e, T0 + 90 * DAY);
    send(&mut e, &[close_ix(&r, &POSTER)]).unwrap();
    assert!(e.svm.get_account(&r.address).map_or(true, |a| a.lamports == 0));
    code(post(&mut e, &r), E_EXISTS);
    // Vetoing an older round does not reopen it: that would reopen later ids.
    let a = Round::new(20261020, winners(1, 10));
    let b = Round::new(20261021, winners(1, 10));
    post(&mut e, &a).unwrap();
    post(&mut e, &b).unwrap();
    send(&mut e, &[veto_ix(&a, &VETO, true)]).unwrap();
    send(&mut e, &[close_ix(&a, &POSTER)]).unwrap();
    code(post(&mut e, &a), E_EXISTS);
    // Day and month ids move forward separately.
    post(&mut e, &Round::new(20261000, winners(1, 10))).unwrap();
    code(post(&mut e, &Round::new(20260900, winners(1, 10))), E_EXISTS);
    post(&mut e, &Round::new(20261030, winners(1, 10))).unwrap();
}

#[test]
fn prefunding_a_round_address_does_not_block_posting() {
    let mut e = setup(1_000_000);
    let r = Round::new(11, winners(2, 10));
    // Anyone can send SOL to the (predictable) round address. That makes
    // CreateAccountWithSeed fail, so the post script tops up and allocates.
    e.svm.airdrop(&r.address, 1_000_000).unwrap();
    assert!(post(&mut e, &r).is_err());
    let ixs = [
        transfer(&POSTER, &r.address, rent(r.space()) - 1_000_000),
        allocate_seeded(&r.seed(), r.space()),
        post_ix(&r, &POSTER, true, r.total(), 2),
    ];
    send(&mut e, &ixs).unwrap();
    let acc = e.svm.get_account(&r.address).unwrap();
    assert_eq!(acc.owner, PID);
    assert_eq!(acc.lamports, rent(r.space()));
    assert_eq!(acc.data[0], ROUND_TAG);
}

#[test]
fn veto_only_by_cold_wallet_inside_24h() {
    let mut e = setup(1_000_000);
    let r = Round::new(1, winners(3, 1000));
    post(&mut e, &r).unwrap();
    code(send(&mut e, &[veto_ix(&r, &POSTER, true)]), E_UNAUTHORIZED);
    code(send(&mut e, &[veto_ix(&r, &VETO, false)]), E_UNAUTHORIZED);
    set_time(&mut e, T0 + DAY - 1);
    send(&mut e, &[veto_ix(&r, &VETO, true)]).unwrap();
    assert_eq!(reserved(&e), 0);
    code(send(&mut e, &[veto_ix(&r, &VETO, true)]), E_VETOED);
    set_time(&mut e, T0 + DAY + 10);
    let d = dest_for(&mut e, &r.winners[0].0);
    code(claim(&mut e, &r, 0, &d), E_VETOED);

    let r2 = Round::new(2, winners(1, 1000));
    post(&mut e, &r2).unwrap();
    set_time(&mut e, T0 + 2 * DAY + 11);
    code(send(&mut e, &[veto_ix(&r2, &VETO, true)]), E_WINDOW);
}

#[test]
fn claims_open_after_24h_pay_the_winner_once() {
    let mut e = setup(1_000_000);
    let r = Round::new(3, winners(10, 30_000));
    post(&mut e, &r).unwrap();
    let dests: Vec<_> = r.winners.clone().iter().map(|w| dest_for(&mut e, &w.0)).collect();
    code(claim(&mut e, &r, 0, &dests[0]), E_WINDOW);
    set_time(&mut e, T0 + DAY);
    for i in 0..10 {
        claim(&mut e, &r, i, &dests[i]).unwrap();
        assert_eq!(balance(&e, &dests[i]), r.winners[i].1);
    }
    assert_eq!(balance(&e, &VAULT), 1_000_000 - r.total());
    assert_eq!(reserved(&e), 0);
    code(claim(&mut e, &r, 4, &dests[4]), E_CLAIMED);
    let other = dest_for(&mut e, &r.winners[4].0);
    code(claim(&mut e, &r, 4, &other), E_CLAIMED);
}

#[test]
fn a_proof_cannot_be_redirected_or_inflated() {
    let mut e = setup(1_000_000);
    let r = Round::new(4, winners(5, 50_000));
    post(&mut e, &r).unwrap();
    set_time(&mut e, T0 + DAY);
    let p = proof(&r.levels, 2);
    let attacker = dest_for(&mut e, &Address::new_unique());
    code(send(&mut e, &[claim_raw(&r, 2, r.winners[2].1, &p, &attacker, &VAULT)]), E_PROOF);
    let mine = dest_for(&mut e, &r.winners[2].0);
    code(send(&mut e, &[claim_raw(&r, 2, r.winners[2].1 + 1, &p, &mine, &VAULT)]), E_PROOF);
    code(send(&mut e, &[claim_raw(&r, 3, r.winners[2].1, &p, &mine, &VAULT)]), E_PROOF);
    code(send(&mut e, &[claim_raw(&r, 5, r.winners[2].1, &p, &mine, &VAULT)]), E_ARGS);
    code(send(&mut e, &[claim_raw(&r, 2, r.winners[2].1, &p[..p.len() - 1], &mine, &VAULT)]), E_PROOF);
    let fake_vault = Address::new_unique();
    e.svm.set_account(fake_vault, token_account(&VAULT_AUTH, 1_000_000)).unwrap();
    code(send(&mut e, &[claim_raw(&r, 2, r.winners[2].1, &p, &mine, &fake_vault)]), E_BAD_ACCOUNT);
    // A different round's proof does not verify here.
    let r2 = Round::new(5, r.winners.clone());
    post(&mut e, &r2).unwrap();
    set_time(&mut e, T0 + 2 * DAY + 1);
    code(send(&mut e, &[claim_raw(&r2, 2, r.winners[2].1, &p, &mine, &VAULT)]), E_PROOF);
    send(&mut e, &[claim_raw(&r, 2, r.winners[2].1, &p, &mine, &VAULT)]).unwrap();
    assert_eq!(balance(&e, &mine), r.winners[2].1);
}

#[test]
fn single_leaf_and_odd_trees_work() {
    for n in [1usize, 2, 3, 7, 10, 33] {
        let mut e = setup(10_000_000);
        let r = Round::new(100 + n as u64, winners(n, 1234));
        post(&mut e, &r).unwrap();
        set_time(&mut e, T0 + DAY);
        for i in 0..n {
            let d = dest_for(&mut e, &r.winners[i].0);
            claim(&mut e, &r, i, &d).unwrap_or_else(|err| panic!("n={n} i={i}: {err}"));
        }
        assert_eq!(reserved(&e), 0);
    }
}

#[test]
fn close_returns_rent_and_releases_unclaimed_after_90_days() {
    let mut e = setup(1_000_000);
    let r = Round::new(6, winners(3, 100_000));
    post(&mut e, &r).unwrap();
    code(send(&mut e, &[close_ix(&r, &POSTER)]), E_OPEN);
    set_time(&mut e, T0 + DAY);
    let d0 = dest_for(&mut e, &r.winners[0].0);
    claim(&mut e, &r, 0, &d0).unwrap();
    code(send(&mut e, &[close_ix(&r, &Address::new_unique())]), E_BAD_ACCOUNT);
    set_time(&mut e, T0 + 90 * DAY);
    let d1 = dest_for(&mut e, &r.winners[1].0);
    code(claim(&mut e, &r, 1, &d1), E_WINDOW);
    let before = e.svm.get_account(&POSTER).unwrap().lamports;
    let rent = e.svm.get_account(&r.address).unwrap().lamports;
    send(&mut e, &[close_ix(&r, &POSTER)]).unwrap();
    assert_eq!(e.svm.get_account(&POSTER).unwrap().lamports, before + rent);
    assert!(e.svm.get_account(&r.address).map_or(true, |a| a.lamports == 0));
    assert_eq!(reserved(&e), 0);
    // Gone: nothing can be claimed from it any more.
    let d2 = dest_for(&mut e, &r.winners[2].0);
    assert!(claim(&mut e, &r, 2, &d2).is_err());
    // The freed USDC can be promised again.
    let again = Round::new(60, vec![(Address::new_unique(), 1_000_000 - 100_000)]);
    post(&mut e, &again).unwrap();
}

#[test]
fn fully_claimed_or_vetoed_rounds_close_early() {
    let mut e = setup(1_000_000);
    let a = Round::new(1, winners(1, 5000));
    let b = Round::new(2, winners(2, 5000));
    post(&mut e, &a).unwrap();
    post(&mut e, &b).unwrap();
    send(&mut e, &[veto_ix(&b, &VETO, true)]).unwrap();
    send(&mut e, &[close_ix(&b, &POSTER)]).unwrap();
    assert_eq!(reserved(&e), a.total());
    set_time(&mut e, T0 + DAY);
    let d = dest_for(&mut e, &a.winners[0].0);
    claim(&mut e, &a, 0, &d).unwrap();
    send(&mut e, &[close_ix(&a, &POSTER)]).unwrap();
    assert_eq!(reserved(&e), 0);
}

#[test]
fn malformed_instructions_are_refused() {
    let mut e = setup(1_000_000);
    let r = Round::new(1, winners(2, 10));
    post(&mut e, &r).unwrap();
    let mut ix = veto_ix(&r, &VETO, true);
    ix.data = vec![];
    code(send(&mut e, &[ix]), E_BAD_IX);
    let mut ix = veto_ix(&r, &VETO, true);
    ix.data = vec![9];
    code(send(&mut e, &[ix]), E_BAD_IX);
    let d = dest_for(&mut e, &r.winners[0].0);
    set_time(&mut e, T0 + DAY);
    // Proof length is bounded only by the transaction size; junk never verifies.
    code(send(&mut e, &[claim_raw(&r, 0, 10, &[[0u8; 32]; 17], &d, &VAULT)]), E_PROOF);
    let mut ix = claim_raw(&r, 0, 10, &proof(&r.levels, 0), &d, &VAULT);
    ix.data.truncate(12);
    code(send(&mut e, &[ix]), E_BAD_IX);
    let mut ix = claim_raw(&r, 0, 10, &[], &d, &VAULT);
    ix.accounts.pop();
    code(send(&mut e, &[ix]), E_BAD_IX);
    // A round account passed as state, and state passed as a round.
    let mut ix = veto_ix(&r, &VETO, true);
    ix.accounts.swap(1, 2);
    code(send(&mut e, &[ix]), E_BAD_ACCOUNT);
}

// ─── TypeScript interop ──────────────────────────────────────────────────────
//
// tests/fixtures/ts-rounds.txt is written by `npx tsx scripts/prize-fixture.ts`
// from the server code that runs in production: lib/ranked/results.ts
// (payouts), lib/ranked/merkle.ts (tree, proofs) and lib/ranked/prize-ix.ts
// (PostResults and claim instructions, byte for byte with their account
// metas). This test sends those instructions unchanged.

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "odd hex");
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex")).collect()
}

fn hash32(s: &str) -> [u8; 32] {
    unhex(s).try_into().expect("32 bytes")
}

/// `<program> <data hex> <pubkey>:<s|-><w|->...`
fn ts_ix(fields: &[&str]) -> Instruction {
    let metas = fields[2..]
        .iter()
        .map(|m| {
            let (key, flags) = m.split_once(':').expect("meta");
            let key = Address::from_str_const(key);
            match flags {
                "sw" => AccountMeta::new(key, true),
                "s-" => AccountMeta::new_readonly(key, true),
                "-w" => AccountMeta::new(key, false),
                "--" => AccountMeta::new_readonly(key, false),
                f => panic!("bad flags {f}"),
            }
        })
        .collect();
    Instruction::new_with_bytes(Address::from_str_const(fields[0]), &unhex(fields[1]), metas)
}

struct TsClaim {
    wallet: Address,
    ata: Address,
    amount: u64,
    ixs: Vec<Instruction>,
}

struct TsRound {
    id: u64,
    root: [u8; 32],
    total: u64,
    leaves: Vec<(u32, Address, u64, Vec<[u8; 32]>)>,
    post: Vec<Instruction>,
    claims: Vec<TsClaim>,
}

fn ts_rounds() -> Vec<TsRound> {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ts-rounds.txt"))
        .expect("run `npx tsx scripts/prize-fixture.ts` first");
    let mut rounds: Vec<TsRound> = vec![];
    for line in text.lines().filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let f: Vec<&str> = line.split_whitespace().collect();
        match f[0] {
            "round" => rounds.push(TsRound {
                id: f[1].parse().unwrap(),
                root: hash32(f[2]),
                total: f[3].parse().unwrap(),
                leaves: vec![],
                post: vec![],
                claims: vec![],
            }),
            "leaf" => {
                let proof = if f[4] == "-" { vec![] } else { f[4].split(',').map(hash32).collect() };
                let r = rounds.last_mut().unwrap();
                r.leaves.push((f[1].parse().unwrap(), Address::from_str_const(f[2]), f[3].parse().unwrap(), proof));
            }
            "post" => rounds.last_mut().unwrap().post.push(ts_ix(&f[1..])),
            "claim" => rounds.last_mut().unwrap().claims.push(TsClaim {
                wallet: Address::from_str_const(f[1]),
                ata: Address::from_str_const(f[2]),
                amount: f[3].parse().unwrap(),
                ixs: vec![],
            }),
            "ix" => rounds.last_mut().unwrap().claims.last_mut().unwrap().ixs.push(ts_ix(&f[1..])),
            t => panic!("bad fixture line {t}"),
        }
    }
    assert!(!rounds.is_empty());
    rounds
}

#[test]
fn ts_built_rounds_post_and_claim() {
    let rounds = ts_rounds();
    let promised: u64 = rounds.iter().map(|r| r.total).sum();
    let mut e = setup(promised + 777);

    for r in &rounds {
        // The Rust construction (same as the program's Claim) agrees with TS.
        assert_eq!(r.leaves.len(), r.claims.len());
        assert_eq!(r.leaves.iter().map(|l| l.2).sum::<u64>(), r.total);
        let hashes: Vec<_> = r.leaves.iter().map(|(i, w, a, _)| leaf(r.id, *i, w, *a)).collect();
        let levels = tree(&hashes);
        assert_eq!(levels.last().unwrap()[0], r.root, "round {}: TS root differs from Rust root", r.id);
        for (i, l) in r.leaves.iter().enumerate() {
            assert_eq!(proof(&levels, i), l.3, "round {} leaf {i}: TS proof differs", r.id);
        }
        // The TS-built PostResults, exactly as the post script sends it.
        send(&mut e, &r.post).unwrap_or_else(|err| panic!("post round {}: {err}", r.id));
        let acc = e.svm.get_account(&seeded(&POSTER, &r.id.to_string(), &PID)).unwrap();
        assert_eq!(&acc.data[16..48], &r.root);
    }
    assert_eq!(reserved(&e), promised);

    // Inside the veto window a TS-built claim is refused like any other.
    let first = &rounds[0].claims[0];
    e.svm.airdrop(&first.wallet, 10_000_000).unwrap();
    code(send(&mut e, &first.ixs), E_WINDOW);

    set_time(&mut e, T0 + DAY);
    for r in &rounds {
        for c in &r.claims {
            // The winner pays rent for its own USDC account (create-idempotent + claim).
            e.svm.airdrop(&c.wallet, 10_000_000).unwrap();
            send(&mut e, &c.ixs).unwrap_or_else(|err| panic!("claim round {} {}: {err}", r.id, c.wallet));
            assert_eq!(balance(&e, &c.ata), c.amount);
            let owner = &e.svm.get_account(&c.ata).unwrap().data[32..64];
            assert_eq!(owner, c.wallet.as_ref());
        }
        // A claim cannot be repeated.
        let again = r.claims[0].ixs.last().unwrap().clone();
        code(send(&mut e, &[again]), E_CLAIMED);
    }
    assert_eq!(reserved(&e), 0);
    assert_eq!(balance(&e, &VAULT), 777);
}

#[test]
fn claim_cannot_pay_from_vault_to_vault() {
    let mut e = setup(1_000_000);
    // A leaf that names the vault authority itself would be the only way; the
    // poster never includes it, and a proof for someone else does not verify.
    let r = Round::new(1, winners(2, 10));
    post(&mut e, &r).unwrap();
    set_time(&mut e, T0 + DAY);
    let p = proof(&r.levels, 0);
    // The vault as destination is the vault passed twice: refused before anything runs.
    code(send(&mut e, &[claim_raw(&r, 0, 10, &p, &VAULT, &VAULT)]), E_BAD_IX);
    // Another account owned by the vault authority is not the winner's either.
    let other = dest_for(&mut e, &VAULT_AUTH);
    code(send(&mut e, &[claim_raw(&r, 0, 10, &p, &other, &VAULT)]), E_PROOF);
}

#[test]
fn veto_of_the_latest_round_lets_corrected_results_be_posted() {
    let mut e = setup(1_000_000);
    let wrong = Round::new(20261001, winners(3, 1000));
    post(&mut e, &wrong).unwrap();
    send(&mut e, &[veto_ix(&wrong, &VETO, true)]).unwrap();
    send(&mut e, &[close_ix(&wrong, &POSTER)]).unwrap();
    // Same id, same address, new winners.
    let right = Round::new(20261001, winners(4, 2000));
    post(&mut e, &right).unwrap();
    assert_eq!(reserved(&e), right.total());
    set_time(&mut e, T0 + DAY);
    for i in 0..4 {
        let d = dest_for(&mut e, &right.winners[i].0);
        claim(&mut e, &right, i, &d).unwrap();
    }
    // The wrong round's leaves do not verify against the new root.
    let d = dest_for(&mut e, &wrong.winners[0].0);
    let p = proof(&wrong.levels, 0);
    assert!(send(&mut e, &[claim_raw(&right, 0, wrong.winners[0].1, &p, &d, &VAULT)]).is_err());
    assert_eq!(reserved(&e), 0);
}

#[test]
fn a_bogus_far_future_id_is_undone_by_its_veto() {
    // A stolen POSTER key posts ids that would block every real date.
    let mut e = setup(1_000_000);
    post(&mut e, &Round::new(20261001, winners(1, 10))).unwrap();
    let x1 = Round::new(99_991_230, winners(1, 0));
    let x2 = Round::new(99_991_231, winners(1, 0));
    post(&mut e, &x1).unwrap();
    post(&mut e, &x2).unwrap();
    code(post(&mut e, &Round::new(20261002, winners(1, 10))), E_EXISTS);
    // Vetoed latest first, the mark walks back to the real one.
    send(&mut e, &[veto_ix(&x2, &VETO, true)]).unwrap();
    send(&mut e, &[veto_ix(&x1, &VETO, true)]).unwrap();
    post(&mut e, &Round::new(20261002, winners(1, 10))).unwrap();
    // Walked back only to the real mark, never below it.
    code(post(&mut e, &Round::new(20260930, winners(1, 10))), E_EXISTS);
}

#[test]
fn a_closed_round_cannot_be_kept_as_a_program_account() {
    let mut e = setup(1_000_000);
    let r = Round::new(20261001, winners(2, 10));
    post(&mut e, &r).unwrap();
    send(&mut e, &[veto_ix(&r, &VETO, true)]).unwrap();
    // Close and refund it in one transaction.
    let payer = e.payer.pubkey();
    send(&mut e, &[close_ix(&r, &POSTER), transfer(&payer, &r.address, 2_000_000)]).unwrap();
    let acc = e.svm.get_account(&r.address).unwrap();
    assert_eq!(acc.owner, SYSTEM);
    assert!(acc.data.is_empty());
    // Not usable by the program, and the id can still be posted again.
    code(send(&mut e, &[veto_ix(&r, &VETO, true)]), E_BAD_ACCOUNT);
    let ixs = [allocate_seeded(&r.seed(), r.space()), post_ix(&r, &POSTER, true, r.total(), 2)];
    send(&mut e, &ixs).unwrap();
    assert_eq!(e.svm.get_account(&r.address).unwrap().data[0], ROUND_TAG);
}

#[test]
fn a_failed_transfer_leaves_the_prize_claimable() {
    let mut e = setup(1_000_000);
    let r = Round::new(20261001, winners(2, 5000));
    post(&mut e, &r).unwrap();
    set_time(&mut e, T0 + DAY);
    // A token account of another mint, owned by the winner: the transfer fails.
    let wrong_mint = Address::new_unique();
    let mut acc = token_account(&r.winners[0].0, 0);
    acc.data[0..32].copy_from_slice(wrong_mint.as_ref());
    e.svm.set_account(wrong_mint, acc).unwrap();
    assert!(claim(&mut e, &r, 0, &wrong_mint).is_err());
    assert_eq!(reserved(&e), r.total());
    let d = dest_for(&mut e, &r.winners[0].0);
    claim(&mut e, &r, 0, &d).unwrap();
    assert_eq!(balance(&e, &d), r.winners[0].1);
}

#[test]
fn deploy_rent_is_under_0_03_sol() {
    // Mainnet rent today: 5080 lamports per byte incl. the 128-byte account
    // overhead (getMinimumBalanceForRentExemption). A deploy pays rent for the
    // program account (36 bytes) and the program data account (45 + .so).
    let so = std::fs::metadata(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/blockbite_prize.so")).unwrap().len();
    let lamports = (128 + 36) * 5080 + (128 + 45 + so) * 5080;
    println!(".so {so} bytes, deploy rent {lamports} lamports = {:.6} SOL", lamports as f64 / 1e9);
    // Leave 100k lamports for the deploy's transaction fees.
    assert!(lamports + 100_000 < 30_000_000, "{lamports}");
}
