//! BlockBite vesting (Pinocchio).
//!
//! Linear token vesting with an optional cliff, an atomic 70/15/10/5 revenue
//! split on deposits, and VGPV (Velocity-Gated Proof Validation) bot checks.
//! Feature parity with the former Anchor program, rebuilt on Pinocchio.
//!
//! Size budget (deploy rent scales with binary size):
//! - the code never panics (no slice indexing, no overflow checks, raw
//!   syscalls), so Rust's panic/formatting machinery is not linked in;
//! - the client creates the stream account and the vault token account in
//!   the same transaction as `CreateStream`; the program only validates
//!   them. Only the per-player ProofCache is created on-chain, because it
//!   must be unique per (stream, player).
//!
//! The vault's token authority is the PDA `[stream address, bump]`; only
//! this program can sign for it.
//!
//! The Codama IDL (`idl/blockbite_vesting.json`, built by
//! `codama/build-idl.mjs`) is the source of truth for clients; keep the
//! layouts below and that file in sync.
//!
//! Instruction data = 1-byte discriminator + fixed little-endian fields.
//!   0 CreateStream  stream_id u64, amount u64, start_ts i64, cliff_ts i64,
//!                   end_ts i64, vault_authority_bump u8
//!   1 Withdraw      (none)
//!   2 FundVault     amount u64
//!   3 UpdateProof   cohort_id u8, tier_reached u8, proof_bump u8
//!   4 Cancel        (none)
#![cfg_attr(target_os = "solana", no_std)]

use pinocchio::{
    address::Address,
    cpi::{invoke_signed_unchecked, CpiAccount, Seed, Signer},
    instruction::{InstructionAccount, InstructionView},
    AccountView,
};

#[cfg(not(feature = "no-entrypoint"))]
mod entry {
    use pinocchio::entrypoint::lazy::{InstructionContext, MaybeAccount};
    use pinocchio::AccountView;

    /// Lazy entrypoint: reads up to eight accounts straight from the input
    /// buffer. Duplicates are allowed (team and dev fee accounts may be the
    /// same) and resolve to a second view of the same account.
    #[no_mangle]
    pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
        let mut ctx = InstructionContext::new_unchecked(input);
        let n = ctx.remaining() as usize;
        if n > 8 {
            return super::E_BAD_IX as u64;
        }
        let mut accounts: [core::mem::MaybeUninit<AccountView>; 8] =
            [const { core::mem::MaybeUninit::uninit() }; 8];
        let base = accounts.as_mut_ptr() as *mut AccountView;
        let mut i = 0;
        while i < n {
            let view = match ctx.next_account_unchecked() {
                MaybeAccount::Account(a) => a,
                MaybeAccount::Duplicated(j) => AccountView::new_unchecked((*base.add(j as usize)).account_mut_ptr()),
            };
            base.add(i).write(view);
            i += 1;
        }
        let accounts = core::slice::from_raw_parts(base, n);
        match super::process_instruction(ctx.program_id_unchecked(), accounts, ctx.instruction_data_unchecked()) {
            Ok(()) => 0,
            Err(e) => e as u64,
        }
    }

    pinocchio::no_allocator!();
    pinocchio::nostd_panic_handler!();
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/// VGPV: 2 hr human minimum between actions; 3 strikes and the action fails.
pub const VGPV_MIN_SECONDS_PER_ACT: i64 = 7_200;
pub const VGPV_MAX_VELOCITY_STRIKES: u8 = 3;

pub const PROOF_SEED: &[u8] = b"proof_cache";

pub const TOKEN_PROGRAM: Address = Address::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]); // TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
pub const SYSTEM_PROGRAM: Address = Address::new_from_array([0; 32]);

/// Owner of the 15% team and 10% dev fee token accounts. Pinned on-chain so
/// a funder cannot route the published fee split to their own accounts.
pub const TEAM_WALLET: Address = Address::new_from_array([
    199, 249, 18, 123, 71, 65, 244, 7, 224, 1, 161, 150, 188, 148, 217, 61, 182, 105, 175, 161, 104,
    91, 67, 177, 82, 187, 244, 86, 213, 53, 181, 150,
]); // ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m
pub const DEV_WALLET: Address = TEAM_WALLET;

/// Rent-exempt minimum = (128 + len) * 3480 lamports/byte-year * 2 years.
const fn rent(len: u64) -> u64 {
    (128 + len) * 6960
}
/// Longest vesting schedule (seconds). Keeps the vesting math exact in u64.
pub const MAX_DURATION: u64 = u32::MAX as u64;

