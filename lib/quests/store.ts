/**
 * Quest storage. Neon Postgres when blockbite_DATABASE_URL / RANKED_DATABASE_URL
 * is set (tables qst_quests, qst_completions); otherwise Vercel KV, and
 * otherwise an in-memory Map. Production has no KV, so without the database
 * every quest lived in one serverless instance's memory and was lost.
 *
 * KV layout (fallback only):
 *   quests              hash    quest_id → Quest
 *   quest_completions   hash    `${quest_id}:${wallet}` → Completion
 *
 * Same fallback pattern as waitlist-kv: a Map<string, T> survives within
 * a single warm Lambda; cold start = empty if KV is not configured.
 */

export type QuestType =
  | 'follow'     // social follow (manual review for Phase 0)
  | 'onchain'    // on-chain SPL balance check
  | 'gameplay'   // reach level X in-game
  | 'referral'   // refer N users
  | 'custom';    // arbitrary, admin reviews

export type CompletionStatus = 'pending' | 'approved' | 'rejected';

export interface Quest {
  id:                string;       // uuid
  adminWallet:       string;       // creator
  title:             string;
  description:       string;
  type:              QuestType;
  rewardLabel:       string;       // human-readable reward — "+50 pts", "Tier boost", "100 USDC"
  maxCompletions:    number;       // 0 = unlimited
  expiresAt:         number | null;
  createdAt:         number;
  active:            boolean;
}

export interface QuestCompletion {
  questId:     string;
  wallet:      string;
  status:      CompletionStatus;
  proof:       string;             // user-supplied proof text (link, screenshot URL)
  submittedAt: number;
  reviewedAt?: number;
}

import { neon } from '@neondatabase/serverless';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const QUESTS = `${SCHEMA}.qst_quests`;
const COMPS  = `${SCHEMA}.qst_completions`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

function dbConfigured(): boolean {
  return Boolean(process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL);
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
    await s.query(`CREATE TABLE IF NOT EXISTS ${QUESTS} (
      id text PRIMARY KEY,
      admin_wallet text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      type text NOT NULL,
      reward_label text NOT NULL,
      max_completions integer NOT NULL DEFAULT 0,
      expires_at bigint,
      created_at bigint NOT NULL,
      active boolean NOT NULL DEFAULT true)`);
    await s.query(`CREATE TABLE IF NOT EXISTS ${COMPS} (
      quest_id text NOT NULL,
      wallet text NOT NULL,
      status text NOT NULL,
      proof text NOT NULL,
      submitted_at bigint NOT NULL,
      reviewed_at bigint,
      PRIMARY KEY (quest_id, wallet))`);
  })().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

type QuestRow = {
  id: string; admin_wallet: string; title: string; description: string; type: string;
  reward_label: string; max_completions: number | string; expires_at: string | number | null;
  created_at: string | number; active: boolean;
};
type CompRow = {
  quest_id: string; wallet: string; status: string; proof: string;
  submitted_at: string | number; reviewed_at: string | number | null;
};

const toQuest = (r: QuestRow): Quest => ({
  id: r.id,
  adminWallet: r.admin_wallet,
  title: r.title,
  description: r.description,
  type: r.type as QuestType,
  rewardLabel: r.reward_label,
  maxCompletions: Number(r.max_completions),
  expiresAt: r.expires_at == null ? null : Number(r.expires_at),
  createdAt: Number(r.created_at),
  active: r.active,
});

const toComp = (r: CompRow): QuestCompletion => {
  const c: QuestCompletion = {
    questId: r.quest_id,
    wallet: r.wallet,
    status: r.status as CompletionStatus,
    proof: r.proof,
    submittedAt: Number(r.submitted_at),
  };
  if (r.reviewed_at != null) c.reviewedAt = Number(r.reviewed_at);
  return c;
};

// ── In-memory fallback ─────────────────────────────────────────────
const MEM_QUESTS:      Map<string, Quest>           = new Map();
const MEM_COMPLETIONS: Map<string, QuestCompletion> = new Map();
const compKey = (questId: string, wallet: string) => `${questId}:${wallet}`;

// ── KV access (graceful if unavailable) ────────────────────────────
// @vercel/kv reads KV_REST_API_URL + KV_REST_API_TOKEN lazily on first call.
// If those env vars are missing in production, every kv operation throws
// — we want to fall back to the in-memory Map silently instead of
// surfacing 500s. So we additionally probe the env vars before returning
// the kv client.
async function kv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    const mod = await import('@vercel/kv');
    return mod.kv;
  } catch { return null; }
}

// ── Quest CRUD ─────────────────────────────────────────────────────
export async function createQuest(quest: Quest): Promise<void> {
  if (dbConfigured()) {
    await q(`INSERT INTO ${QUESTS} (id, admin_wallet, title, description, type, reward_label, max_completions, expires_at, created_at, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET admin_wallet = EXCLUDED.admin_wallet, title = EXCLUDED.title,
        description = EXCLUDED.description, type = EXCLUDED.type, reward_label = EXCLUDED.reward_label,
        max_completions = EXCLUDED.max_completions, expires_at = EXCLUDED.expires_at,
        created_at = EXCLUDED.created_at, active = EXCLUDED.active`,
      [quest.id, quest.adminWallet, quest.title, quest.description, quest.type, quest.rewardLabel,
       quest.maxCompletions, quest.expiresAt, quest.createdAt, quest.active]);
    return;
  }
  MEM_QUESTS.set(quest.id, quest);
  const db = await kv();
  if (db) await db.hset('bb:quests', { [quest.id]: JSON.stringify(quest) });
}

