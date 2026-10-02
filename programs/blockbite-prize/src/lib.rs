//! BlockBite prize payouts (Pinocchio).
//!
//! Holds nothing itself: the prize vault is the USDC associated token account
//! of the PDA `["vault"]`, so only this program can move it. Ticket purchases
//! pay 70% straight into that account.
//!
//! After each Ranked period the server (POSTER hot key) posts a merkle root of
//! `(index, wallet, amount)` winners. The root can only promise USDC the vault
//! actually holds and has not promised to earlier rounds (`reserved`).
//! For 24 hours the team's cold wallet (VETO) can block a round. After that,
//! anyone can trigger a winner's payout with a merkle proof; the USDC goes to
//! a token account owned by the winning wallet, never elsewhere. After 90 days
//! unclaimed amounts are released back to the pool and the round account can
//! be closed, returning its rent to the poster.
//!
//! Size budget: the program never creates accounts. The poster creates the
//! state and each round with `CreateAccountWithSeed(base = POSTER, owner =
//! this program)` in the same transaction as PostResults; the program only
//! accepts zeroed accounts it owns. Seeds: "state", and the round id in
//! decimal ("20261001"). Round ids only move forward (one high-water mark for
//! day ids, one for month ids), so a round id can never be posted twice, even
//! after its account was closed. One exception: vetoing the latest round of
//! its kind puts the mark back to where it was before that round, so corrected
//! results can be posted under the same id (and a bogus far-future id posted
//! with a stolen POSTER key stops blocking real ones).
//!
//! Instruction data = 1-byte discriminator + fixed little-endian fields.
//!   0 PostResults  round_id u64, root [32], total u64, count u32
//!       accounts: poster (signer), state, round, vault
//!   1 Veto         —   accounts: veto (signer), state, round
//!   2 Claim        index u32, amount u64, proof [32] × n (n bounded by the
//!                  transaction size; trailing bytes short of 32 are ignored)
//!       accounts: state, round, vault, vault_authority, winner_token, token
//!   3 Close        —   accounts: state, round, poster (writable)
//!
//! Leaf  = sha256(index u32 ‖ amount u64 ‖ round_id u64 ‖ wallet)   52 bytes
//! Node  = sha256(0x01 ‖ min(a, b) ‖ max(a, b))                      65 bytes
//! (sorted pairs, no directions; the lengths differ, so a leaf can never pass
//! as a node)
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

    /// Lazy entrypoint: up to six distinct accounts read straight from the input buffer.
    #[no_mangle]
    pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
        let mut ctx = InstructionContext::new_unchecked(input);
        let n = ctx.remaining() as usize;
        if n > 6 {
            return super::E_BAD_IX as u64;
        }
        let mut accounts: [core::mem::MaybeUninit<AccountView>; 6] =
            [const { core::mem::MaybeUninit::uninit() }; 6];
        let base = accounts.as_mut_ptr() as *mut AccountView;
        let mut i = 0;
        while i < n {
            // No instruction takes the same account twice.
            let MaybeAccount::Account(view) = ctx.next_account_unchecked() else {
                return super::E_BAD_IX as u64;
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

/// Team cold wallet that may block a round during the veto window.
pub const VETO: Address = Address::new_from_array([
    199, 249, 18, 123, 71, 65, 244, 7, 224, 1, 161, 150, 188, 148, 217, 61, 182, 105, 175, 161, 104,
    91, 67, 177, 82, 187, 244, 86, 213, 53, 181, 150,
]); // ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m

/// Server hot key that posts results.
pub const POSTER: Address = Address::new_from_array([
    151, 222, 19, 35, 170, 190, 128, 76, 134, 195, 146, 173, 237, 57, 31, 147, 17, 153, 217, 56, 191,
    26, 68, 106, 248, 79, 141, 11, 13, 224, 197, 164,
]); // BDpy3zpYyQRvz8bFngN6tCvx2rk6PA1jtsWSo5FfoBgP

/// USDC associated token account of the vault PDA `["vault", 254]`.
pub const VAULT: Address = Address::new_from_array([
    124, 169, 29, 201, 229, 5, 219, 33, 195, 134, 85, 128, 233, 138, 243, 105, 222, 215, 67, 233, 20,
    37, 179, 133, 127, 229, 202, 194, 37, 188, 207, 82,
]); // 9Pd853EqvQgNc2t4wAsXmTcynsEj6LWpKQiAbprpMqmj
pub const VAULT_SEED: &[u8] = b"vault";
pub const VAULT_BUMP: u8 = 254;

/// Global state: `create_with_seed(POSTER, "state", program)`.
pub const STATE: Address = Address::new_from_array([
    213, 243, 152, 243, 61, 226, 102, 110, 79, 54, 240, 160, 64, 132, 24, 154, 155, 183, 107, 203,
    171, 79, 180, 179, 238, 228, 235, 22, 143, 208, 193, 190,
]); // FQBH9iXq8MqEh1pBcwa7kfEoYTXXyvxKSQgJz56BdBZw
pub const STATE_SEED: &str = "state";

pub const TOKEN_PROGRAM: Address = Address::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]); // TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

