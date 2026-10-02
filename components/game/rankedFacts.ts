/**
 * Daily Ranked numbers for UI copy, read from lib/ranked/config so the text
 * can never drift from what the server and the prize program enforce.
 * Pass these as vars: t('rule_daily', { pct: RANKED.dailyPct }).
 */
import {
  DAILY_POOL_BPS, MAX_ATTEMPTS_PER_DAY, MONTHLY_BEST_DAYS, PAYOUT_CURVE_BPS,
  REFERRAL_SHARE, TICKET_PRICE, VAULT_SHARE,
} from '@/lib/ranked/config';

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export const RANKED = {
  /** Ticket price in whole USDC. */
  price: TICKET_PRICE / 1_000_000,
  attempts: MAX_ATTEMPTS_PER_DAY,
  /** Share of a day's vault intake paid to that day's top 10. */
  dailyPct: DAILY_POOL_BPS / 100,
  /** The rest of the day's intake, paid to the month's top 10. */
  monthlyPct: 100 - DAILY_POOL_BPS / 100,
  /** Monthly score = sum of this many best days. */
  bestDays: MONTHLY_BEST_DAYS,
  /** Top-10 payout curve, 1st to 10th, in percent of a round's pool. */
  curve: PAYOUT_CURVE_BPS.map((b) => b / 100),
  vaultPct: pct(VAULT_SHARE, TICKET_PRICE),
  referralPct: pct(REFERRAL_SHARE, TICKET_PRICE),
  teamPct: pct(TICKET_PRICE - VAULT_SHARE - REFERRAL_SHARE, TICKET_PRICE),
} as const;

/** Vars shared by every Ranked string that quotes a number. */
export const RANKED_VARS = {
  price: RANKED.price,
  attempts: RANKED.attempts,
  daily: RANKED.dailyPct,
  monthly: RANKED.monthlyPct,
  days: RANKED.bestDays,
  curve: RANKED.curve.join(' · '),
  vault: RANKED.vaultPct,
  team: RANKED.teamPct,
  referral: RANKED.referralPct,
};
