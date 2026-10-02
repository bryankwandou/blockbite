/**
 * Account recovery storage (Neon Postgres, server only). Same connection as
 * lib/ranked/db.ts. Only acct_* tables are created here; no existing table
 * is altered.
 */

import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { MIGRATION_COOLDOWN_MS, type FailureStore } from './core';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const T = {
  ids: `${SCHEMA}.acct_identities`,
  fails: `${SCHEMA}.acct_login_failures`,
  migs: `${SCHEMA}.acct_migrations`,
  wallets: `${SCHEMA}.acct_wallets`,
  passkeys: `${SCHEMA}.acct_passkeys`,
  codes: `${SCHEMA}.acct_recovery_codes`,
};

export type Provider = 'google' | 'password';
/** How a recovery session was opened. */
export type RecoveryMethod = Provider | 'passkey' | 'code';

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

export function dbConfigured(): boolean {
  return Boolean(process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL);
}

function sql(): Sql {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('Account database is not configured');
  client ??= neon(url);
  return client;
}

async function q<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  await (ready ??= migrate().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

async function migrate(): Promise<void> {
  const s = sql();
  await s.transaction([
    s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.ids} (
      id bigserial PRIMARY KEY,
      wallet text NOT NULL,
      provider text NOT NULL CHECK (provider IN ('google', 'password')),
      subject text NOT NULL,
      email text,
      password_hash text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (provider, subject),
      UNIQUE (wallet, provider))`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.fails} (
      id bigserial PRIMARY KEY,
      key text NOT NULL,
      at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE INDEX IF NOT EXISTS acct_login_failures_key_at ON ${T.fails} (key, at)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.migs} (
      id uuid PRIMARY KEY,
      from_wallet text NOT NULL,
      to_wallet text NOT NULL,
      provider text NOT NULL,
      at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE INDEX IF NOT EXISTS acct_migrations_to ON ${T.migs} (to_wallet, at)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.wallets} (
      wallet text PRIMARY KEY,
      migrated_to text NOT NULL,
      migrated_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.passkeys} (
      id bigserial PRIMARY KEY,
      wallet text NOT NULL,
      credential_id text NOT NULL UNIQUE,
      public_key text NOT NULL,
      alg int NOT NULL,
      sign_count bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz)`),
    s.query(`CREATE INDEX IF NOT EXISTS acct_passkeys_wallet ON ${T.passkeys} (wallet)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.codes} (
      id bigserial PRIMARY KEY,
      wallet text NOT NULL,
      code_hash text NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE INDEX IF NOT EXISTS acct_recovery_codes_wallet ON ${T.codes} (wallet)`),
  ]);
}

// ── Identities ──────────────────────────────────────────────────────

export interface Identity {
  wallet: string; provider: Provider; subject: string; email: string | null;
  password_hash: string | null; created_ms: number;
}
const ID_COLS = `wallet, provider, subject, email, password_hash, (extract(epoch FROM created_at) * 1000)::float8 AS created_ms`;

export async function identitiesOf(wallet: string): Promise<Identity[]> {
  return q<Identity>(`SELECT ${ID_COLS} FROM ${T.ids} WHERE wallet = $1 ORDER BY provider`, [wallet]);
}

export async function findIdentity(provider: Provider, subject: string): Promise<Identity | null> {
  const rows = await q<Identity>(`SELECT ${ID_COLS} FROM ${T.ids} WHERE provider = $1 AND subject = $2`, [provider, subject]);
  return rows[0] ?? null;
}

export type BindResult = 'ok' | 'taken' | 'already_bound' | 'migrated';

/** Binds one identity; refuses migrated wallets, a second method of the same kind, or a subject used elsewhere. */
export async function bindIdentity(p: {
  wallet: string; provider: Provider; subject: string; email: string | null; passwordHash: string | null;
}): Promise<BindResult> {
  if (await migratedTo(p.wallet)) return 'migrated';
  try {
    await q(
      `INSERT INTO ${T.ids} (wallet, provider, subject, email, password_hash) VALUES ($1, $2, $3, $4, $5)`,
      [p.wallet, p.provider, p.subject, p.email, p.passwordHash]);
    return 'ok';
  } catch (e) {
    if ((e as { code?: string }).code !== '23505') throw e;
    const mine = await q(`SELECT 1 FROM ${T.ids} WHERE wallet = $1 AND provider = $2`, [p.wallet, p.provider]);
    return mine.length ? 'already_bound' : 'taken';
  }
}

