//! End-to-end tests against the compiled program (target/deploy) in LiteSVM,
//! with the real SPL Token program. Run `cargo build-sbf` first.
//!
//! Every transaction is built the way the client builds it: the stream and
//! vault accounts are created in the same transaction as CreateStream.

use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

use blockbite_vesting::{PROOF_LEN, STREAM_LEN, TEAM_WALLET};

const TOKEN: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM: Address = Address::from_str_const("11111111111111111111111111111111");
const T0: i64 = 1_800_000_000;
const DAY: i64 = 86_400;

fn pid() -> Address {
    Address::from_str_const("8uNGjem4k2DAfyBrmW3hDctJ6ySMv3UeKNSkaUsekLZo")
}

struct Env {
    svm: LiteSVM,
    mint: Address,
    authority: Keypair,
    beneficiary: Keypair,
    team_ata: Address,
}

/// Raw SPL token account (165 bytes).
fn token_account(mint: &Address, owner: &Address, amount: u64) -> Account {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    Account { lamports: 2_039_280, data: d, owner: TOKEN, executable: false, rent_epoch: 0 }
}

fn balance(svm: &LiteSVM, a: &Address) -> u64 {
    let d = svm.get_account(a).unwrap().data;
    u64::from_le_bytes(d[64..72].try_into().unwrap())
}

fn ata_for(e: &mut Env, owner: &Address, amount: u64) -> Address {
    let a = Address::new_unique();
    e.svm.set_account(a, token_account(&e.mint, owner, amount)).unwrap();
    a
}

fn set_time(svm: &mut LiteSVM, t: i64) {
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp = t;
    c.slot += 1;
    svm.set_sysvar(&c);
    svm.expire_blockhash();
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let so = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/blockbite_vesting.so"))
        .expect("run cargo build-sbf first");
    svm.add_program(pid(), &so).unwrap();
    let mint = Address::new_unique();
    let mut m = vec![0u8; 82];
    m[44] = 6; // decimals
    m[45] = 1; // initialized
    svm.set_account(mint, Account { lamports: 1_461_600, data: m, owner: TOKEN, executable: false, rent_epoch: 0 })
        .unwrap();
    let (authority, beneficiary) = (Keypair::new(), Keypair::new());
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&beneficiary.pubkey(), 1_000_000_000).unwrap();
    set_time(&mut svm, T0);
    let mut e = Env { svm, mint, authority, beneficiary, team_ata: Address::default() };
    e.team_ata = ata_for(&mut e, &TEAM_WALLET, 0);
    e
}

fn send(e: &mut Env, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
    let tx = Transaction::new_signed_with_payer(ixs, Some(&signers[0].pubkey()), signers, e.svm.latest_blockhash());
    let r = e.svm.send_transaction(tx).map(|_| ()).map_err(|f| format!("{:?}", f.err));
    e.svm.expire_blockhash();
    r
}

fn assert_code(r: Result<(), String>, code: u32) {
    let err = r.expect_err("expected failure");
    assert!(err.contains(&format!("Custom({code})")), "want {code}, got {err}");
}

fn create_account(payer: &Address, new: &Address, lamports: u64, space: u64, owner: &Address) -> Instruction {
    let mut d = vec![0u8; 4];
    d.extend_from_slice(&lamports.to_le_bytes());
    d.extend_from_slice(&space.to_le_bytes());
    d.extend_from_slice(owner.as_ref());
    Instruction::new_with_bytes(SYSTEM, &d, vec![AccountMeta::new(*payer, true), AccountMeta::new(*new, true)])
}

fn init_token_account3(acc: &Address, mint: &Address, owner: &Address) -> Instruction {
    let mut d = vec![18u8];
    d.extend_from_slice(owner.as_ref());
    Instruction::new_with_bytes(TOKEN, &d, vec![AccountMeta::new(*acc, false), AccountMeta::new_readonly(*mint, false)])
}

