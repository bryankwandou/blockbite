import { NextRequest, NextResponse } from 'next/server';
import { sbGetList, sbGetCount, sbDeleteEmail, supabaseReady } from '@/lib/supabase-rest';
import { memGetList } from '@/lib/waitlist-store';
import { timingSafeEqual } from 'crypto';

function checkToken(provided: string): boolean {
  const secret = process.env.ADMIN_TOKEN;
  if (!secret) return false;
  try {
    return provided.length === secret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-admin-token') ?? '';
  if (!checkToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (supabaseReady()) {
      const [entries, count] = await Promise.all([sbGetList(), sbGetCount()]);
      if (entries !== null) {
        return NextResponse.json({
          count: count ?? entries.length,
          entries: entries.map(e => ({
            email: e.email,
            ts: new Date(e.created_at).getTime(),
            created_at: e.created_at,
          })),
          source: 'supabase',
        });
      }
    }

    const mem = memGetList();
    return NextResponse.json({ count: mem.length, entries: mem, source: 'memory' });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token =
    req.headers.get('x-admin-token') ||
    req.nextUrl.searchParams.get('token') ||
    '';
  if (!checkToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });

  if (!supabaseReady()) {
    return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  }

  const ok = await sbDeleteEmail(email);
  if (!ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  return NextResponse.json({ success: true });
}