export async function unbindIdentity(wallet: string, provider: Provider): Promise<boolean> {
  const rows = await q(`DELETE FROM ${T.ids} WHERE wallet = $1 AND provider = $2 RETURNING id`, [wallet, provider]);
  return rows.length === 1;
}

// ── Passkeys ────────────────────────────────────────────────────────

export interface Passkey { id: number; wallet: string; credential_id: string; public_key: string; alg: number; sign_count: number; created_ms: number }
const PK_COLS = `id, wallet, credential_id, public_key, alg, sign_count::float8 AS sign_count, (extract(epoch FROM created_at) * 1000)::float8 AS created_ms`;

export async function passkeysOf(wallet: string): Promise<Passkey[]> {
  return q<Passkey>(`SELECT ${PK_COLS} FROM ${T.passkeys} WHERE wallet = $1 ORDER BY id`, [wallet]);
}

export async function findPasskey(credentialId: string): Promise<Passkey | null> {
  return (await q<Passkey>(`SELECT ${PK_COLS} FROM ${T.passkeys} WHERE credential_id = $1`, [credentialId]))[0] ?? null;
}

export async function addPasskey(p: { wallet: string; credentialId: string; publicKey: string; alg: number; signCount: number }): Promise<BindResult> {
  if (await migratedTo(p.wallet)) return 'migrated';
  if ((await passkeysOf(p.wallet)).length >= 10) return 'already_bound';
  try {
    await q(`INSERT INTO ${T.passkeys} (wallet, credential_id, public_key, alg, sign_count) VALUES ($1, $2, $3, $4, $5)`,
      [p.wallet, p.credentialId, p.publicKey, p.alg, p.signCount]);
    return 'ok';
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return 'taken';
    throw e;
  }
}

/** Compare-and-set so two parallel assertions cannot both pass the counter check. */
export async function bumpSignCount(id: number, from: number, to: number): Promise<boolean> {
  const rows = await q(`UPDATE ${T.passkeys} SET sign_count = $3, last_used_at = now() WHERE id = $1 AND sign_count = $2 RETURNING id`, [id, from, to]);
  return rows.length === 1;
}

export async function removePasskeys(wallet: string): Promise<number> {
  return (await q(`DELETE FROM ${T.passkeys} WHERE wallet = $1 RETURNING id`, [wallet])).length;
}

// ── Recovery codes ──────────────────────────────────────────────────

/** Replaces every code of `wallet` with the given hashes (old codes stop working). */
export async function replaceCodes(wallet: string, hashes: string[]): Promise<BindResult> {
  if (await migratedTo(wallet)) return 'migrated';
  await q('SELECT 1');
  const s = sql();
  await s.transaction([
    s.query(`DELETE FROM ${T.codes} WHERE wallet = $1`, [wallet]),
    ...hashes.map((h) => s.query(`INSERT INTO ${T.codes} (wallet, code_hash) VALUES ($1, $2)`, [wallet, h])),
  ]);
  return 'ok';
}

export async function unusedCodes(wallet: string): Promise<{ id: number; code_hash: string }[]> {
  return q(`SELECT id, code_hash FROM ${T.codes} WHERE wallet = $1 AND used_at IS NULL ORDER BY id`, [wallet]);
}