struct Stream {
    stream: Address,
    vault: Address,
    vault_auth: Address,
    bump: u8,
    authority_ata: Address,
    beneficiary_ata: Address,
}

fn create_ix(e: &Env, st: &Stream, amount: u64, start: i64, cliff: i64, end: i64, bump: u8) -> Instruction {
    let mut d = vec![0u8];
    d.extend_from_slice(&7u64.to_le_bytes());
    for v in [amount, start as u64, cliff as u64, end as u64] {
        d.extend_from_slice(&v.to_le_bytes());
    }
    d.push(bump);
    Instruction::new_with_bytes(
        pid(),
        &d,
        vec![
            AccountMeta::new_readonly(e.authority.pubkey(), true),
            AccountMeta::new_readonly(e.beneficiary.pubkey(), false),
            AccountMeta::new(st.stream, false),
            AccountMeta::new(st.vault, false),
            AccountMeta::new(st.authority_ata, false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
    )
}

/// Prepares keys and pre-create instructions; `vault_owner` overrides the
/// vault's token owner (for attack tests).
fn prep(e: &mut Env, funds: u64, vault_owner: Option<Address>) -> (Stream, Keypair, Keypair, Vec<Instruction>) {
    let (sk, vk) = (Keypair::new(), Keypair::new());
    let (vault_auth, bump) = Address::find_program_address(&[sk.pubkey().as_ref()], &pid());
    let authority = e.authority.pubkey();
    let st = Stream {
        stream: sk.pubkey(),
        vault: vk.pubkey(),
        vault_auth,
        bump,
        authority_ata: ata_for(e, &authority, funds),
        beneficiary_ata: ata_for(e, &e.beneficiary.pubkey(), 0),
    };
    let pre = vec![
        create_account(&authority, &st.stream, e.svm.minimum_balance_for_rent_exemption(STREAM_LEN), STREAM_LEN as u64, &pid()),
        create_account(&authority, &st.vault, e.svm.minimum_balance_for_rent_exemption(165), 165, &TOKEN),
        init_token_account3(&st.vault, &e.mint, &vault_owner.unwrap_or(vault_auth)),
    ];
    (st, sk, vk, pre)
}

fn new_stream(e: &mut Env, amount: u64, start: i64, cliff: i64, end: i64) -> Stream {
    let (st, sk, vk, mut ixs) = prep(e, amount, None);
    ixs.push(create_ix(e, &st, amount, start, cliff, end, st.bump));
    let a = e.authority.insecure_clone();
    send(e, &ixs, &[&a, &sk, &vk]).unwrap();
    st
}

fn withdraw_ix(e: &Env, st: &Stream, signer: &Address, to: &Address) -> Instruction {
    Instruction::new_with_bytes(
        pid(),
        &[1],
        vec![
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(st.stream, false),
            AccountMeta::new_readonly(st.vault_auth, false),
            AccountMeta::new(st.vault, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
    )
    .tap(|_| {
        let _ = e;
    })
}

trait Tap: Sized {
    fn tap(self, f: impl FnOnce(&Self)) -> Self {
        f(&self);
        self
    }
}
impl Tap for Instruction {}

fn withdraw(e: &mut Env, st: &Stream) -> Result<(), String> {
    let b = e.beneficiary.insecure_clone();
    let ix = withdraw_ix(e, st, &b.pubkey(), &st.beneficiary_ata);
    send(e, &[ix], &[&b])
}

fn cancel_ix(e: &Env, st: &Stream, signer: &Address, ben_ata: &Address) -> Instruction {
    Instruction::new_with_bytes(
        pid(),
        &[4],
        vec![
            AccountMeta::new_readonly(*signer, true),
            AccountMeta::new(st.stream, false),
            AccountMeta::new_readonly(st.vault_auth, false),
            AccountMeta::new(st.vault, false),
            AccountMeta::new(st.authority_ata, false),
            AccountMeta::new(*ben_ata, false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
    )
    .tap(|_| {
        let _ = e;
    })
}

fn fund_ix(st: &Stream, funder: &Address, funder_ata: &Address, team: &Address, dev: &Address, referral: &Address, amount: u64) -> Instruction {
    let mut d = vec![2u8];
    d.extend_from_slice(&amount.to_le_bytes());
    Instruction::new_with_bytes(
        pid(),
        &d,
        vec![
            AccountMeta::new_readonly(*funder, true),
            AccountMeta::new(st.stream, false),
            AccountMeta::new(st.vault, false),
            AccountMeta::new(*funder_ata, false),
            AccountMeta::new(*team, false),
            AccountMeta::new(*dev, false),
            AccountMeta::new(*referral, false),
            AccountMeta::new_readonly(TOKEN, false),
        ],
    )
}

fn proof_ix(e: &Env, st: &Stream, admin: &Address, player: &Address, tier: u8) -> (Instruction, Address) {
    let (proof, bump) =
        Address::find_program_address(&[b"proof_cache", st.stream.as_ref(), player.as_ref()], &pid());
    let _ = e;
    let ix = Instruction::new_with_bytes(
        pid(),
        &[3, 1, tier, bump],
        vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(st.stream, false),
            AccountMeta::new_readonly(*player, false),
            AccountMeta::new(proof, false),
            AccountMeta::new_readonly(SYSTEM, false),
        ],
    );
    (ix, proof)
}

// ─── Happy paths ────────────────────────────────────────────────────────────

#[test]
fn create_and_linear_withdraw() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000_000, T0, 0, T0 + 100 * DAY);
    assert_eq!(balance(&e.svm, &st.vault), 1_000_000);
    assert_eq!(balance(&e.svm, &st.authority_ata), 0);
    assert_eq!(e.svm.get_account(&st.stream).unwrap().data[0], 1);

    set_time(&mut e.svm, T0 + 25 * DAY);
    withdraw(&mut e, &st).unwrap();
    assert_eq!(balance(&e.svm, &st.beneficiary_ata), 250_000);

    set_time(&mut e.svm, T0 + 200 * DAY);
    withdraw(&mut e, &st).unwrap();
    assert_eq!(balance(&e.svm, &st.beneficiary_ata), 1_000_000);
    assert_eq!(balance(&e.svm, &st.vault), 0);
    assert_code(withdraw(&mut e, &st), 6003);
}

#[test]
fn cliff_blocks_until_reached() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, T0 + 10 * DAY, T0 + 100 * DAY);
    set_time(&mut e.svm, T0 + 10 * DAY - 1);
    assert_code(withdraw(&mut e, &st), 6003);
    set_time(&mut e.svm, T0 + 10 * DAY);
    withdraw(&mut e, &st).unwrap();
    assert_eq!(balance(&e.svm, &st.beneficiary_ata), 100);
}

#[test]
fn vesting_math_exact_at_extremes() {
    // Huge total and the maximum duration: floor(total * elapsed / dur).
    let mut e = setup();
    let total = u64::MAX / 2;
    let dur = u32::MAX as i64;
    let st = new_stream(&mut e, total, T0, 0, T0 + dur);
    let el = 123_456_789i64;
    set_time(&mut e.svm, T0 + el);
    withdraw(&mut e, &st).unwrap();
    let want = (total as u128 * el as u128 / dur as u128) as u64;
    assert_eq!(balance(&e.svm, &st.beneficiary_ata), want);
}

#[test]
fn fund_vault_split_70_15_10_5_with_dust() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + 100 * DAY);
    let funder = Keypair::new();
    e.svm.airdrop(&funder.pubkey(), 1_000_000_000).unwrap();
    let amount = 1_999u64;
    let funder_ata = ata_for(&mut e, &funder.pubkey(), amount);
    let referral = ata_for(&mut e, &Address::new_unique(), 0);
    let team = e.team_ata;
    // Team and dev share one wallet here; duplicate accounts must work.
    let ix = fund_ix(&st, &funder.pubkey(), &funder_ata, &team, &team, &referral, amount);
    send(&mut e, &[ix], &[&funder]).unwrap();
    let (t, d, r) = (amount * 15 / 100, amount * 10 / 100, amount * 5 / 100);
    assert_eq!(balance(&e.svm, &team), t + d);
    assert_eq!(balance(&e.svm, &referral), r);
    assert_eq!(balance(&e.svm, &st.vault), 1_000 + amount - t - d - r);
    assert_eq!(balance(&e.svm, &funder_ata), 0);
    // total grows by the vault share, so it fully vests out.
    set_time(&mut e.svm, T0 + 100 * DAY);
    withdraw(&mut e, &st).unwrap();
    assert_eq!(balance(&e.svm, &st.vault), 0);
}

