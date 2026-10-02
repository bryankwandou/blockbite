/** GET (Authorization: Bearer <ranked session>): the signed-in player's partner rewards. */
import { json } from '@/lib/admin/http';
import { fromBase } from '@/lib/partner/distribution';
import { playerGuard } from '@/lib/partner/player';
import { distribution } from '@/lib/partner/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const wallet = await playerGuard(req, 'rewards', 20);
  if (wallet instanceof Response) return wallet;
  const list = await distribution().rewardsFor(wallet);
  const rewards = [];
  for (const a of list) {
    if (!a.campaign) continue;
    rewards.push({
      id: a.id, period: a.period, status: a.status, txSig: a.txSig,
      amount: fromBase(a.amount, a.campaign.decimals), mint: a.campaign.mint, paused: a.campaign.paused,
    });
  }
  return json({ wallet, rewards });
}
