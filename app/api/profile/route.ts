import { NextRequest, NextResponse } from 'next/server';
import { getUser, setUser } from '@/lib/store';
import { verifySig } from '@/lib/sig';
import { adventureConfigured, adventureLevel } from '@/lib/adventure/db';

// Solana base58 address: 32–44 chars, no 0/O/I/l
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: NextRequest) {
  const addr = req.nextUrl.searchParams.get('addr') ?? '';
  if (!SOLANA_ADDR_RE.test(addr)) {
    return NextResponse.json({ error: 'invalid addr' }, { status: 400 });
  }
  const user = { ...(await getUser(addr)) };
  // Level progress lives in Postgres (lib/adventure/db.ts); KV is legacy.
  if (adventureConfigured()) {
    try {
      const lvl = await adventureLevel(addr);
      if (lvl && lvl > (user.currentLevel ?? 0)) user.currentLevel = lvl;
    } catch { /* fall back to the KV copy */ }
  }
  return NextResponse.json(user);
}

export async function POST(req: NextRequest) {
  let input: { addr?: unknown; patch?: unknown; sig?: unknown };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const { addr, sig } = input ?? {};
    const patch = input?.patch as Record<string, unknown> | undefined;
    if (!addr || !patch || !sig) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }
    if (typeof patch !== 'object' || Array.isArray(patch)) {
      return NextResponse.json({ error: 'patch must be an object' }, { status: 400 });
    }
    if (typeof sig !== 'string') {
      return NextResponse.json({ error: 'invalid sig' }, { status: 400 });
    }
    if (typeof addr !== 'string' || !SOLANA_ADDR_RE.test(addr)) {
      return NextResponse.json({ error: 'invalid addr' }, { status: 400 });
    }
    const ok = await verifySig(addr, JSON.stringify(patch), sig);
    if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 403 });

    const ALLOWED = ['displayName', 'avatarId', 'language', 'theme'];
    const clean: Record<string, unknown> = {};
    for (const k of ALLOWED) if (k in patch) clean[k] = patch[k];
    await setUser(addr, clean as Parameters<typeof setUser>[1]);
    return NextResponse.json({ ok: true, patch: clean });
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
