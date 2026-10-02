/** JSON views of distribution data (bigint -> decimal strings). Server only. */
import { fromBase } from './distribution';
import type { Allocation, DistCampaign, Totals } from './types';

export function campaignView(c: DistCampaign) {
  const d = c.decimals;
  const rule = c.rule.kind === 'daily_top'
    ? { kind: c.rule.kind, amounts: c.rule.amounts.map((x) => fromBase(BigInt(x), d)) }
    : c.rule.kind === 'level'
      ? { kind: c.rule.kind, level: c.rule.level, amount: fromBase(BigInt(c.rule.amount), d) }
      : { kind: c.rule.kind, id: c.rule.id, amount: fromBase(BigInt(c.rule.amount), d) };
  return { ...c, budget: fromBase(c.budget, d), rule };
}

export function totalsView(t: Totals, decimals: number) {
  const f = (v: bigint) => fromBase(v, decimals);
  return {
    deposited: f(t.deposited), allocated: f(t.allocated), open: f(t.open), pending: f(t.pending), paid: f(t.paid),
    remaining: f(t.deposited - t.paid), unallocated: f(t.deposited - t.allocated), recipients: t.recipients,
  };
}

export function allocationView(a: Allocation, decimals: number) {
  return { ...a, amount: fromBase(a.amount, decimals) };
}