// Stream account layout (tag 1, 189 bytes). Created by the client with
// owner = this program and zeroed data; tag 0 means "not initialised yet".
pub const STREAM_TAG: u8 = 1;
pub const STREAM_LEN: usize = 189;
const S_AUTHORITY: usize = 1;
const S_BENEFICIARY: usize = 33;
const S_MINT: usize = 65;
const S_TOTAL: usize = 97;
const S_WITHDRAWN: usize = 105;
const S_START: usize = 113;
const S_CLIFF: usize = 121;
const S_END: usize = 129;
const S_ID: usize = 137;
const S_LAST: usize = 145;
const S_CANCELLED: usize = 153;
const S_BUMP: usize = 154;
const S_STRIKES: usize = 155;
const S_VAULT: usize = 156;

// ProofCache account layout (tag 2, 77 bytes).
pub const PROOF_TAG: u8 = 2;
pub const PROOF_LEN: usize = 77;
const P_SCHEDULE: usize = 1;
const P_PLAYER: usize = 33;
const P_LAST: usize = 65;
const P_COHORT: usize = 73;
const P_TIER: usize = 74;
const P_STRIKES: usize = 75;
const P_BUMP: usize = 76;

// SPL token account layout (165 bytes).
const TA_LEN: usize = 165;
const TA_OWNER: usize = 32;
const TA_DELEGATE_TAG: usize = 72;
const TA_STATE: usize = 108;
const TA_CLOSE_TAG: usize = 129;

// Error codes (custom program error). 6000-6008 match the Anchor program.
pub const E_ZERO_AMOUNT: u32 = 6000;
pub const E_TIME_RANGE: u32 = 6001;
pub const E_CLIFF: u32 = 6002;
pub const E_NOTHING: u32 = 6003;
pub const E_UNAUTHORIZED: u32 = 6004;
pub const E_CANCELLED: u32 = 6005;
pub const E_OVERFLOW: u32 = 6006;
pub const E_VELOCITY: u32 = 6007;
pub const E_TIER: u32 = 6008;
pub const E_BAD_IX: u32 = 6009;
pub const E_BAD_ACCOUNT: u32 = 6010;

type R = Result<(), u32>;

// ─── Raw memory helpers (callers guarantee bounds) ─────────────────────────────

/// Pointer to data of known length.
#[derive(Clone, Copy)]
struct D(*mut u8);

impl D {
    #[inline(always)]
    fn u64(self, o: usize) -> u64 {
        unsafe { core::ptr::read_unaligned(self.0.add(o) as *const u64) }
    }
    #[inline(always)]
    fn i64(self, o: usize) -> i64 {
        self.u64(o) as i64
    }
    #[inline(always)]
    fn u32(self, o: usize) -> u32 {
        unsafe { core::ptr::read_unaligned(self.0.add(o) as *const u32) }
    }
    #[inline(always)]
    fn set(self, o: usize, v: u64) {
        unsafe { core::ptr::write_unaligned(self.0.add(o) as *mut u64, v) }
    }
    #[inline(always)]
    fn b(self, o: usize) -> u8 {
        unsafe { *self.0.add(o) }
    }
    #[inline(always)]
    fn set_b(self, o: usize, v: u8) {
        unsafe { *self.0.add(o) = v }
    }
    #[inline(always)]
    fn key(self, o: usize) -> &'static Address {
        unsafe { &*(self.0.add(o) as *const Address) }
    }
    #[inline(always)]
    fn set_key(self, o: usize, k: &Address) {
        unsafe { core::ptr::copy_nonoverlapping(k.as_ref().as_ptr(), self.0.add(o), 32) }
    }
    #[inline(always)]
    fn bytes(self, o: usize, n: usize) -> &'static [u8] {
        unsafe { core::slice::from_raw_parts(self.0.add(o), n) }
    }
}

/// 32-byte key equality, kept out of line (one copy instead of ten).
#[inline(never)]
fn same(a: &Address, b: &Address) -> bool {
    let (a, b) = (a.as_ref().as_ptr() as *const u64, b.as_ref().as_ptr() as *const u64);
    let mut i = 0;
    while i < 4 {
        if unsafe { core::ptr::read_unaligned(a.add(i)) != core::ptr::read_unaligned(b.add(i)) } {
            return false;
        }
        i += 1;
    }
    true
}

