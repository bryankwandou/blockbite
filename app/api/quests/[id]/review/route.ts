/**
 * POST /api/quests/[id]/review
 * Body: { adminWallet: string, wallet: string, approve: boolean }
 *
 * Admin approves or rejects a pending completion. Only the quest's
 * original adminWallet is allowed to review.
 *
 * GET /api/quests/[id]/review?adminWallet=...
 * Returns all completions for the quest (admin dashboard data source).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getQuest, reviewCompletion, listCompletionsForQuest,
} from '@/lib/quests/store';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const adminWallet = req.nextUrl.searchParams.get('adminWallet')?.trim() ?? '';
  const quest = await getQuest(id);
  if (!quest) return NextResponse.json({ error: 'Quest not found' }, { status: 404 });
  if (quest.adminWallet !== adminWallet)
    return NextResponse.json({ error: 'Not the quest admin' }, { status: 403 });

  const completions = await listCompletionsForQuest(id);
  return NextResponse.json({
    quest,
    completions: completions.sort((a, b) => b.submittedAt - a.submittedAt),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { adminWallet?: string; wallet?: string; approve?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const adminWallet = (body.adminWallet ?? '').trim();
  const wallet      = (body.wallet ?? '').trim();
  const approve     = Boolean(body.approve);
  if (!adminWallet || !wallet) return NextResponse.json({ error: 'adminWallet and wallet required' }, { status: 400 });

  const quest = await getQuest(id);
  if (!quest) return NextResponse.json({ error: 'Quest not found' }, { status: 404 });
  if (quest.adminWallet !== adminWallet)
    return NextResponse.json({ error: 'Not the quest admin' }, { status: 403 });

  const ok = await reviewCompletion(id, wallet, approve);
  if (!ok) return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
  return NextResponse.json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
