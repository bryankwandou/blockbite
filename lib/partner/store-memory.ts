/**
 * In-memory DistStore with the same guarantees as store-pg.ts. Used by
 * scripts/partner-selftest.ts when no database is configured. JS runs each
 * method body without interleaving between awaits, and these methods never
 * await mid-update, so each call is atomic.
 */

import { randomBytes } from 'node:crypto';
import type { AllocateResult, Allocation, Deposit, DistCampaign, DistStore, Totals } from './types';

export class MemoryStore implements DistStore {
  private campaigns = new Map<string, DistCampaign>();
  private deps = new Map<string, Deposit>();
  private allocs = new Map<string, Allocation>();
  private keys = new Set<string>();

  async insertCampaign(c: DistCampaign) { this.campaigns.set(c.id, { ...c }); }
  async getCampaign(id: string) { const c = this.campaigns.get(id); return c ? { ...c } : null; }
  async listCampaigns(partner: string | null) {
    return [...this.campaigns.values()].filter((c) => !partner || c.partner === partner).map((c) => ({ ...c }));
  }
  async setPaused(id: string, partner: string, paused: boolean) {
    const c = this.campaigns.get(id);
    if (!c || c.partner !== partner) return false;
    c.paused = paused;
    return true;
  }
  async addDeposit(d: Omit<Deposit, 'at'>) {
    if (this.deps.has(d.sig)) return false;
    this.deps.set(d.sig, { ...d, at: new Date().toISOString() });
    return true;
  }
  async deposits(campaignId: string) { return [...this.deps.values()].filter((d) => d.campaignId === campaignId); }

  async allocate(campaignId: string, rows: { wallet: string; period: string; amount: bigint }[]): Promise<AllocateResult> {
    const c = this.campaigns.get(campaignId);
    const out = { inserted: 0, duplicate: 0, overBudget: 0 };
    if (!c) return { ...out, overBudget: rows.length };
    const t = this.totalsSync(campaignId);
    const cap = t.deposited < c.budget ? t.deposited : c.budget;
    let used = t.allocated;
    let full = false;
    for (const r of rows) {
      const key = `${campaignId}|${r.wallet}|${r.period}`;
      if (this.keys.has(key)) { out.duplicate++; continue; }
      if (full || r.amount <= 0n || used + r.amount > cap) { full = true; out.overBudget++; continue; }
      used += r.amount;
      this.keys.add(key);
      const id = randomBytes(8).toString('hex');
      this.allocs.set(id, {
        id, campaignId, wallet: r.wallet, period: r.period, amount: r.amount, status: 'open',
        distSig: null, txSig: null, lastValidBlockHeight: null, createdAt: new Date().toISOString(), paidAt: null,
      });
      out.inserted++;
    }
    return out;
  }

  private totalsSync(campaignId: string): Totals {
    const t: Totals = { deposited: 0n, allocated: 0n, open: 0n, pending: 0n, paid: 0n, recipients: 0 };
    for (const d of this.deps.values()) if (d.campaignId === campaignId) t.deposited += d.amount;
    const w = new Set<string>();
    for (const a of this.allocs.values()) {
      if (a.campaignId !== campaignId) continue;
      t.allocated += a.amount;
      t[a.status] += a.amount;
      w.add(a.wallet);
    }
    t.recipients = w.size;
    return t;
  }
  async totals(campaignId: string) { return this.totalsSync(campaignId); }
  async allocationsOf(campaignId: string) { return [...this.allocs.values()].filter((a) => a.campaignId === campaignId).map((a) => ({ ...a })); }
  async allocationsForWallet(wallet: string) { return [...this.allocs.values()].filter((a) => a.wallet === wallet).map((a) => ({ ...a })); }
  async getAllocation(id: string) { const a = this.allocs.get(id); return a ? { ...a } : null; }

  async toPending(id: string, wallet: string, distSig: string, lvbh: number) {
    const a = this.allocs.get(id);
    if (!a || a.status !== 'open' || a.wallet !== wallet || this.campaigns.get(a.campaignId)?.paused !== false) return false;
    Object.assign(a, { status: 'pending', distSig, lastValidBlockHeight: lvbh, txSig: null });
    return true;
  }
  async settle(id: string, distSig: string, to: 'paid' | 'open', txSig: string | null) {
    const a = this.allocs.get(id);
    if (!a || a.status !== 'pending' || a.distSig !== distSig) return false;
    if (to === 'paid') Object.assign(a, { status: 'paid', txSig, paidAt: new Date().toISOString() });
    else Object.assign(a, { status: 'open', distSig: null, txSig: null, lastValidBlockHeight: null });
    return true;
  }
}