#[test]
fn cancel_splits_vested_and_unvested() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + 100 * DAY);
    set_time(&mut e.svm, T0 + 10 * DAY);
    withdraw(&mut e, &st).unwrap(); // 100
    set_time(&mut e.svm, T0 + 40 * DAY);
    let a = e.authority.insecure_clone();
    let ix = cancel_ix(&e, &st, &a.pubkey(), &st.beneficiary_ata);
    send(&mut e, &[ix], &[&a]).unwrap();
    assert_eq!(balance(&e.svm, &st.beneficiary_ata), 400);
    assert_eq!(balance(&e.svm, &st.authority_ata), 600);
    assert_eq!(balance(&e.svm, &st.vault), 0);
    assert_code(withdraw(&mut e, &st), 6005);
    let ix = cancel_ix(&e, &st, &a.pubkey(), &st.beneficiary_ata);
    assert_code(send(&mut e, &[ix], &[&a]), 6005);
}

#[test]
fn update_proof_creates_then_velocity_strikes() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + 100 * DAY);
    let a = e.authority.insecure_clone();
    let player = Address::new_unique();
    let (ix, proof) = proof_ix(&e, &st, &a.pubkey(), &player, 1);
    // Pre-fund the PDA: creation must still work (no griefing by donation).
    e.svm
        .set_account(proof, Account { lamports: 1_000, data: vec![], owner: SYSTEM, executable: false, rent_epoch: 0 })
        .unwrap();
    send(&mut e, &[ix.clone()], &[&a]).unwrap();
    let acc = e.svm.get_account(&proof).unwrap();
    assert_eq!((acc.owner, acc.data.len(), acc.data[0], acc.data[74]), (pid(), PROOF_LEN, 2, 1));

    // Two fast updates earn strikes 1 and 2; the third fast one fails.
    set_time(&mut e.svm, T0 + 60);
    send(&mut e, &[ix.clone()], &[&a]).unwrap();
    set_time(&mut e.svm, T0 + 120);
    send(&mut e, &[ix.clone()], &[&a]).unwrap();
    set_time(&mut e.svm, T0 + 180);
    assert_code(send(&mut e, &[ix.clone()], &[&a]), 6007);
    // A human-paced update still succeeds.
    set_time(&mut e.svm, T0 + 120 + 7_200);
    send(&mut e, &[ix], &[&a]).unwrap();

    let (bad, _) = proof_ix(&e, &st, &a.pubkey(), &player, 3);
    assert_code(send(&mut e, &[bad], &[&a]), 6008);
}