pub const VETO_WINDOW: i64 = 86_400;
pub const CLAIM_WINDOW: i64 = 90 * 86_400;

// State layout (24 bytes, all zero when created).
pub const STATE_LEN: usize = 24;
const ST_LAST_DAY: usize = 0;
pub const ST_RESERVED: usize = 8;
const ST_LAST_MONTH: usize = 16;

// Round layout (tag 2, 80 bytes + claim bitmap of ceil(count / 8) bytes).
pub const ROUND_TAG: u8 = 2;
pub const ROUND_HDR: usize = 80;
const R_VETOED: usize = 1;
const R_COUNT: usize = 4;
const R_ID: usize = 8;
const R_ROOT: usize = 16;
const R_TOTAL: usize = 48;
const R_CLAIMED: usize = 56;
const R_POSTED: usize = 64;
/// The high-water mark before this round was posted (restored by a veto).
const R_PREV: usize = 72;

// SPL token account layout (165 bytes).
const TA_LEN: usize = 165;
const TA_OWNER: usize = 32;
const TA_AMOUNT: usize = 64;

pub const E_UNAUTHORIZED: u32 = 6000;
pub const E_BAD_ACCOUNT: u32 = 6001;
pub const E_BAD_IX: u32 = 6002;
pub const E_INSUFFICIENT: u32 = 6003;
pub const E_EXISTS: u32 = 6004;
pub const E_WINDOW: u32 = 6005;
pub const E_VETOED: u32 = 6006;
pub const E_CLAIMED: u32 = 6007;
pub const E_PROOF: u32 = 6008;
pub const E_OPEN: u32 = 6009;
pub const E_ARGS: u32 = 6010;

type R = Result<(), u32>;

// ─── Raw memory helpers (callers guarantee bounds) ─────────────────────────────

#[derive(Clone, Copy)]
struct D(*mut u8);

impl D {
    #[inline(always)]
    fn u64(self, o: usize) -> u64 {
        unsafe { core::ptr::read_unaligned(self.0.add(o) as *const u64) }
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
    fn set_u32(self, o: usize, v: u32) {
        unsafe { core::ptr::write_unaligned(self.0.add(o) as *mut u32, v) }
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
    fn bytes(self, o: usize, n: usize) -> &'static [u8] {
        unsafe { core::slice::from_raw_parts(self.0.add(o), n) }
    }
    #[inline(always)]
    fn copy_in(self, o: usize, src: &[u8]) {
        unsafe { core::ptr::copy_nonoverlapping(src.as_ptr(), self.0.add(o), src.len()) }
    }
}

/// 32-byte equality, out of line.
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

#[allow(deprecated)]
#[inline(never)]
fn now() -> i64 {
    // The clock syscall cannot fail.
    #[allow(unused_mut)]
    let mut clock = core::mem::MaybeUninit::<[i64; 5]>::uninit();
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_get_clock_sysvar(clock.as_mut_ptr() as *mut u8);
    }
    // SAFETY: filled by the syscall.
    unsafe { clock.assume_init()[4] }
}

/// sha256 of the concatenation of `parts`.
#[inline(never)]
fn sha256(parts: &[&[u8]], out: *mut u8) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_sha256(parts.as_ptr() as *const u8, parts.len() as u64, out);
    }
    #[cfg(not(target_os = "solana"))]
    let _ = (parts, out);
}

/// Byte-wise a <= b.
#[inline(never)]
fn le(a: &[u8], b: &[u8]) -> bool {
    let mut i = 0;
    while i < 32 {
        let (x, y) = unsafe { (*a.as_ptr().add(i), *b.as_ptr().add(i)) };
        if x != y {
            return x < y;
        }
        i += 1;
    }
    true
}

/// The state account, validated (created zeroed by the poster). No owner
/// check: STATE = create_with_seed(POSTER, "state", this program), so only a
/// POSTER-signed system instruction can give it data, and only with this
/// program as owner. (Every caller also writes it, which the runtime refuses
/// for an account this program does not own.)
#[inline(never)]
fn state_of(state: &AccountView) -> D {
    if !same(state.address(), &STATE) || state.data_len() != STATE_LEN {
        return D(core::ptr::null_mut());
    }
    data(state)
}

/// A posted round owned by this program.
#[inline(never)]
fn round_of(program_id: &Address, round: &AccountView) -> D {
    let r = data(round);
    if !same(round.owner(), program_id) || round.data_len() < ROUND_HDR || r.b(0) != ROUND_TAG {
        return D(core::ptr::null_mut());
    }
    r
}

