import { NextResponse } from 'next/server';
import { kvGetCount, kvSeedFromExternal } from '@/lib/waitlist-kv';
import { sbGetCount, supabaseReady } from '@/lib/supabase-rest';
import { memGetCount } from '@/lib/waitlist-store';

// Must be force-dynamic — GET routes are statically cached at build time by default.
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };

  try {
    // 1. Primary source of truth: Supabase — same store the dashboard reads,
    //    guarantees public count and admin dashboard always show the same number.
    if (supabaseReady()) {
      const sbCount = await sbGetCount();
      if (sbCount !== null) {
        // Keep KV counter in sync so future KV-only reads are accurate
        if (sbCount > 0) await kvSeedFromExternal(sbCount);
        return NextResponse.json({ count: sbCount, source: 'supabase' }, { headers });
      }
    }

    // 2. Fallback: Vercel KV (use set cardinality — never drifts from incr bugs)
    const kvCount = await kvGetCount();
    if (kvCount !== null) {
      return NextResponse.json({ count: kvCount, source: 'kv' }, { headers });
    }

    // 3. Last resort: in-memory (always 0 on cold start, but never hides real data)
    return NextResponse.json({ count: memGetCount(), source: 'memory' }, { headers });
  } catch {
    return NextResponse.json({ count: 0, source: 'error' }, { headers });
  }
}