#[test]
fn withdraw_velocity_strikes() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000_000, T0, 0, T0 + 100 * DAY);
    for i in 1..=2 {
        set_time(&mut e.svm, T0 + i * 60);
        withdraw(&mut e, &st).unwrap();
    }
    set_time(&mut e.svm, T0 + 180);
    assert_code(withdraw(&mut e, &st), 6007);
}

// ─── Attacks and bad input ──────────────────────────────────────────────────

#[test]
fn create_rejects_bad_params() {
    let mut e = setup();
    let a = e.authority.insecure_clone();
    for (amount, start, cliff, end, code) in [
        (0, T0, 0, T0 + DAY, 6000),
        (5, T0, 0, T0, 6001),
        (5, T0, 0, T0 - 1, 6001),
        (5, T0, 0, T0 + u32::MAX as i64 + 1, 6001),
        (5, T0, T0 - 1, T0 + DAY, 6002),
        (5, T0, T0 + DAY + 1, T0 + DAY, 6002),
    ] {
        let (st, sk, vk, mut ixs) = prep(&mut e, 5, None);
        ixs.push(create_ix(&e, &st, amount, start, cliff, end, st.bump));
        assert_code(send(&mut e, &ixs, &[&a, &sk, &vk]), code);
    }
}

#[test]
fn create_rejects_vault_not_owned_by_stream_pda() {
    let mut e = setup();
    let a = e.authority.insecure_clone();
    let (st, sk, vk, mut ixs) = prep(&mut e, 5, Some(a.pubkey()));
    ixs.push(create_ix(&e, &st, 5, T0, 0, T0 + DAY, st.bump));
    assert_code(send(&mut e, &ixs, &[&a, &sk, &vk]), 6010);
    // Right owner, wrong bump byte.
    let (st, sk, vk, mut ixs) = prep(&mut e, 5, None);
    ixs.push(create_ix(&e, &st, 5, T0, 0, T0 + DAY, st.bump.wrapping_sub(1)));
    assert_code(send(&mut e, &ixs, &[&a, &sk, &vk]), 6010);
}