#[inline(always)]
fn data(acc: &AccountView) -> D {
    D(acc.data_ptr() as *mut u8)
}

/// True if `acc` is an SPL token account whose owner field is `owner`.
#[inline(never)]
fn token_owner_is(acc: &AccountView, owner: &Address) -> bool {
    is_acc(acc, &TOKEN_PROGRAM, TA_LEN) && same(data(acc).key(TA_OWNER), owner)
}

/// Err(E_UNAUTHORIZED) unless `acc` signed and is the stored key at `o`.
fn signed_as(acc: &AccountView, s: D, o: usize) -> R {
    if acc.is_signer() && same(acc.address(), s.key(o)) {
        Ok(())
    } else {
        Err(E_UNAUTHORIZED)
    }
}

/// True if `acc` is owned by `owner` and holds exactly `len` bytes.
#[inline(never)]
fn is_acc(acc: &AccountView, owner: &Address, len: usize) -> bool {
    same(acc.owner(), owner) && acc.data_len() == len
}

#[allow(deprecated)]
#[inline(never)]
fn now() -> Result<i64, u32> {
    #[cfg(target_os = "solana")]
    {
        // Clock layout: slot, epoch_start_timestamp, epoch,
        // leader_schedule_epoch, unix_timestamp (offset 32).
        let mut clock = [0i64; 5];
        if unsafe { pinocchio::syscalls::sol_get_clock_sysvar(clock.as_mut_ptr() as *mut u8) } == 0 {
            return Ok(clock[4]);
        }
    }
    Err(E_BAD_ACCOUNT)
}

/// Checks `expected` is the PDA for `seeds` (bump included).
#[inline(never)]
fn check_pda(expected: &Address, seeds: &[&[u8]], program_id: &Address) -> R {
    #[cfg(target_os = "solana")]
    {
        let mut out = [0u8; 32];
        let rc = unsafe {
            pinocchio::syscalls::sol_create_program_address(
                seeds.as_ptr() as *const u8,
                seeds.len() as u64,
                program_id.as_ref().as_ptr(),
                out.as_mut_ptr(),
            )
        };
        if rc == 0 && same(unsafe { &*(out.as_ptr() as *const Address) }, expected) {
            return Ok(());
        }
    }
    #[cfg(not(target_os = "solana"))]
    let _ = (expected, seeds, program_id);
    Err(E_BAD_ACCOUNT)
}

/// Linear vesting with optional cliff (start <= cliff <= end and
/// end - start <= MAX_DURATION, both enforced at creation).
#[inline(never)]
fn unlocked(s: D, now: i64) -> u64 {
    let (total, start, end) = (s.u64(S_TOTAL), s.i64(S_START), s.i64(S_END));
    if now < s.i64(S_CLIFF) {
        return 0;
    }
    if now >= end {
        return total;
    }
    // total * elapsed / dur, exact without u128: dur and elapsed < 2^32, so
    // (total % dur) * elapsed < 2^64 and (total / dur) * elapsed <= total.
    let (dur, el) = ((end - start) as u64, (now - start) as u64);
    match (total.checked_div(dur), total.checked_rem(dur)) {
        (Some(q), Some(r)) => q * el + r * el / dur,
        _ => total,
    }
}

// ─── CPIs ──────────────────────────────────────────────────────────────────────

/// `amount * pct / 100`, exact and overflow-free for pct <= 100.
fn pct(amount: u64, pct: u64) -> u64 {
    amount / 100 * pct + amount % 100 * pct / 100
}

/// Invokes `program` with up to three accounts. A failing CPI aborts the
/// transaction, so there is nothing to return.
#[inline(never)]
fn invoke(program: &Address, data: &[u8], metas: &[InstructionAccount], accs: &[&AccountView], signer: &[Signer]) {
    let mut cpi: [core::mem::MaybeUninit<CpiAccount>; 3] = [const { core::mem::MaybeUninit::uninit() }; 3];
    let base = cpi.as_mut_ptr() as *mut CpiAccount;
    let mut i = 0;
    while i < accs.len() {
        // SAFETY: every call site passes at most three accounts.
        unsafe { base.add(i).write(CpiAccount::from(*accs.as_ptr().add(i))) };
        i += 1;
    }
    let ix = InstructionView { program_id: program, data, accounts: metas };
    // SAFETY: the first accs.len() slots are initialised; no account data
    // borrow is held across the CPI.
    unsafe { invoke_signed_unchecked(&ix, core::slice::from_raw_parts(base, accs.len()), signer) };
}

