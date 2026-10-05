/**
 * Friend challenges (server only). Neon Postgres, same database as Ranked
 * (blockbite_DATABASE_URL / RANKED_DATABASE_URL), tables vs_challenges and
 * vs_replies. Without a database URL (local dev) it falls back to memory.
 * No wallets, no money: just a seed, a name and a server-replayed score.
 */
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';

export interface Entry { name: string; score: number; moves: number; curve: number[]; at: string }
export interface Challenge extends Entry { id: string; seed: string; replies: Entry[] }

const MAX_REPLIES = 30;
const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;
const mem: Map<string, Challenge> = ((globalThis as { __bbVs?: Map<string, Challenge> }).__bbVs ??= new Map<string, Challenge>());

function sql(): Sql | null {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) return null;
  client ??= neon(url);
  return client;
}

async function q<R = Record<string, unknown>>(s: Sql, text: string, params: unknown[] = []): Promise<R[]> {
  await (ready ??= s.transaction([
    s.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.vs_challenges (
      id text PRIMARY KEY, seed text NOT NULL, name text NOT NULL, score integer NOT NULL,
      moves integer NOT NULL, curve jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.vs_replies (
      id bigserial PRIMARY KEY, challenge_id text NOT NULL REFERENCES ${SCHEMA}.vs_challenges(id) ON DELETE CASCADE,
      name text NOT NULL, score integer NOT NULL, moves integer NOT NULL, curve jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE INDEX IF NOT EXISTS vs_replies_cid ON ${SCHEMA}.vs_replies (challenge_id, score DESC)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.vs_rate (key text NOT NULL, at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE INDEX IF NOT EXISTS vs_rate_key ON ${SCHEMA}.vs_rate (key, at)`),
  ]).then(() => undefined).catch((e) => { ready = null; throw e; }));
  return (await s.query(text, params)) as R[];
}

/** 16 random bytes, base64url: unguessable. */
export function newId(): string {
  return randomBytes(16).toString('base64url');
}
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export async function createChallenge(seed: string, e: Omit<Entry, 'at'>): Promise<string> {
  const id = newId();
  const s = sql();
  if (!s) {
    mem.set(id, { id, seed, ...e, at: new Date().toISOString(), replies: [] });
    return id;
  }
  await q(s, `INSERT INTO ${SCHEMA}.vs_challenges (id, seed, name, score, moves, curve) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, seed, e.name, e.score, e.moves, JSON.stringify(e.curve)]);
  return id;
}

export async function getChallenge(id: string): Promise<Challenge | null> {
  const s = sql();
  if (!s) return mem.get(id) ?? null;
  type Row = { id: string; seed: string; name: string; score: number; moves: number; curve: number[]; created_at: string };
  const [c] = await q<Row>(s, `SELECT * FROM ${SCHEMA}.vs_challenges WHERE id = $1`, [id]);
  if (!c) return null;
  const rs = await q<Row>(s, `SELECT name, score, moves, curve, created_at FROM ${SCHEMA}.vs_replies WHERE challenge_id = $1 ORDER BY score DESC LIMIT ${MAX_REPLIES}`, [id]);
  const ent = (r: Row): Entry => ({ name: r.name, score: r.score, moves: r.moves, curve: r.curve, at: new Date(r.created_at).toISOString() });
  return { id: c.id, seed: c.seed, ...ent(c), replies: rs.map(ent) };
}

/**
 * Records one hit for `key` and returns how many hits it has inside the window,
 * counted in the database so every server instance shares one count.
 * Returns null without a database (the caller falls back to memory).
 */
export async function countHit(key: string, windowMs: number): Promise<number | null> {
  const s = sql();
  if (!s) return null;
  const secs = Math.ceil(windowMs / 1000);
  // Old hits are pruned as we go, so the table stays small.
  const [r] = await q<{ n: number }>(s, `WITH gone AS (DELETE FROM ${SCHEMA}.vs_rate WHERE key = $1 AND at < now() - make_interval(secs => $2)),
    ins AS (INSERT INTO ${SCHEMA}.vs_rate (key) VALUES ($1))
    SELECT (count(*) + 1)::int AS n FROM ${SCHEMA}.vs_rate WHERE key = $1 AND at >= now() - make_interval(secs => $2)`, [key, secs]);
  return r.n;
}

/** Adds a reply. Returns false if the challenge is missing or full. */
export async function addReply(id: string, e: Omit<Entry, 'at'>): Promise<boolean> {
  const s = sql();
  if (!s) {
    const c = mem.get(id);
    if (!c || c.replies.length >= MAX_REPLIES) return false;
    c.replies.push({ ...e, at: new Date().toISOString() });
    c.replies.sort((a, b) => b.score - a.score);
    return true;
  }
  const rows = await q(s, `INSERT INTO ${SCHEMA}.vs_replies (challenge_id, name, score, moves, curve)
    SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM ${SCHEMA}.vs_challenges WHERE id = $1)
      AND (SELECT count(*) FROM ${SCHEMA}.vs_replies WHERE challenge_id = $1) < ${MAX_REPLIES}
    RETURNING id`, [id, e.name, e.score, e.moves, JSON.stringify(e.curve)]);
  return rows.length > 0;
}
