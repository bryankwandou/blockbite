import { NextRequest, NextResponse } from 'next/server';
import { getIP } from '@/lib/rate-limit';
import { limit } from '@/lib/versus/limit';
import { addReply, getChallenge, ID_RE } from '@/lib/versus/store';
import { checkRun } from '@/lib/versus/submit';

export const dynamic = 'force-dynamic';

/** GET → { found: false } or { found: true, challenge }. Always 200 so a dead link is not an error. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const allowed = await limit(`vs:get:${getIP(req)}`, 120, 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  if (!ID_RE.test(params.id)) return NextResponse.json({ found: false });
  try {
    const c = await getChallenge(params.id);
    return NextResponse.json(c ? { found: true, challenge: c } : { found: false });
  } catch {
    return NextResponse.json({ found: false, error: 'unavailable' });
  }
}

/** POST { name, log } → the friend's replayed score is added next to the challenger's. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const allowed = await limit(`vs:reply:${getIP(req)}`, 30, 60 * 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many tries, try again later' }, { status: 429 });
  if (!ID_RE.test(params.id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const c = await getChallenge(params.id).catch(() => null);
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { name?: unknown; log?: unknown } | null;
  const run = checkRun(c.seed, body?.name, body?.log);
  if (typeof run === 'string') return NextResponse.json({ error: run }, { status: 400 });
  const ok = await addReply(params.id, run).catch(() => false);
  if (!ok) return NextResponse.json({ error: 'Challenge is full' }, { status: 409 });
  return NextResponse.json({ ok: true, score: run.score });
}