#[test]
fn create_cannot_reinitialise_stream() {
    let mut e = setup();
    let st = new_stream(&mut e, 10, T0, 0, T0 + DAY);
    let ix = create_ix(&e, &st, 10, T0, 0, T0 + DAY, st.bump);
    let a = e.authority.insecure_clone();
    assert_code(send(&mut e, &[ix], &[&a]), 6010);
}

#[test]
fn only_beneficiary_can_withdraw() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + DAY);
    set_time(&mut e.svm, T0 + DAY);
    let thief = Keypair::new();
    e.svm.airdrop(&thief.pubkey(), 1_000_000_000).unwrap();
    let thief_ata = ata_for(&mut e, &thief.pubkey(), 0);
    let ix = withdraw_ix(&e, &st, &thief.pubkey(), &thief_ata);
    assert_code(send(&mut e, &[ix], &[&thief]), 6004);
    assert_eq!(balance(&e.svm, &st.vault), 1_000);
}

#[test]
fn withdraw_rejects_foreign_vault_and_fake_stream() {
    let mut e = setup();
    let st1 = new_stream(&mut e, 1_000, T0, 0, T0 + DAY);
    let st2 = new_stream(&mut e, 1_000, T0, 0, T0 + DAY);
    set_time(&mut e.svm, T0 + DAY);
    let b = e.beneficiary.insecure_clone();
    // stream 1 with stream 2's vault + authority.
    let mut ix = withdraw_ix(&e, &st1, &b.pubkey(), &st1.beneficiary_ata);
    ix.accounts[2].pubkey = st2.vault_auth;
    ix.accounts[3].pubkey = st2.vault;
    assert_code(send(&mut e, &[ix], &[&b]), 6010);
    // Right vault, wrong signing PDA: the token program rejects the CPI.
    let mut ix = withdraw_ix(&e, &st1, &b.pubkey(), &st1.beneficiary_ata);
    ix.accounts[2].pubkey = st2.vault_auth;
    assert!(send(&mut e, &[ix], &[&b]).is_err());
    // A forged stream account not owned by the program.
    let fake = Address::new_unique();
    let mut data = e.svm.get_account(&st1.stream).unwrap();
    data.owner = Address::new_unique();
    e.svm.set_account(fake, data).unwrap();
    let mut ix = withdraw_ix(&e, &st1, &b.pubkey(), &st1.beneficiary_ata);
    ix.accounts[1].pubkey = fake;
    assert_code(send(&mut e, &[ix], &[&b]), 6010);
    assert_eq!(balance(&e.svm, &st1.vault), 1_000);
    assert_eq!(balance(&e.svm, &st2.vault), 1_000);
}

