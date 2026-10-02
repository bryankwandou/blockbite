/**
 * Daily seeds and tray dealing for Ranked.
 *
 * Every day (UTC) has one secret seed, derived from RANKED_SECRET. Before the
 * day starts anyone can read sha256(seed); after it ends the seed itself is
 * published, so anyone can check the commitment and re-deal every tray.
 *
 * A tray depends only on (seed, board, placements so far): two players who
 * reach the same position on the same day get the same pieces.
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
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && dayOf(Date.parse(d + 'T00:00:00Z')) === d;
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

function pick(u32: number): number {
  let r = (u32 / 2 ** 32) * TOTAL_WEIGHT;
  for (let i = 0; i < PIECES.length; i++) {
    r -= PIECES[i].weight;
    if (r < 0) return i;
  }
  return PIECES.length - 1;
}

/** The three pieces dealt at a given position. */
export function trayFor(seedHex: string, boardHex: string, moves: number): Tray {
  const h = createHmac('sha256', Buffer.from(seedHex, 'hex')).update(`tray:${boardHex}:${moves}`).digest();
  return [pick(h.readUInt32BE(0)), pick(h.readUInt32BE(4)), pick(h.readUInt32BE(8))];
}
