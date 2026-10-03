import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KINDS = ['winners', 'acts', 'biomes'] as const;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ kind: string }> },
) {
  const params = await ctx.params;
  if (!KINDS.includes(params.kind as typeof KINDS[number])) {
    return NextResponse.json({ error: 'unknown list kind' }, { status: 404 });
  }

  // Try KV first
  try {
    const { kv } = await import('@vercel/kv');
    const cached = await kv.get<unknown[]>(`blockbite:list:${params.kind}`);
    if (cached) return NextResponse.json(cached);
  } catch { /* fallback */ }

  return NextResponse.json([]);
}