#[test]
fn cancel_only_by_authority_and_to_real_beneficiary() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + 100 * DAY);
    set_time(&mut e.svm, T0 + 50 * DAY);
    let b = e.beneficiary.insecure_clone();
    let ix = cancel_ix(&e, &st, &b.pubkey(), &st.beneficiary_ata);
    assert_code(send(&mut e, &[ix], &[&b]), 6004);
    let a = e.authority.insecure_clone();
    let own = ata_for(&mut e, &a.pubkey(), 0);
    let ix = cancel_ix(&e, &st, &a.pubkey(), &own);
    assert_code(send(&mut e, &[ix], &[&a]), 6004);
    assert_eq!(balance(&e.svm, &st.vault), 1_000);
}

#[test]
fn fund_vault_rejects_redirected_fees() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + DAY);
    let funder = Keypair::new();
    e.svm.airdrop(&funder.pubkey(), 1_000_000_000).unwrap();
    let funder_ata = ata_for(&mut e, &funder.pubkey(), 1_000);
    let mine = ata_for(&mut e, &funder.pubkey(), 0);
    let team = e.team_ata;
    let ix = fund_ix(&st, &funder.pubkey(), &funder_ata, &mine, &team, &mine, 1_000);
    assert_code(send(&mut e, &[ix], &[&funder]), 6004);
    let ix = fund_ix(&st, &funder.pubkey(), &funder_ata, &team, &mine, &mine, 1_000);
    assert_code(send(&mut e, &[ix], &[&funder]), 6004);
    let ix = fund_ix(&st, &funder.pubkey(), &funder_ata, &team, &team, &mine, 0);
    assert_code(send(&mut e, &[ix], &[&funder]), 6000);
    // Spending someone else's tokens fails in the token program.
    let victim_ata = ata_for(&mut e, &Address::new_unique(), 1_000);
    let ix = fund_ix(&st, &funder.pubkey(), &victim_ata, &team, &team, &mine, 1_000);
    assert!(send(&mut e, &[ix], &[&funder]).is_err());
    assert_eq!(balance(&e.svm, &victim_ata), 1_000);
}

#[test]
fn update_proof_rejects_non_admin_and_wrong_pda() {
    let mut e = setup();
    let st = new_stream(&mut e, 1_000, T0, 0, T0 + DAY);
    let b = e.beneficiary.insecure_clone();
    let player = Address::new_unique();
    let (ix, _) = proof_ix(&e, &st, &b.pubkey(), &player, 1);
    assert_code(send(&mut e, &[ix], &[&b]), 6004);
    let a = e.authority.insecure_clone();
    let (mut ix, _) = proof_ix(&e, &st, &a.pubkey(), &player, 1);
    ix.accounts[3].pubkey = Address::new_unique();
    assert_code(send(&mut e, &[ix], &[&a]), 6010);
    // A stream account passed as the proof cache is rejected.
    let (mut ix, _) = proof_ix(&e, &st, &a.pubkey(), &player, 1);
    ix.accounts[3].pubkey = st.stream;
    assert!(send(&mut e, &[ix], &[&a]).is_err());
}

#[test]
fn malformed_instructions_rejected() {
    let mut e = setup();
    let a = e.authority.insecure_clone();
    for data in [vec![], vec![9u8], vec![1u8, 0], vec![0u8; 41]] {
        let ix = Instruction::new_with_bytes(pid(), &data, vec![AccountMeta::new(a.pubkey(), true)]);
        assert_code(send(&mut e, &[ix], &[&a]), 6009);
    }
}
