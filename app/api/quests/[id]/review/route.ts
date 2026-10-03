/**
 * POST /api/quests/[id]/review
 * Body: { wallet: string, approve: boolean }
 *
 * Admin approves or rejects a pending completion.
 *
 * GET /api/quests/[id]/review
 * Returns all completions for the quest (admin dashboard data source).
 *
 * Both need the admin console session (wallet signature + ADMIN_WALLETS).
 * The admin wallet used to come from the query/body, which anyone could
 * copy from the public quest list.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getQuest, reviewCompletion, listCompletionsForQuest,
} from '@/lib/quests/store';
import { requireRole } from '@/lib/admin/http';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = requireRole(req, 'admin');
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const quest = await getQuest(id);
  if (!quest) return NextResponse.json({ error: 'Quest not found' }, { status: 404 });

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
  const admin = requireRole(req, 'admin');
  if (admin instanceof Response) return admin;
  const { id } = await params;
  let body: { wallet?: string; approve?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const wallet  = (body.wallet ?? '').trim();
  const approve = Boolean(body.approve);
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 });

  const quest = await getQuest(id);
  if (!quest) return NextResponse.json({ error: 'Quest not found' }, { status: 404 });

  const ok = await reviewCompletion(id, wallet, approve);
  if (!ok) return NextResponse.json({ error: 'Completion not found' }, { status: 404 });
  return NextResponse.json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
