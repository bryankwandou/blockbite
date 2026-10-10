import { NextRequest, NextResponse } from 'next/server';
import { jsonObject } from '@/lib/http/body';
import { getGlobal, setGlobal } from '@/lib/store';
import { getIP, rateLimit } from '@/lib/rate-limit';
import { safeEqual } from '@/lib/safeEqual';

const MIN_SECRET = 16;

/** 'ok', 'denied', or 'limited' (too many attempts from this IP). */
async function check(req: NextRequest): Promise<'ok' | 'denied' | 'limited'> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < MIN_SECRET) return 'denied';
  // Every attempt counts (a lockout that spared the right secret would not stop guessing).
  const rl = await rateLimit(`admin-secret:${getIP(req)}`, 10, 15 * 60_000).catch(() => null);
  if (rl && !rl.allowed) return 'limited';
  return safeEqual(req.headers.get('x-admin-secret') ?? '', secret) ? 'ok' : 'denied';
}

function refuse(r: 'denied' | 'limited') {
  return r === 'limited'
    ? NextResponse.json({ error: 'too many attempts' }, { status: 429, headers: { 'Retry-After': '900' } })
    : NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const r = await check(req);
  if (r !== 'ok') return refuse(r);
  return NextResponse.json(await getGlobal());
}

export async function POST(req: NextRequest) {
  const r = await check(req);
  if (r !== 'ok') return refuse(r);
  try {
    const patch = await jsonObject(req);
    if (!patch) return NextResponse.json({ error: 'expected a JSON object' }, { status: 400 });
    await setGlobal(patch);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}

function notAllowed() {
  return NextResponse.json({ error: 'method not allowed, use GET or POST' }, { status: 405, headers: { Allow: 'GET, POST' } });
}
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
