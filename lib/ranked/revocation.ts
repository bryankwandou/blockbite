/**
 * Session revocation store (server only).
 *
 * Two tiny Postgres tables, created idempotently like auth_nonces:
 *   session_revocations(sid, expires_at)    one row per logged-out token; pruned once the token would have expired anyway
 *   session_not_before(wallet, not_before)  "log out everywhere": tokens issued before this instant are dead
 *
 * The DB is injectable (`Query`) so the logic is testable without Postgres.
 * Every function throws if the database is down; callers fail closed.
 */
import { neon } from '@neondatabase/serverless';

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const REV = `${SCHEMA}.session_revocations`;
const NB = `${SCHEMA}.session_not_before`;

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
    s.query(`CREATE TABLE IF NOT EXISTS ${REV} (sid text PRIMARY KEY, expires_at timestamptz NOT NULL)`),
    s.query(`CREATE INDEX IF NOT EXISTS session_revocations_expires ON ${REV} (expires_at)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${NB} (wallet text PRIMARY KEY, not_before bigint NOT NULL)`),
  ]);
}

const defaultQuery: Query = async (text, params) => {
  await (ready ??= ensure().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params as never[])) as Record<string, unknown>[];
};

/** Pure: is a session with this issue time dead, given the stored state? */
export function isDead(iat: number, state: { revoked: boolean; notBefore: number | null }): boolean {
  return state.revoked || (state.notBefore !== null && iat < state.notBefore);
}

export async function isSessionRevoked(
  s: { wallet: string; sid: string; iat: number },
  q: Query = defaultQuery,
): Promise<boolean> {
  const rows = await q(
    `SELECT EXISTS(SELECT 1 FROM ${REV} WHERE sid = $1) AS revoked,
            (SELECT not_before FROM ${NB} WHERE wallet = $2) AS nb`,
    [s.sid, s.wallet],
  );
  const r = rows[0] ?? {};
  const nb = r.nb === null || r.nb === undefined ? null : Number(r.nb);
  return isDead(s.iat, { revoked: r.revoked === true, notBefore: nb });
}

/** Revokes one session until it would have expired anyway. */
export async function revokeSession(sid: string, expMs: number, q: Query = defaultQuery): Promise<void> {
  if (Math.random() < 0.1) await q(`DELETE FROM ${REV} WHERE expires_at < now()`).catch(() => undefined);
  await q(
    `INSERT INTO ${REV} (sid, expires_at) VALUES ($1, to_timestamp($2 / 1000.0)) ON CONFLICT (sid) DO NOTHING`,
    [sid, expMs],
  );
}

/** Kills every session of `wallet` issued before `now`. Never moves backwards. */
export async function revokeAll(wallet: string, now = Date.now(), q: Query = defaultQuery, ttlMs = 12 * 60 * 60 * 1000): Promise<void> {
  // A not_before older than the session TTL protects nothing (all such tokens expired); drop those rows.
  if (Math.random() < 0.1) await q(`DELETE FROM ${NB} WHERE not_before < $1`, [now - ttlMs]).catch(() => undefined);
  await q(
    `INSERT INTO ${NB} (wallet, not_before) VALUES ($1, $2)
     ON CONFLICT (wallet) DO UPDATE SET not_before = GREATEST(${NB}.not_before, EXCLUDED.not_before)`,
    [wallet, now],
  );
}
