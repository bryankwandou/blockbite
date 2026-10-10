/**
 * Shared secret helpers for auth code (server only).
 *
 * safeEqual hashes both sides first, so unequal lengths and non-ASCII input
 * (where char length != byte length) can never make timingSafeEqual throw,
 * and the comparison time does not depend on the secret's length.
 *
 * consumeNonce makes a signed sign-in challenge single-use: the nonce is
 * recorded in Postgres on first successful verify and refused afterwards.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = createHash('sha256').update(a, 'utf8').digest();
  const y = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(x, y);
}

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const TABLE = `${SCHEMA}.auth_nonces`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

function sql(): Sql {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('database is not configured');
  client ??= neon(url);
  return client;
}

async function ensure(): Promise<void> {
  const s = sql();
  await s.transaction([
    s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`),
    s.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      nonce text PRIMARY KEY,
      expires_at timestamptz NOT NULL)`),
    s.query(`CREATE INDEX IF NOT EXISTS auth_nonces_expires ON ${TABLE} (expires_at)`),
  ]);
}

/**
 * Records `scope:nonce` until `expiresAtMs`. Returns true the first time,
 * false on reuse. Throws when the database is unavailable (callers fail closed).
 */
export async function consumeNonce(scope: string, nonce: string, expiresAtMs: number): Promise<boolean> {
  await (ready ??= ensure().catch((e) => { ready = null; throw e; }));
  const s = sql();
  // Expired rows can never be replayed (the challenge itself is expired), so drop them.
  if (Math.random() < 0.1) await s.query(`DELETE FROM ${TABLE} WHERE expires_at < now()`).catch(() => undefined);
  const rows = (await s.query(
    `INSERT INTO ${TABLE} (nonce, expires_at) VALUES ($1, to_timestamp($2 / 1000.0))
     ON CONFLICT (nonce) DO NOTHING RETURNING nonce`,
    [`${scope}:${nonce}`, expiresAtMs],
  )) as unknown[];
  return rows.length === 1;
}

/** Nonce line of a challenge message, or null. */
export function nonceOf(message: string): string | null {
  return /^Nonce: ([A-Za-z0-9_-]{24})$/m.exec(message)?.[1] ?? null;
}
