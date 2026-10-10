import { NextRequest, NextResponse } from 'next/server';
import { neonPageStats, neonTotals, neonWalletStats } from '@/lib/neon-analytics';
import { safeEqual } from '@/lib/safeEqual';

function checkToken(provided: string): boolean {
  const secret = process.env.ADMIN_TOKEN;
  if (!secret) return false;
  return safeEqual(provided, secret);
}

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-admin-token') ?? '';
  if (!checkToken(token)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [pageStats, totals, walletStats] = await Promise.all([
    neonPageStats(),
    neonTotals(),
    neonWalletStats(),
  ]);

  return NextResponse.json({
    pageStats,
    baseline: totals
      ? {
          views: totals.inheritedViews,
          visitors: totals.inheritedVisitors,
          capturedAt: totals.capturedAt,
          note: 'Gabungan tiga entitas sebelum pemisahan 10 Agustus 2026',
        }
      : null,
    totalStats: {
      // Own traffic since separation, plus the joint history it inherited.
      totalViews: (totals?.ownViews ?? 0) + (totals?.inheritedViews ?? 0),
      ownViews: totals?.ownViews ?? 0,
      inheritedViews: totals?.inheritedViews ?? 0,
      uniqueVisitors: (totals?.ownVisitors ?? 0) + (totals?.inheritedVisitors ?? 0),
      today: totals?.today ?? 0,
      tableReady: totals !== null,
      byDay: totals?.byDay ?? [],
    },
    walletStats,
  });
}
