/**
 * Waitlist + partnership leads in Neon Postgres, server only. Same connection
 * and schema as lib/adventure/db.ts. Used when Supabase is not configured.
 */
import { neon } from '@neondatabase/serverless';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const EMAILS = `${SCHEMA}.wl_emails`;
const LEADS = `${SCHEMA}.wl_partner_leads`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

// Legacy corporation store: public.waitlist(email, created_at) on DATABASE_URL,
// reached over Neon's SQL-over-HTTP endpoint exactly like the corporation site.
function corpConn(): string { return process.env.DATABASE_URL ?? ''; }
function corpHost(): string {
  return process.env.NEON_SQL_HOST ?? (corpConn().match(/@([^/]+)\//)?.[1] ?? '');
}
function corpReady(): boolean { return Boolean(corpConn() && corpHost()); }

async function corpSql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(`https://${corpHost()}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': corpConn() },
    body: JSON.stringify({ query, params }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`neon:${res.status}:${(await res.text()).slice(0, 200)}`);
  return (await res.json()).rows as T[];
}

export function waitlistDbConfigured(): boolean {
  return corpReady() || Boolean(process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL);
}

function sql(): Sql {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('database is not configured');
  client ??= neon(url);
  return client;
}

async function q<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  await (ready ??= (async () => {
    const s = sql();
    await s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await s.query(`CREATE TABLE IF NOT EXISTS ${EMAILS} (
      email text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await s.query(`CREATE TABLE IF NOT EXISTS ${LEADS} (
      id bigserial PRIMARY KEY,
      email text NOT NULL,
      project text NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now())`);
  })().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

const norm = (e: string) => e.toLowerCase().trim();

/** 'inserted' | 'duplicate' | 'error:<reason>' */
export async function dbAddEmail(email: string): Promise<'inserted' | 'duplicate' | string> {
  if (corpReady()) {
    try {
      const rows = await corpSql(
        'INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING email',
        [email],
      );
      return rows.length === 0 ? 'duplicate' : 'inserted';
    } catch (e) {
      return `error:neon:${String(e).slice(0, 160)}`;
    }
  }
  try {
    const rows = await q(
      `INSERT INTO ${EMAILS} (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING email`,
      [norm(email)],
    );
    return rows.length > 0 ? 'inserted' : 'duplicate';
  } catch (e) {
    return `error:exception:${String(e).slice(0, 120)}`;
  }
}

export async function dbGetCount(): Promise<number | null> {
  if (corpReady()) {
    try {
      const rows = await corpSql<{ n: number }>('SELECT count(*)::int AS n FROM waitlist');
      return Number(rows[0]?.n ?? 0);
    } catch {
      return null;
    }
  }
  try {
    const rows = await q<{ n: string }>(`SELECT count(*)::text AS n FROM ${EMAILS}`);
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

export type DbEntry = { email: string; created_at: string };

export async function dbGetList(): Promise<DbEntry[] | null> {
  if (corpReady()) {
    try {
      const rows = await corpSql<{ email: string; created_at: string }>(
        'SELECT email, created_at FROM waitlist ORDER BY created_at DESC LIMIT 50000',
      );
      return rows.map((r) => ({ email: r.email, created_at: new Date(r.created_at).toISOString() }));
    } catch {
      return null;
    }
  }
  try {
    const rows = await q<{ email: string; created_at: Date | string }>(
      `SELECT email, created_at FROM ${EMAILS} ORDER BY created_at DESC LIMIT 50000`,
    );
    return rows.map((r) => ({ email: r.email, created_at: new Date(r.created_at).toISOString() }));
  } catch {
    return null;
  }
}

export async function dbDeleteEmail(email: string): Promise<boolean> {
  if (corpReady()) {
    try {
      await corpSql('DELETE FROM waitlist WHERE email = $1', [email]);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await q(`DELETE FROM ${EMAILS} WHERE email = $1`, [norm(email)]);
    return true;
  } catch {
    return false;
  }
}

export async function dbAddLead(l: { email: string; project: string; notes?: string | null }): Promise<boolean> {
  try {
    await q(`INSERT INTO ${LEADS} (email, project, notes) VALUES ($1, $2, $3)`, [
      norm(l.email), l.project, l.notes ?? null,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function dbGetLeads(limit = 100): Promise<
  { id: string; email: string; project: string; notes: string | null; created_at: string }[]
> {
  const rows = await q<{ id: string; email: string; project: string; notes: string | null; created_at: Date | string }>(
    `SELECT id::text AS id, email, project, notes, created_at FROM ${LEADS} ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}
