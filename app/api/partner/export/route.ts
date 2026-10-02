/** GET ?campaign=<id>: CSV of recipients (allocations) and deposits for one campaign. */
import { fail, requireRole } from '@/lib/admin/http';
import { fromBase } from '@/lib/partner/distribution';
import { distribution } from '@/lib/partner/server';

export const dynamic = 'force-dynamic';

/** Quoted cell; a leading = + - @ is prefixed with ' so spreadsheets don't run it as a formula. */
const cell = (v: unknown) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const w = requireRole(req, 'partner');
  if (w instanceof Response) return w;
  const d = distribution();
  const c = await d.getCampaign(new URL(req.url).searchParams.get('campaign') ?? '');
  if (!c || c.partner !== w) return fail(404, 'no such campaign');
  const s = await d.stats(c);
  const lines = [
    ['type', 'wallet_or_signature', 'period', 'amount', 'status', 'tx', 'at'].map(cell).join(','),
    ...s.allocations.map((a) => ['allocation', a.wallet, a.period, fromBase(a.amount, c.decimals), a.status, a.txSig ?? '', a.paidAt ?? a.createdAt].map(cell).join(',')),
    ...s.deposits.map((x) => ['deposit', x.sig, '', fromBase(x.amount, c.decimals), 'verified', x.sig, x.at].map(cell).join(',')),
  ];
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="campaign-${c.id}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
