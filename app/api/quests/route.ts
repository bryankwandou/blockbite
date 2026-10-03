/**
 * GET  /api/quests           → list active quests
 * POST /api/quests           → create quest (body: { title, ... })
 *
 * Creating needs the admin console session (wallet signature + ADMIN_WALLETS,
 * see lib/admin/session.ts); the quest's adminWallet is that signed-in wallet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createQuest, listQuests, type Quest, type QuestType } from '@/lib/quests/store';
import { requireRole } from '@/lib/admin/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const all = await listQuests();
    const now = Date.now();
    const visible = all
      .filter((q) => q.active && (!q.expiresAt || q.expiresAt > now))
      .sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ quests: visible });
  } catch {
    // KV misconfig in prod was returning empty 500. Honest empty state
    // is the right fallback (no internal error text to the public).
    return NextResponse.json({ quests: [], degraded: true });
  }
}

function isValidType(t: string): t is QuestType {
  return ['follow', 'onchain', 'gameplay', 'referral', 'custom'].includes(t);
}

export async function POST(req: NextRequest) {
  const adminWallet = requireRole(req, 'admin');
  if (adminWallet instanceof Response) return adminWallet;
  let body: Partial<Quest>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { title, description, type, rewardLabel, maxCompletions, expiresAt } = body;
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
