/**
 * Ranked mode constants shared by the browser and the server.
 * Addresses are fixed to Solana mainnet, like lib/solana/config.ts.
 */

import { PublicKey } from '@solana/web3.js';

/** blockbite-prize program (holds the prize vault; see programs/blockbite-prize). */
export const PRIZE_PROGRAM_ID = new PublicKey('4Yf8EjRGsEFshuvcMwvtCYAc6VqKcX4XNJ4qbdMAXUpn');
/** PDA ["vault"] of the prize program; owner of the vault token account. */
export const VAULT_AUTHORITY = new PublicKey('5Dpz47x9QHTdbgYWD6KA2tanbKbag7xp4c2NoVEV13DS');
/** USDC associated token account of VAULT_AUTHORITY. Only the program can move funds out. */
export const PRIZE_VAULT = new PublicKey('9Pd853EqvQgNc2t4wAsXmTcynsEj6LWpKQiAbprpMqmj');
/** USDC associated token account of TEAM_WALLET. */
export const TEAM_USDC_ACCOUNT = new PublicKey('9pNzhqU19MXiTaBWhEZNCMuamwuSu498Vu7S2eJ2CAdL');

/**
 * Ticket sales stay closed until the prize program is deployed and verified
 * on mainnet: before that, nothing could ever pay prizes out of the vault.
 */
export const RANKED_SALES_OPEN = true;

/** USDC has 6 decimals: every amount in ranked code is an integer count of base units. */
export const USDC_DECIMALS = 6;
/** 1 USDC in base units. */
export const USDC_UNIT = 1_000_000n;
/** Basis-point denominator (100%). */
export const BPS_DENOMINATOR = 10_000;

/** One ranked attempt, in USDC base units (6 decimals). */
export const TICKET_PRICE = 1_000_000;
/** Per ticket: 70% to the prize vault, 5% to the referrer (if any), the rest to the team. */
export const VAULT_SHARE = 700_000;
export const REFERRAL_SHARE = 50_000;
export const TEAM_SHARE = TICKET_PRICE - VAULT_SHARE; // 300_000 minus the referral share when paid
export const MAX_TICKETS_PER_PURCHASE = 30;

/** Ranked attempts allowed per wallet per UTC day. */
export const MAX_ATTEMPTS_PER_DAY = 3;

// ── Prizes ──────────────────────────────────────────────────────────
// Whole-period rules; lib/ranked/results.ts turns them into payouts.

/** Monthly score = sum of a wallet's this-many best daily scores in the month. */
export const MONTHLY_BEST_DAYS = 10;
/** Share of a UTC day's vault inflow paid to that day's top 10 (basis points); the rest funds the month. */
export const DAILY_POOL_BPS = 4000;
/** The month's share (60%); informational — monthlyPool() takes "inflow minus the day pool" so rounding goes to the month. */
export const MONTHLY_POOL_BPS = BPS_DENOMINATOR - DAILY_POOL_BPS;
/** A period's results are final this long after it ends (same margin /api/ranked/day waits to reveal a seed). */
export const RESULTS_GRACE_MS = 10 * 60_000;
/** Mirror of the program's MAX_PROOF: most sibling hashes a Claim accepts. */
export const PRIZE_MAX_PROOF = 16;
/** Commitment at which a ticket purchase is read before crediting (a finalized block cannot be rolled back). */
export const PURCHASE_COMMITMENT = 'finalized' as const;
/** Top-10 payout curve in basis points of a round's pool (sums to 10000). */
export const PAYOUT_CURVE_BPS = [2500, 1800, 1300, 1000, 800, 700, 600, 500, 400, 400] as const;

/** Server hot key allowed to post results (pinned in the prize program). */
export const PRIZE_POSTER = new PublicKey('BDpy3zpYyQRvz8bFngN6tCvx2rk6PA1jtsWSo5FfoBgP');
/** Prize program state, createWithSeed(PRIZE_POSTER, "state", program): USDC promised to open rounds (u64 at byte 8). */
export const PRIZE_STATE = new PublicKey('FQBH9iXq8MqEh1pBcwa7kfEoYTXXyvxKSQgJz56BdBZw');

// Mirrors of the program's constants (programs/blockbite-prize/src/lib.rs).
/** After posting, the team's cold wallet may veto a round for this long; claims open after it. */
export const PRIZE_VETO_WINDOW_S = 86_400;
/** After posting, prizes can be claimed until this much time has passed. */
export const PRIZE_CLAIM_WINDOW_S = 90 * 86_400;
/** Most winners (merkle leaves) the server puts in one round; keeps proofs within PRIZE_MAX_PROOF. */
export const PRIZE_MAX_LEAVES = 1024;

// ── Profiles ────────────────────────────────────────────────────────

/** An avatar is stored as a short slug (lib/avatars.ts ids), never as an image or URL. */
export const AVATAR_ID_RE = /^[a-z0-9-]{1,40}$/;
