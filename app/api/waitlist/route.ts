import { NextRequest, NextResponse } from 'next/server';
import { sbInsertEmail, sbGetCount, supabaseReady } from '@/lib/supabase-rest';
import { memAdd } from '@/lib/waitlist-store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email } = body as { email?: string };
    if (!email || !email.includes('@') || email.length > 254) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    const normalized = email.toLowerCase().trim();

    // Primary: Supabase
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

    // Fallback: in-memory
    const added = memAdd(normalized);
    if (!added) return NextResponse.json({ ok: true, already: true, _src: 'mem-dup' }, { status: 409 });
    return NextResponse.json({ ok: true, _src: 'mem' });

  } catch (e) {
    console.error('[waitlist POST]', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