export async function listQuests(): Promise<Quest[]> {
  if (dbConfigured()) {
    return (await q<QuestRow>(`SELECT * FROM ${QUESTS} ORDER BY created_at DESC`)).map(toQuest);
  }
  const db = await kv();
  if (db) {
    try {
      const all = await db.hgetall<Record<string, string>>('bb:quests');
      if (all) {
        return Object.values(all).map((v) => typeof v === 'string' ? JSON.parse(v) : v);
      }
    } catch { /* fall through */ }
  }
  return Array.from(MEM_QUESTS.values());
}

export async function getQuest(id: string): Promise<Quest | null> {
  if (dbConfigured()) {
    const rows = await q<QuestRow>(`SELECT * FROM ${QUESTS} WHERE id = $1`, [id]);
    return rows[0] ? toQuest(rows[0]) : null;
  }
  const db = await kv();
  if (db) {
    try {
      const v = await db.hget<string>('bb:quests', id);
      if (v) return typeof v === 'string' ? JSON.parse(v) : v;
    } catch { /* fall through */ }
  }
  return MEM_QUESTS.get(id) ?? null;
}

export async function setQuestActive(id: string, active: boolean): Promise<boolean> {
  const q = await getQuest(id);
  if (!q) return false;
  q.active = active;
  await createQuest(q);
  return true;
}

// ── Completions ────────────────────────────────────────────────────
export async function submitCompletion(c: QuestCompletion): Promise<void> {
  if (dbConfigured()) {
    await q(`INSERT INTO ${COMPS} (quest_id, wallet, status, proof, submitted_at, reviewed_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (quest_id, wallet) DO UPDATE SET status = EXCLUDED.status, proof = EXCLUDED.proof,
        submitted_at = EXCLUDED.submitted_at, reviewed_at = EXCLUDED.reviewed_at`,
      [c.questId, c.wallet, c.status, c.proof, c.submittedAt, c.reviewedAt ?? null]);
    return;
  }
  const k = compKey(c.questId, c.wallet);
  MEM_COMPLETIONS.set(k, c);
  const db = await kv();
  if (db) await db.hset('bb:quest_completions', { [k]: JSON.stringify(c) });
}

export async function getCompletion(questId: string, wallet: string): Promise<QuestCompletion | null> {
  if (dbConfigured()) {
    const rows = await q<CompRow>(`SELECT * FROM ${COMPS} WHERE quest_id = $1 AND wallet = $2`, [questId, wallet]);
    return rows[0] ? toComp(rows[0]) : null;
  }
  const k = compKey(questId, wallet);
  const db = await kv();
  if (db) {
    try {
      const v = await db.hget<string>('bb:quest_completions', k);
      if (v) return typeof v === 'string' ? JSON.parse(v) : v;
    } catch { /* fall through */ }
  }
  return MEM_COMPLETIONS.get(k) ?? null;
}

export async function listCompletionsForQuest(questId: string): Promise<QuestCompletion[]> {
  if (dbConfigured()) {
    return (await q<CompRow>(`SELECT * FROM ${COMPS} WHERE quest_id = $1 ORDER BY submitted_at`, [questId])).map(toComp);
  }
  const db = await kv();
  let all: Record<string, string> | null = null;
  if (db) {
    try { all = await db.hgetall<Record<string, string>>('bb:quest_completions'); }
    catch { /* fall through */ }
  }
  const src = all
    ? Object.entries(all).map(([k, v]) => [k, typeof v === 'string' ? JSON.parse(v) : v] as [string, QuestCompletion])
    : Array.from(MEM_COMPLETIONS.entries());
  return src.filter(([k]) => k.startsWith(`${questId}:`)).map(([, v]) => v);
}

export async function listCompletionsForWallet(wallet: string): Promise<QuestCompletion[]> {
  if (dbConfigured()) {
    return (await q<CompRow>(`SELECT * FROM ${COMPS} WHERE wallet = $1 ORDER BY submitted_at`, [wallet])).map(toComp);
  }
  const db = await kv();
  let all: Record<string, string> | null = null;
  if (db) {
    try { all = await db.hgetall<Record<string, string>>('bb:quest_completions'); }
    catch { /* fall through */ }
  }
  const src = all
    ? Object.entries(all).map(([k, v]) => [k, typeof v === 'string' ? JSON.parse(v) : v] as [string, QuestCompletion])
    : Array.from(MEM_COMPLETIONS.entries());
  return src.filter(([k]) => k.endsWith(`:${wallet}`)).map(([, v]) => v);
}

export async function reviewCompletion(questId: string, wallet: string, approve: boolean): Promise<boolean> {
  const c = await getCompletion(questId, wallet);
  if (!c) return false;
  c.status     = approve ? 'approved' : 'rejected';
  c.reviewedAt = Date.now();
  await submitCompletion(c);
  return true;
}
