import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { MAX_GAME_LEVEL } from '@/lib/game/constants';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const level  = parseInt(params.id, 10);
  const player = req.nextUrl.searchParams.get('player') ?? 'anonymous';

  if (isNaN(level) || level < 1 || level > MAX_GAME_LEVEL) {
    return NextResponse.json({ error: `invalid level (1–${MAX_GAME_LEVEL})` }, { status: 400 });
  }

  // Deterministic seed: keccak-256 of "blockbite:level:{N}:{player}"
  const seed = createHash('sha256')
    .update(`blockbite:level:${level}:${player}`)
    .digest('hex');

  return NextResponse.json({ level, seed });
}
