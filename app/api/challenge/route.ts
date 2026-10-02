import { NextRequest, NextResponse } from 'next/server';
import { getIP } from '@/lib/rate-limit';
import { limit } from '@/lib/versus/limit';
import { SEED_RE } from '@/lib/versus/deal';
import { createChallenge } from '@/lib/versus/store';
import { checkRun } from '@/lib/versus/submit';

export const dynamic = 'force-dynamic';

/** POST { seed, name, log } → { id }. For fun only: no wallet, no prizes. */
export async function POST(req: NextRequest) {
  const allowed = await limit(`vs:create:${getIP(req)}`, 10, 60 * 60_000);
  if (!allowed) return NextResponse.json({ error: 'Too many challenges, try again later' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { seed?: unknown; name?: unknown; log?: unknown } | null;
  if (!body || typeof body.seed !== 'string' || !SEED_RE.test(body.seed)) return NextResponse.json({ error: 'bad seed' }, { status: 400 });
  const run = checkRun(body.seed, body.name, body.log);
  if (typeof run === 'string') return NextResponse.json({ error: run }, { status: 400 });
  try {
    const id = await createChallenge(body.seed, run);
    return NextResponse.json({ id, score: run.score });
  } catch {
    return NextResponse.json({ error: 'Could not save the challenge' }, { status: 503 });
  }
}
