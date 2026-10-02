/**
 * Quest storage — Vercel KV with in-memory fallback.
 *
 * Two collections:
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
export async function createQuest(q: Quest): Promise<void> {
  MEM_QUESTS.set(q.id, q);
  const db = await kv();
  if (db) await db.hset('bb:quests', { [q.id]: JSON.stringify(q) });
}

export async function listQuests(): Promise<Quest[]> {
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
  const k = compKey(c.questId, c.wallet);
  MEM_COMPLETIONS.set(k, c);
  const db = await kv();
  if (db) await db.hset('bb:quest_completions', { [k]: JSON.stringify(c) });
}

export async function getCompletion(questId: string, wallet: string): Promise<QuestCompletion | null> {
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
