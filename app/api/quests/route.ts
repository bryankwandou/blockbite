/**
 * GET  /api/quests           → list active quests
 * POST /api/quests           → create quest (body: { adminWallet, title, ... })
 *
 * No wallet-signature gating for Phase 0 — admin identity is asserted by
 * the body and recorded as-is. Week 7 will add ed25519 message signing
 * + an admin allow-list keyed by Vercel env.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createQuest, listQuests, type Quest, type QuestType } from '@/lib/quests/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const all = await listQuests();
    const now = Date.now();
    const visible = all
      .filter((q) => q.active && (!q.expiresAt || q.expiresAt > now))
      .sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ quests: visible });
  } catch (e) {
    // KV misconfig in prod was returning empty 500. Honest empty state
    // is the right fallback — the in-memory map will catch up once a
    // quest is created.
    return NextResponse.json({
      quests: [],
      degraded: true,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function isValidType(t: string): t is QuestType {
  return ['follow', 'onchain', 'gameplay', 'referral', 'custom'].includes(t);
}

export async function POST(req: NextRequest) {
  let body: Partial<Quest>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { adminWallet, title, description, type, rewardLabel, maxCompletions, expiresAt } = body;
  if (!adminWallet || typeof adminWallet !== 'string') return NextResponse.json({ error: 'adminWallet required' }, { status: 400 });
  if (!title || typeof title !== 'string' || title.length > 200) return NextResponse.json({ error: 'title required (max 200)' }, { status: 400 });
  if (!description || typeof description !== 'string' || description.length > 2000) return NextResponse.json({ error: 'description required (max 2000)' }, { status: 400 });
  if (!type || !isValidType(String(type))) return NextResponse.json({ error: 'type must be one of follow/onchain/gameplay/referral/custom' }, { status: 400 });
  if (!rewardLabel || typeof rewardLabel !== 'string' || rewardLabel.length > 100) return NextResponse.json({ error: 'rewardLabel required (max 100)' }, { status: 400 });

  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const quest: Quest = {
    id,
    adminWallet,
    title:          title.trim(),
    description:    description.trim(),
    type:           type as QuestType,
    rewardLabel:    rewardLabel.trim(),
    maxCompletions: Math.max(0, Math.floor(Number(maxCompletions) || 0)),
    expiresAt:      expiresAt ? Number(expiresAt) : null,
    createdAt:      Date.now(),
    active:         true,
  };

  await createQuest(quest);
  return NextResponse.json({ quest }, { status: 201 });
}
