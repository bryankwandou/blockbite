/**
 * Daily seeds and tray dealing for Ranked.
 *
 * Every day (UTC) has one secret seed, derived from RANKED_SECRET. Before the
 * day starts anyone can read sha256(seed); after it ends the seed itself is
 * published, so anyone can check the commitment and re-deal every tray.
 *
 * Each run deals from its own seed, runSeed(daily seed, run id), so what
 * attempt 1 saw says nothing about the pieces of attempt 2 or of another wallet. The run id
 * is random, the daily seed secret until the day is over, so nobody can
 * compute a run's trays ahead; after the reveal, (seed, run id, log) re-deals
 * every tray exactly.
 *
 * `trayFor` and `commitment` are safe to run anywhere (the public verifier
 * uses them with a revealed seed). `dailySeed` needs RANKED_SECRET and must
 * only ever run on the server.
 */

import { createHash, createHmac } from 'node:crypto';
import { PIECES, type Tray } from './rules';

const TOTAL_WEIGHT = PIECES.reduce((s, p) => s + p.weight, 0);

/** UTC calendar day, YYYY-MM-DD. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDay(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(d + 'T00:00:00Z');
  // Date.parse gives NaN for month 13 / day 00 and dayOf would throw a RangeError (a 500) on it.
  return Number.isFinite(ms) && dayOf(ms) === d;
}

/**
 * A run scores on the day it started and may keep placing this long after
 * that day ends, so a run opened at 23:58 is not cut off at midnight. Must
 * stay below the seed reveal margin (/api/ranked/day) and RESULTS_GRACE_MS.
 */
export const PLAY_GRACE_MS = 5 * 60_000;

/** True while a run of `day` still accepts placements at `now`. */
export function runOpen(day: string, now: number): boolean {
  return now < Date.parse(day + 'T00:00:00Z') + 86_400_000 + PLAY_GRACE_MS;
}

/** Server-only: the secret seed for `day`, 32 bytes hex. */
export function dailySeed(day: string): string {
  const secret = process.env.RANKED_SECRET;
  if (!secret || secret.length < 32) throw new Error('RANKED_SECRET is not configured');
  return createHmac('sha256', secret).update(`blockbite:ranked:seed:${day}`).digest('hex');
}

/** sha256 of the seed bytes; published before the day starts. */
export function commitment(seedHex: string): string {
  return createHash('sha256').update(Buffer.from(seedHex, 'hex')).digest('hex');
}

/** A run's own seed; derive it on the server only until the daily seed is revealed. */
export function runSeed(seedHex: string, runId: string): string {
  return createHmac('sha256', Buffer.from(seedHex, 'hex')).update(`run:${runId}`).digest('hex');
}

function pick(u32: number): number {
  let r = (u32 / 2 ** 32) * TOTAL_WEIGHT;
  for (let i = 0; i < PIECES.length; i++) {
    r -= PIECES[i].weight;
    if (r < 0) return i;
  }
  return PIECES.length - 1;
}

/** The three pieces dealt at a given position of a run (`seedHex` = runSeed). */
export function trayFor(seedHex: string, boardHex: string, moves: number): Tray {
  const h = createHmac('sha256', Buffer.from(seedHex, 'hex')).update(`tray:${boardHex}:${moves}`).digest();
  return [pick(h.readUInt32BE(0)), pick(h.readUInt32BE(4)), pick(h.readUInt32BE(8))];
}
