/**
 * POST /api/quests/[id]/submit
 * Body: { wallet: string, proof: string }
 *
 * User submits proof for a quest completion. Status starts as 'pending'
 * until admin reviews.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getQuest, getCompletion, submitCompletion, listCompletionsForQuest,
  type QuestCompletion,
} from '@/lib/quests/store';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const quest = await getQuest(id);
  if (!quest)         return NextResponse.json({ error: 'Quest not found' }, { status: 404 });
  if (!quest.active)  return NextResponse.json({ error: 'Quest no longer active' }, { status: 410 });
  if (quest.expiresAt && quest.expiresAt < Date.now())
                       return NextResponse.json({ error: 'Quest expired' }, { status: 410 });

  let body: { wallet?: string; proof?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const wallet = (body.wallet ?? '').trim();
  const proof  = (body.proof ?? '').trim();
  if (!wallet)                 return NextResponse.json({ error: 'wallet required' }, { status: 400 });
  if (!proof || proof.length > 2000) return NextResponse.json({ error: 'proof required (max 2000)' }, { status: 400 });

  // Idempotency: if a pending submission already exists, return it.
  // If approved, refuse re-submission. If rejected, allow another attempt.
  const existing = await getCompletion(id, wallet);
  if (existing && existing.status === 'approved')
    return NextResponse.json({ completion: existing, already: true });
  if (existing && existing.status === 'pending')
    return NextResponse.json({ completion: existing, already: true });

  // Max completions check (only for unlimited or under cap)
  if (quest.maxCompletions > 0) {
    const all = await listCompletionsForQuest(id);
    const approved = all.filter((c) => c.status === 'approved').length;
    if (approved >= quest.maxCompletions)
      return NextResponse.json({ error: 'Quest reached max completions' }, { status: 409 });
  }

  const completion: QuestCompletion = {
    questId:     id,
    wallet,
    status:      'pending',
    proof,
    submittedAt: Date.now(),
  };
  await submitCompletion(completion);
  return NextResponse.json({ completion }, { status: 201 });
}
