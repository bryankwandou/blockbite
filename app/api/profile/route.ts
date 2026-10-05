import { NextRequest, NextResponse } from 'next/server';
import { getUser, setUser } from '@/lib/store';
import { verifySig } from '@/lib/sig';
import { adventureConfigured, adventureLevel } from '@/lib/adventure/db';
import { isAvatarId } from '@/lib/avatars';
import { isLocale } from '@/lib/i18n/locales';
import { getIP, rateLimit } from '@/lib/rate-limit';

// Solana base58 address: 32–44 chars, no 0/O/I/l
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Same cap as the name input on app/profile/page.tsx (maxLength={24}).
const NAME_MAX = 24;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// Theme ids offered in settings and the navbar.
const THEMES = new Set(['light', 'dark', 'system']);

/** Returns the cleaned value, or null when the field is not acceptable. */
function validField(k: string, v: unknown): unknown {
  if (k === 'displayName') {
    if (typeof v !== 'string') return null;
    const name = v.trim();
    return name.length >= 1 && [...name].length <= NAME_MAX && !CONTROL_RE.test(name) ? name : null;
  }
  if (k === 'avatarId') return isAvatarId(v) ? v : null;
  if (k === 'language') return isLocale(v) ? v : null;
  if (k === 'theme') return typeof v === 'string' && THEMES.has(v) ? v : null;
  return null;
}

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
  const rl = await rateLimit(`profile:${getIP(req)}`, 30, 60 * 60_000).catch(() => null);
  if (rl && !rl.allowed) return NextResponse.json({ error: 'too many changes, try again later' }, { status: 429 });
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
    for (const k of ALLOWED) {
      if (!(k in patch)) continue;
      const v = validField(k, patch[k]);
      if (v === null) return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      clean[k] = v;
    }
    await setUser(addr, clean as Parameters<typeof setUser>[1]);
    return NextResponse.json({ ok: true, patch: clean });
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