/// SPL Token `Transfer` (3). Skips zero amounts.
#[inline(never)]
fn transfer(from: &AccountView, to: &AccountView, auth: &AccountView, amount: u64, signer: &[Signer]) {
    if amount == 0 {
        return;
    }
    let mut d = [3u8; 9];
    D(d.as_mut_ptr()).set(1, amount);
    invoke(
        &TOKEN_PROGRAM,
        &d,
        &[
            InstructionAccount::writable(from.address()),
            InstructionAccount::writable(to.address()),
            InstructionAccount::readonly_signer(auth.address()),
        ],
        &[from, to, auth],
        signer,
    );
}

/// Creates a PDA owned by this program. Works even when someone pre-funded
/// the address (transfer shortfall, allocate, assign), so nobody can block
/// a PDA by sending SOL to it first.
fn create_pda(payer: &AccountView, target: &AccountView, space: u64, owner: &Address, signer: &[Signer]) {
    let mut d = [0u8; 36];
    let p = D(d.as_mut_ptr());
    let need = rent(space).saturating_sub(target.lamports());
    if need > 0 {
        p.set_b(0, 2);
        p.set(4, need);
        invoke(
            &SYSTEM_PROGRAM,
            unsafe { d.get_unchecked(..12) },
            &[InstructionAccount::writable_signer(payer.address()), InstructionAccount::writable(target.address())],
            &[payer, target],
            &[],
        );
    }
    let meta = [InstructionAccount::writable_signer(target.address())];
    p.set_b(0, 8);
    p.set(4, space);
    invoke(&SYSTEM_PROGRAM, unsafe { d.get_unchecked(..12) }, &meta, &[target], signer);
    p.set_b(0, 1);
    p.set_key(4, owner);
    invoke(&SYSTEM_PROGRAM, &d, &meta, &[target], signer);
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

pub fn process_instruction(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> R {
    let d = D(data.as_ptr() as *mut u8);
    match (data.len(), accounts) {
        (42, [authority, beneficiary, stream, vault, authority_ata, token]) if d.b(0) == 0 => {
            create_stream(program_id, authority, beneficiary, stream, vault, authority_ata, token, d)
        }
        (1, [beneficiary, stream, vault_auth, vault, beneficiary_ata, token]) if d.b(0) == 1 => {
            withdraw(program_id, beneficiary, stream, vault_auth, vault, beneficiary_ata, token)
        }
        (9, [funder, stream, vault, funder_ata, team_ata, dev_ata, referral_ata, token]) if d.b(0) == 2 => {
            fund_vault(program_id, funder, stream, vault, funder_ata, team_ata, dev_ata, referral_ata, token, d.u64(1))
        }
        (4, [admin, stream, player, proof, system]) if d.b(0) == 3 => {
            update_proof(program_id, admin, stream, player, proof, system, d.b(1), d.b(2), d.b(3))
        }
        (1, [authority, stream, vault_auth, vault, authority_ata, beneficiary_ata, token]) if d.b(0) == 4 => {
            cancel(program_id, authority, stream, vault_auth, vault, authority_ata, beneficiary_ata, token)
        }
        _ => Err(E_BAD_IX),
    }
}

// ─── Instructions ──────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn create_stream(
    program_id: &Address,
    authority: &AccountView,
    beneficiary: &AccountView,
    stream: &AccountView,
    vault: &AccountView,
    authority_ata: &AccountView,
    token: &AccountView,
    a: D,
) -> R {
    let (amount, start, cliff, end) = (a.u64(9), a.i64(17), a.i64(25), a.i64(33));
    if !authority.is_signer() || !same(token.address(), &TOKEN_PROGRAM) {
        return Err(E_BAD_ACCOUNT);
    }
    if amount == 0 {
        return Err(E_ZERO_AMOUNT);
    }
    if end <= start || end.wrapping_sub(start) as u64 > MAX_DURATION {
        return Err(E_TIME_RANGE);
    }
    let cliff = if cliff == 0 { start } else { cliff };
    if cliff < start || cliff > end {
        return Err(E_CLIFF);
    }
    // Stream: client-created, owned by us, zeroed (never initialised).
    let s = data(stream);
    if !is_acc(stream, program_id, STREAM_LEN) || s.b(0) != 0 {
        return Err(E_BAD_ACCOUNT);
    }
    // Vault: an initialised token account whose owner is the stream's PDA,
    // with no delegate and no close authority, so only this program can
    // ever move or close it.
    let v = data(vault);
    if !is_acc(vault, &TOKEN_PROGRAM, TA_LEN)
        || v.b(TA_STATE) != 1
        || v.u32(TA_DELEGATE_TAG) != 0
        || v.u32(TA_CLOSE_TAG) != 0
    {
        return Err(E_BAD_ACCOUNT);
    }
    check_pda(v.key(TA_OWNER), &[stream.address().as_ref(), a.bytes(41, 1)], program_id)?;

    s.set_b(0, STREAM_TAG);
    s.set_key(S_AUTHORITY, authority.address());
    s.set_key(S_BENEFICIARY, beneficiary.address());
    s.set_key(S_MINT, v.key(0));
    s.set_key(S_VAULT, vault.address());
    s.set(S_TOTAL, amount);
    s.set(S_START, start as u64);
    s.set(S_CLIFF, cliff as u64);
    s.set(S_END, end as u64);
    s.set(S_ID, a.u64(1));
    s.set(S_LAST, start as u64);
    s.set_b(S_BUMP, a.b(41));

    // Token program enforces that authority_ata has the vault's mint.
    transfer(authority_ata, vault, authority, amount, &[]);
    Ok(())
}

/// Validates the token program, the stream and its vault; rejects
/// cancelled streams.
#[inline(never)]
fn open_stream(program_id: &Address, stream: &AccountView, vault: &AccountView, token: &AccountView) -> Result<D, u32> {
    let s = data(stream);
    if !same(token.address(), &TOKEN_PROGRAM)
        || !is_acc(stream, program_id, STREAM_LEN)
        || s.b(0) != STREAM_TAG
        || !same(vault.address(), s.key(S_VAULT))
    {
        return Err(E_BAD_ACCOUNT);
    }
    if s.b(S_CANCELLED) != 0 {
        return Err(E_CANCELLED);
    }
    Ok(s)
}

/// Pays `amount` out of the vault, signed by the vault-authority PDA
/// `[stream, bump]`. A wrong `vault_auth` account simply fails the CPI.
#[inline(never)]
fn pay_out(s: D, stream: &AccountView, vault_auth: &AccountView, vault: &AccountView, to: &AccountView, amount: u64) {
    let seeds = [Seed::from(stream.address().as_ref()), Seed::from(s.bytes(S_BUMP, 1))];
    transfer(vault, to, vault_auth, amount, &[Signer::from(&seeds)]);
}

fn withdraw(
    program_id: &Address,
    beneficiary: &AccountView,
    stream: &AccountView,
    vault_auth: &AccountView,
    vault: &AccountView,
    beneficiary_ata: &AccountView,
    token: &AccountView,
) -> R {
    let s = open_stream(program_id, stream, vault, token)?;
    signed_as(beneficiary, s, S_BENEFICIARY)?;
    let now = now()?;
    let withdrawn = s.u64(S_WITHDRAWN);
    let available = unlocked(s, now).saturating_sub(withdrawn);
    if available == 0 {
        return Err(E_NOTHING);
    }
    // VGPV: withdrawals faster than the human threshold earn a strike.
    let last = s.i64(S_LAST);
    if last > 0 && now.saturating_sub(last) < VGPV_MIN_SECONDS_PER_ACT {
        let strikes = s.b(S_STRIKES) + 1;
        if strikes >= VGPV_MAX_VELOCITY_STRIKES {
            return Err(E_VELOCITY);
        }
        s.set_b(S_STRIKES, strikes);
    }
    s.set(S_LAST, now as u64);
    s.set(S_WITHDRAWN, withdrawn + available); // <= total
    pay_out(s, stream, vault_auth, vault, beneficiary_ata, available);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn fund_vault(
    program_id: &Address,
    funder: &AccountView,
    stream: &AccountView,
    vault: &AccountView,
    funder_ata: &AccountView,
    team_ata: &AccountView,
    dev_ata: &AccountView,
    referral_ata: &AccountView,
    token: &AccountView,
    amount: u64,
) -> R {
    if amount == 0 {
        return Err(E_ZERO_AMOUNT);
    }
    let s = open_stream(program_id, stream, vault, token)?;
    if !token_owner_is(team_ata, &TEAM_WALLET) || !token_owner_is(dev_ata, &DEV_WALLET) {
        return Err(E_UNAUTHORIZED);
    }
    // Floor each share; the rounding dust goes to the vault (70% + dust).
    let (team, dev, referral) = (pct(amount, 15), pct(amount, 10), pct(amount, 5));
    let to_vault = amount - team - dev - referral;
    s.set(S_TOTAL, s.u64(S_TOTAL).checked_add(to_vault).ok_or(E_OVERFLOW)?);
    // Token program checks the funder signature and that every account
    // shares the vault's mint.
    transfer(funder_ata, vault, funder, to_vault, &[]);
    transfer(funder_ata, team_ata, funder, team, &[]);
    transfer(funder_ata, dev_ata, funder, dev, &[]);
    transfer(funder_ata, referral_ata, funder, referral, &[]);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn update_proof(
    program_id: &Address,
    admin: &AccountView,
    stream: &AccountView,
    player: &AccountView,
    proof: &AccountView,
    system: &AccountView,
    cohort: u8,
    tier: u8,
    bump: u8,
) -> R {
    let s = data(stream);
    if !is_acc(stream, program_id, STREAM_LEN)
        || s.b(0) != STREAM_TAG
        || !same(system.address(), &SYSTEM_PROGRAM)
    {
        return Err(E_BAD_ACCOUNT);
    }
    signed_as(admin, s, S_AUTHORITY)?;
    if tier > 2 {
        return Err(E_TIER);
    }
    let now = now()?;
    let p = data(proof);
    if !same(proof.owner(), program_id) {
        // First proof for this (stream, player): create the cache.
        let bump = [bump];
        let (sk, pk) = (stream.address().as_ref(), player.address().as_ref());
        check_pda(proof.address(), &[PROOF_SEED, sk, pk, &bump], program_id)?;
        let seeds = [Seed::from(PROOF_SEED), Seed::from(sk), Seed::from(pk), Seed::from(&bump)];
        create_pda(admin, proof, PROOF_LEN as u64, program_id, &[Signer::from(&seeds)]);
        let p = data(proof);
        p.set_b(0, PROOF_TAG);
        p.set_key(P_SCHEDULE, stream.address());
        p.set_key(P_PLAYER, player.address());
        p.set_b(P_BUMP, bump[0]);
    } else {
        // Existing cache must belong to this (stream, player) pair.
        if proof.data_len() != PROOF_LEN
            || p.b(0) != PROOF_TAG
            || !same(p.key(P_SCHEDULE), stream.address())
            || !same(p.key(P_PLAYER), player.address())
        {
            return Err(E_BAD_ACCOUNT);
        }
        // VGPV: proofs faster than the human threshold earn a strike.
        if now.saturating_sub(p.i64(P_LAST)) < VGPV_MIN_SECONDS_PER_ACT {
            let strikes = p.b(P_STRIKES) + 1;
            if strikes >= VGPV_MAX_VELOCITY_STRIKES {
                return Err(E_VELOCITY);
            }
            p.set_b(P_STRIKES, strikes);
        }
    }
    let p = data(proof);
    p.set_b(P_COHORT, cohort);
    p.set_b(P_TIER, tier);
    p.set(P_LAST, now as u64);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn cancel(
    program_id: &Address,
    authority: &AccountView,
    stream: &AccountView,
    vault_auth: &AccountView,
    vault: &AccountView,
    authority_ata: &AccountView,
    beneficiary_ata: &AccountView,
    token: &AccountView,
) -> R {
    let s = open_stream(program_id, stream, vault, token)?;
    signed_as(authority, s, S_AUTHORITY)?;
    // The vested share must reach the real beneficiary: check the token
    // account's owner field.
    if !token_owner_is(beneficiary_ata, s.key(S_BENEFICIARY)) {
        return Err(E_UNAUTHORIZED);
    }
    let vested = unlocked(s, now()?);
    let to_beneficiary = vested.saturating_sub(s.u64(S_WITHDRAWN));
    let to_creator = s.u64(S_TOTAL).saturating_sub(vested);
    s.set_b(S_CANCELLED, 1);
    pay_out(s, stream, vault_auth, vault, beneficiary_ata, to_beneficiary);
    pay_out(s, stream, vault_auth, vault, authority_ata, to_creator);
    Ok(())
}
