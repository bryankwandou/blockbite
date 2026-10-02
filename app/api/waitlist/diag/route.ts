import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { sbKeyRole, sbProbe, supabaseReady } from '@/lib/supabase-rest';

export const dynamic = 'force-dynamic';

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
  const token =
    req.headers.get('x-admin-token') ||
    req.nextUrl.searchParams.get('token') ||
    '';
  if (!checkToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const probe = supabaseReady() ? await sbProbe() : null;

  return NextResponse.json({
    supabaseReady: supabaseReady(),
    keyRole: sbKeyRole(),
    probe,
    env: {
      SUPABASE_URL_set: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY_set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ADMIN_TOKEN_set: Boolean(process.env.ADMIN_TOKEN),
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      VERCEL_URL: process.env.VERCEL_URL ?? null,
    },
    hint:
      sbKeyRole().role === 'anon'
        ? 'CRITICAL: SUPABASE_SERVICE_ROLE_KEY is set to the ANON key. RLS is silently dropping inserts. Replace it with the service_role key in Vercel → Settings → Environment Variables.'
        : null,
  });
}