/// State and round of Veto, Claim and Close.
#[inline(always)]
fn pair(program_id: &Address, state: &AccountView, round: &AccountView) -> Result<(D, D), u32> {
    let (s, r) = (state_of(state), round_of(program_id, round));
    if s.0.is_null() || r.0.is_null() {
        return Err(E_BAD_ACCOUNT);
    }
    Ok((s, r))
}

/// State offset of the high-water mark for `id`: month ids are YYYYMM00.
#[inline(always)]
fn mark_of(id: u64) -> usize {
    if id % 100 == 0 { ST_LAST_MONTH } else { ST_LAST_DAY }
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

pub fn process_instruction(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> R {
    // Every arm checks the length; with no data at all none matches, and the
    // byte read is still inside the input buffer (the program id follows).
    let d = D(data.as_ptr() as *mut u8);
    let len = data.len();
    match (d.b(0), accounts) {
        (0, [poster, state, round, vault]) if len == 53 => post(program_id, poster, state, round, vault, d),
        (1, [cold, state, round]) if len == 1 => veto(program_id, cold, state, round),
        (2, [state, round, vault, vault_auth, winner, _token]) if len >= 13 => {
            claim(program_id, state, round, vault, vault_auth, winner, d, (len - 13) / 32)
        }
        (3, [state, round, poster]) if len == 1 => close(program_id, state, round, poster),
        _ => Err(E_BAD_IX),
    }
}

// ─── Instructions ──────────────────────────────────────────────────────────────

fn post(program_id: &Address, poster: &AccountView, state: &AccountView, round: &AccountView, vault: &AccountView, a: D) -> R {
    if !poster.is_signer() || !same(poster.address(), &POSTER) {
        return Err(E_UNAUTHORIZED);
    }
    // VAULT is an associated token address: only the token program can own a
    // 165-byte account there.
    if !same(vault.address(), &VAULT) || vault.data_len() != TA_LEN {
        return Err(E_BAD_ACCOUNT);
    }
    // `count` is bounded by the round's size, which the poster pays for.
    let (id, total, count) = (a.u64(1), a.u64(41), a.u32(49));
    let s = state_of(state);
    let r = data(round);
    if s.0.is_null() {
        return Err(E_BAD_ACCOUNT);
    }
    if !same(round.owner(), program_id) || round.data_len() != ROUND_HDR + (count as usize + 7) / 8 || r.b(0) != 0 {
        return Err(E_BAD_ACCOUNT);
    }
    // Day ids (YYYYMMDD) and month ids (YYYYMM00) each only move forward.
    let (mark, prev) = (mark_of(id), s.u64(mark_of(id)));
    if id <= prev {
        return Err(E_EXISTS);
    }
    // Never promise more than the vault holds beyond earlier promises.
    let reserved = s.u64(ST_RESERVED).checked_add(total).ok_or(E_INSUFFICIENT)?;
    if reserved > data(vault).u64(TA_AMOUNT) {
        return Err(E_INSUFFICIENT);
    }
    s.set(mark, id);
    s.set(ST_RESERVED, reserved);

    r.set_b(0, ROUND_TAG);
    r.set_u32(R_COUNT, count);
    r.set(R_ID, id);
    r.copy_in(R_ROOT, a.bytes(9, 32));
    r.set(R_TOTAL, total);
    r.set(R_POSTED, now() as u64);
    r.set(R_PREV, prev);
    Ok(())
}

fn veto(program_id: &Address, cold: &AccountView, state: &AccountView, round: &AccountView) -> R {
    if !cold.is_signer() || !same(cold.address(), &VETO) {
        return Err(E_UNAUTHORIZED);
    }
    let (s, r) = pair(program_id, state, round)?;
    if r.b(R_VETOED) != 0 {
        return Err(E_VETOED);
    }
    if now() >= r.u64(R_POSTED) as i64 + VETO_WINDOW {
        return Err(E_WINDOW);
    }
    r.set_b(R_VETOED, 1);
    // No claim is possible inside the window, so the whole total is released.
    s.set(ST_RESERVED, s.u64(ST_RESERVED).wrapping_sub(r.u64(R_TOTAL) - r.u64(R_CLAIMED)));
    // The latest round of its kind gives its id back. An older one does not:
    // that would reopen ids posted after it.
    let (id, mark) = (r.u64(R_ID), mark_of(r.u64(R_ID)));
    if s.u64(mark) == id {
        s.set(mark, r.u64(R_PREV));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn claim(
    program_id: &Address,
    state: &AccountView,
    round: &AccountView,
    vault: &AccountView,
    vault_auth: &AccountView,
    winner: &AccountView,
    a: D,
    n: usize,
) -> R {
    let (s, r) = pair(program_id, state, round)?;
    // The transfer CPI always targets TOKEN_PROGRAM, so the 6th account needs
    // no check; the winner account must be a token account it owns.
    if !same(vault.address(), &VAULT) || !same(winner.owner(), &TOKEN_PROGRAM) || winner.data_len() != TA_LEN {
        return Err(E_BAD_ACCOUNT);
    }
    if r.b(R_VETOED) != 0 {
        return Err(E_VETOED);
    }
    let (now, posted) = (now(), r.u64(R_POSTED) as i64);
    if now < posted + VETO_WINDOW || now >= posted + CLAIM_WINDOW {
        return Err(E_WINDOW);
    }
    let (index, amount) = (a.u32(1), a.u64(5));
    if index >= r.u32(R_COUNT) {
        return Err(E_ARGS);
    }
    let (byte, bit) = (ROUND_HDR + (index as usize >> 3), 1u8 << (index & 7));
    if r.b(byte) & bit != 0 {
        return Err(E_CLAIMED);
    }

    // The payout goes to the token account's owner, so the leaf is checked
    // against that wallet.
    let wallet = data(winner).key(TA_OWNER);
    // Two buffers, swapped each level: `h` holds the current hash.
    let mut bufs = [[0u8; 32]; 2];
    let (mut h, mut t) = (bufs[0].as_mut_ptr(), bufs[1].as_mut_ptr());
    sha256(&[a.bytes(1, 12), r.bytes(R_ID, 8), wallet.as_ref()], h);
    let mut i = 0;
    while i < n {
        let p = a.bytes(13 + i * 32, 32);
        let cur = D(h).bytes(0, 32);
        let (x, y) = if le(cur, p) { (cur, p) } else { (p, cur) };
        sha256(&[&[1u8], x, y], t);
        core::mem::swap(&mut h, &mut t);
        i += 1;
    }
    if !same(D(h).key(0), r.key(R_ROOT)) {
        return Err(E_PROOF);
    }

    let claimed = r.u64(R_CLAIMED).checked_add(amount).ok_or(E_ARGS)?;
    if claimed > r.u64(R_TOTAL) {
        return Err(E_ARGS);
    }
    r.set(R_CLAIMED, claimed);
    r.set_b(byte, r.b(byte) | bit);
    s.set(ST_RESERVED, s.u64(ST_RESERVED).wrapping_sub(amount));

    // SPL Token Transfer { amount }, signed by the vault PDA. A failed
    // transfer fails the whole transaction, so nothing above is kept.
    let mut d = [3u8; 9];
    D(d.as_mut_ptr()).set(1, amount);
    let bump = [VAULT_BUMP];
    let seeds = [Seed::from(VAULT_SEED), Seed::from(&bump)];
    let metas = [
        InstructionAccount::writable(vault.address()),
        InstructionAccount::writable(winner.address()),
        InstructionAccount::readonly_signer(vault_auth.address()),
    ];
    let ix = InstructionView { program_id: &TOKEN_PROGRAM, data: &d, accounts: &metas };
    let accs = [CpiAccount::from(vault), CpiAccount::from(winner), CpiAccount::from(vault_auth)];
    // SAFETY: no borrow of these accounts' data is alive across the call.
    unsafe { invoke_signed_unchecked(&ix, &accs, &[Signer::from(&seeds)]) };
    Ok(())
}

fn close(program_id: &Address, state: &AccountView, round: &AccountView, poster: &AccountView) -> R {
    if !same(poster.address(), &POSTER) {
        return Err(E_BAD_ACCOUNT);
    }
    let (s, r) = pair(program_id, state, round)?;
    let (total, claimed, vetoed) = (r.u64(R_TOTAL), r.u64(R_CLAIMED), r.b(R_VETOED) != 0);
    let expired = now() >= r.u64(R_POSTED) as i64 + CLAIM_WINDOW;
    if !vetoed && claimed < total && !expired {
        return Err(E_OPEN);
    }
    if !vetoed {
        // Unclaimed prizes go back to the pool.
        s.set(ST_RESERVED, s.u64(ST_RESERVED).wrapping_sub(total - claimed));
    }
    // SAFETY: fresh views of the same runtime accounts, used only below.
    let (mut p, mut rd) = unsafe {
        (AccountView::new_unchecked(poster.account_ptr() as *mut _), AccountView::new_unchecked(round.account_ptr() as *mut _))
    };
    p.set_lamports(p.lamports() + rd.lamports());
    // SAFETY: no borrow of the round's data is alive. Zeroes owner, lamports
    // and data length: deleted at the end of the transaction, and even if
    // someone sends it lamports in the same transaction it is left an empty
    // system account, never a program-owned leftover.
    unsafe { rd.close_unchecked() };
    Ok(())
}
