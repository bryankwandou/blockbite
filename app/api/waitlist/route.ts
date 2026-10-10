import { NextRequest, NextResponse } from 'next/server';
import { jsonObject } from '@/lib/http/body';
import { sbInsertEmail, sbGetCount, supabaseReady } from '@/lib/supabase-rest';
import { dbAddEmail, waitlistDbConfigured } from '@/lib/waitlist/db';
import { kvAddEmail, kvConfigured } from '@/lib/waitlist-kv';
import { memAdd } from '@/lib/waitlist-store';
import { getIP, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(`waitlist:${getIP(req)}`, 10, 60_000).catch(() => null);
    if (rl && !rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    const body = (await jsonObject(req)) ?? {};
    const { email } = body as { email?: unknown };
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();

    // Primary: Postgres
    if (waitlistDbConfigured()) {
      const result = await dbAddEmail(normalized);
      if (result === 'duplicate') {
        return NextResponse.json({ ok: true, already: true, _src: 'pg-dup' }, { status: 409 });
      }
      if (result === 'inserted') return NextResponse.json({ ok: true, _src: 'pg' });
      console.error('[waitlist POST] postgres insert failed:', result);
      return NextResponse.json(
        { error: 'Storage rejected the signup', detail: result },
        { status: 502 },
      );
    }

    // Second: Supabase
    if (supabaseReady()) {
      const result = await sbInsertEmail(normalized);
      if (result === 'duplicate') {
        return NextResponse.json({ ok: true, already: true, _src: 'sb-dup' }, { status: 409 });
      }
      if (result === 'inserted') {
        // Fire-and-forget KV sync — never block the response
        try {
          const { kvAddEmail, kvSeedFromExternal } = await import('@/lib/waitlist-kv');
          const kvRes = await kvAddEmail(normalized);
          if (kvRes !== 'inserted') {
            const n = await sbGetCount();
            if (n) await kvSeedFromExternal(n);
          }
        } catch { /* KV optional */ }
        return NextResponse.json({ ok: true, _src: 'sb' });
      }
      // Supabase rejected the insert — surface the real reason instead of pretending success
      console.error('[waitlist POST] supabase insert failed:', result);
      return NextResponse.json(
        { error: 'Storage rejected the signup', detail: result },
        { status: 502 },
      );
    }

    // Third: Vercel KV
    if (kvConfigured()) {
      const r = await kvAddEmail(normalized);
      if (r === 'duplicate') return NextResponse.json({ ok: true, already: true, _src: 'kv-dup' }, { status: 409 });
      if (r === 'inserted') return NextResponse.json({ ok: true, _src: 'kv' });
      // KV errored: fall through to memory
    }

    // Fallback: in-memory
    const added = memAdd(normalized);
    if (!added) return NextResponse.json({ ok: true, already: true, _src: 'mem-dup' }, { status: 409 });
    return NextResponse.json({ ok: true, _src: 'mem' });

  } catch (e) {
    console.error('[waitlist POST]', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