export async function codesLeft(wallet: string): Promise<number> {
  return (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${T.codes} WHERE wallet = $1 AND used_at IS NULL`, [wallet]))[0]?.n ?? 0;
}

/** Marks one code used; false if someone used it first. */
export async function useCode(id: number): Promise<boolean> {
  return (await q(`UPDATE ${T.codes} SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`, [id])).length === 1;
}

export async function removeCodes(wallet: string): Promise<number> {
  return (await q(`DELETE FROM ${T.codes} WHERE wallet = $1 RETURNING id`, [wallet])).length;
}

// ── Login failures (lockout) ────────────────────────────────────────

export const failureStore: FailureStore = {
  async count(key, sinceMs) {
    const rows = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${T.fails} WHERE key = $1 AND at > to_timestamp($2::float8 / 1000)`, [key, sinceMs]);
    return rows[0]?.n ?? 0;
  },
  async add(key, atMs) {
    await q(`INSERT INTO ${T.fails} (key, at) VALUES ($1, to_timestamp($2::float8 / 1000))`, [key, atMs]);
  },
};

// ── Migration ───────────────────────────────────────────────────────

export async function migratedTo(wallet: string): Promise<string | null> {
  const rows = await q<{ migrated_to: string }>(`SELECT migrated_to FROM ${T.wallets} WHERE wallet = $1`, [wallet]);
  return rows[0]?.migrated_to ?? null;
}

/** When `wallet` last received a migration (ms), or null. */
export async function lastMigrationInto(wallet: string): Promise<number | null> {
  const rows = await q<{ ms: number | null }>(
    `SELECT (extract(epoch FROM max(at)) * 1000)::float8 AS ms FROM ${T.migs} WHERE to_wallet = $1`, [wallet]);
  return rows[0]?.ms ?? null;
}

export type MoveResult = 'ok' | 'refused';

/**
 * Moves the identities, passkeys and recovery codes from `from` to `to` and marks `from` migrated, in one
 * transaction. The guard runs inside it: `from` not already migrated, `to`
 * has no identities and was never migrated away, and no migration into
 * `from` within the cooldown. Every later statement is gated on the guard's
 * insert, so a refused move changes nothing.
 */
export async function moveAccount(from: string, to: string, provider: RecoveryMethod): Promise<MoveResult> {
  await q('SELECT 1'); // ensure tables exist
  const id = randomUUID();
  const s = sql();
  const gate = `EXISTS (SELECT 1 FROM ${T.migs} WHERE id = $1::uuid)`;
  const res = await s.transaction([
    s.query(
      `INSERT INTO ${T.migs} (id, from_wallet, to_wallet, provider)
       SELECT $1::uuid, $2, $3, $4
       WHERE $2 <> $3
         AND NOT EXISTS (SELECT 1 FROM ${T.wallets} WHERE wallet IN ($2, $3))
         AND NOT EXISTS (SELECT 1 FROM ${T.ids} WHERE wallet = $3)
         AND NOT EXISTS (SELECT 1 FROM ${T.passkeys} WHERE wallet = $3)
         AND NOT EXISTS (SELECT 1 FROM ${T.codes} WHERE wallet = $3 AND used_at IS NULL)
         AND (EXISTS (SELECT 1 FROM ${T.ids} WHERE wallet = $2)
           OR EXISTS (SELECT 1 FROM ${T.passkeys} WHERE wallet = $2)
           OR EXISTS (SELECT 1 FROM ${T.codes} WHERE wallet = $2))
         AND NOT EXISTS (SELECT 1 FROM ${T.migs} WHERE to_wallet = $2 AND at > now() - ($5::float8 * interval '1 millisecond'))
       RETURNING id`, [id, from, to, provider, MIGRATION_COOLDOWN_MS]),
    s.query(`UPDATE ${T.ids} SET wallet = $3 WHERE wallet = $2 AND ${gate}`, [id, from, to]),
    s.query(`UPDATE ${T.passkeys} SET wallet = $3 WHERE wallet = $2 AND ${gate}`, [id, from, to]),
    s.query(`DELETE FROM ${T.codes} WHERE wallet = $3 AND ${gate}`, [id, from, to]),
    s.query(`UPDATE ${T.codes} SET wallet = $3 WHERE wallet = $2 AND ${gate}`, [id, from, to]),
    s.query(`INSERT INTO ${T.wallets} (wallet, migrated_to) SELECT $2, $3 WHERE ${gate}`, [id, from, to]),
  ]);
  return (res[0] as unknown[]).length === 1 ? 'ok' : 'refused';
}
