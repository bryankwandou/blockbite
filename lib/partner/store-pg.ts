/**
 * Postgres DistStore (tables ptn_dist_campaigns, ptn_dist_deposits,
 * ptn_allocations; DDL in lib/admin/db.ts). Server only.
 *
 * Budget cap: allocate() runs in one transaction that first takes
 * pg_advisory_xact_lock on the campaign id, so two concurrent allocations
 * for the same campaign are serialized and the cap is checked against the
 * committed total. The UNIQUE (campaign_id, wallet, period) key makes a
 * double allocation impossible even if that lock were bypassed.
 */

import { randomBytes } from 'node:crypto';
import { T, q, tx } from '@/lib/admin/db';
import type { AllocateResult, Allocation, Deposit, DistCampaign, DistStore, Rule, Totals } from './types';

type Row = Record<string, unknown>;

const C_COLS = `id, partner, mint, token_program, decimals, budget::text AS budget, rule, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(ends_on, 'YYYY-MM-DD') AS ends_on, paused, created_at::text AS created_at`;
const A_COLS = `id, campaign_id, wallet, period, amount::text AS amount, status, dist_sig, tx_sig, last_valid_block_height::text AS lvbh,
  created_at::text AS created_at, paid_at::text AS paid_at`;

const big = (v: unknown) => BigInt(String(v ?? '0').split('.')[0]);

function toCampaign(r: Row): DistCampaign {
  return {
    id: String(r.id), partner: String(r.partner), mint: String(r.mint), tokenProgram: String(r.token_program),
    decimals: Number(r.decimals), budget: big(r.budget), rule: r.rule as Rule, startsOn: String(r.starts_on),
    endsOn: String(r.ends_on), paused: Boolean(r.paused), createdAt: String(r.created_at),
  };
}

function toAlloc(r: Row): Allocation {
  return {
    id: String(r.id), campaignId: String(r.campaign_id), wallet: String(r.wallet), period: String(r.period),
    amount: big(r.amount), status: r.status as Allocation['status'], distSig: (r.dist_sig as string) ?? null,
    txSig: (r.tx_sig as string) ?? null, lastValidBlockHeight: r.lvbh == null ? null : Number(r.lvbh),
    createdAt: String(r.created_at), paidAt: (r.paid_at as string) ?? null,
  };
}

export class PgStore implements DistStore {
  async insertCampaign(c: DistCampaign) {
    await q(`INSERT INTO ${T.dcampaigns} (id, partner, mint, token_program, decimals, budget, rule, starts_on, ends_on, paused)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::date, $9::date, $10)`,
    [c.id, c.partner, c.mint, c.tokenProgram, c.decimals, c.budget.toString(), JSON.stringify(c.rule), c.startsOn, c.endsOn, c.paused]);
  }
  async getCampaign(id: string) {
    const r = await q(`SELECT ${C_COLS} FROM ${T.dcampaigns} WHERE id = $1`, [id]);
    return r[0] ? toCampaign(r[0]) : null;
  }
  async listCampaigns(partner: string | null) {
    const r = partner
      ? await q(`SELECT ${C_COLS} FROM ${T.dcampaigns} WHERE partner = $1 ORDER BY created_at DESC`, [partner])
      : await q(`SELECT ${C_COLS} FROM ${T.dcampaigns} ORDER BY created_at DESC LIMIT 200`);
    return r.map(toCampaign);
  }
  async setPaused(id: string, partner: string, paused: boolean) {
    const r = await q(`UPDATE ${T.dcampaigns} SET paused = $3 WHERE id = $1 AND partner = $2 RETURNING id`, [id, partner, paused]);
    return r.length === 1;
  }
  async addDeposit(d: Omit<Deposit, 'at'>) {
    const r = await q(`INSERT INTO ${T.ddeposits} (sig, campaign_id, amount) VALUES ($1, $2, $3) ON CONFLICT (sig) DO NOTHING RETURNING sig`,
      [d.sig, d.campaignId, d.amount.toString()]);
    return r.length === 1;
  }
  async deposits(campaignId: string) {
    const r = await q(`SELECT sig, campaign_id, amount::text AS amount, verified_at::text AS at FROM ${T.ddeposits} WHERE campaign_id = $1 ORDER BY verified_at`, [campaignId]);
    return r.map((x) => ({ sig: String(x.sig), campaignId: String(x.campaign_id), amount: big(x.amount), at: String(x.at) }));
  }

  async allocate(campaignId: string, rows: { wallet: string; period: string; amount: bigint }[]): Promise<AllocateResult> {
    if (!rows.length) return { inserted: 0, duplicate: 0, overBudget: 0 };
    const ids = rows.map(() => randomBytes(8).toString('hex'));
    const wallets = rows.map((r) => r.wallet);
    const periods = rows.map((r) => r.period);
    const amounts = rows.map((r) => r.amount.toString());
    const input = `SELECT * FROM unnest($2::text[], $3::text[], $4::text[], $5::numeric[]) WITH ORDINALITY AS t(id, wallet, period, amount, ord)`;
    const [, dup, ins] = await tx([
      { text: 'SELECT pg_advisory_xact_lock(hashtext($1))', params: [`ptn_alloc:${campaignId}`] },
      {
        text: `SELECT count(*)::int AS n FROM (${input}) i WHERE EXISTS (
          SELECT 1 FROM ${T.allocations} a WHERE a.campaign_id = $1 AND a.wallet = i.wallet AND a.period = i.period)`,
        params: [campaignId, ids, wallets, periods, amounts],
      },
      {
        text: `WITH cap AS (
            SELECT least(c.budget, coalesce((SELECT sum(amount) FROM ${T.ddeposits} WHERE campaign_id = $1), 0)) AS cap,
                   coalesce((SELECT sum(amount) FROM ${T.allocations} WHERE campaign_id = $1), 0) AS used
            FROM ${T.dcampaigns} c WHERE c.id = $1),
          fresh AS (
            SELECT i.*, sum(i.amount) OVER (ORDER BY i.ord) AS run FROM (${input}) i
            WHERE i.amount > 0 AND NOT EXISTS (
              SELECT 1 FROM ${T.allocations} a WHERE a.campaign_id = $1 AND a.wallet = i.wallet AND a.period = i.period))
          INSERT INTO ${T.allocations} (id, campaign_id, wallet, period, amount)
          SELECT f.id, $1, f.wallet, f.period, f.amount FROM fresh f, cap WHERE cap.used + f.run <= cap.cap
          ON CONFLICT (campaign_id, wallet, period) DO NOTHING RETURNING id`,
        params: [campaignId, ids, wallets, periods, amounts],
      },
    ]);
    const duplicate = Number(dup[0]?.n ?? 0);
    const inserted = ins.length;
    return { inserted, duplicate, overBudget: rows.length - duplicate - inserted };
  }

  async totals(campaignId: string): Promise<Totals> {
    const [d, a] = await Promise.all([
      q(`SELECT coalesce(sum(amount), 0)::text AS d FROM ${T.ddeposits} WHERE campaign_id = $1`, [campaignId]),
      q(`SELECT coalesce(sum(amount), 0)::text AS allocated,
           coalesce(sum(amount) FILTER (WHERE status = 'open'), 0)::text AS open,
           coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0)::text AS pending,
           coalesce(sum(amount) FILTER (WHERE status = 'paid'), 0)::text AS paid,
           count(DISTINCT wallet)::int AS recipients
         FROM ${T.allocations} WHERE campaign_id = $1`, [campaignId]),
    ]);
    const x = a[0] ?? {};
    return { deposited: big(d[0]?.d), allocated: big(x.allocated), open: big(x.open), pending: big(x.pending), paid: big(x.paid), recipients: Number(x.recipients ?? 0) };
  }
  async allocationsOf(campaignId: string) {
    return (await q(`SELECT ${A_COLS} FROM ${T.allocations} WHERE campaign_id = $1 ORDER BY period, created_at`, [campaignId])).map(toAlloc);
  }
  async allocationsForWallet(wallet: string) {
    return (await q(`SELECT ${A_COLS} FROM ${T.allocations} WHERE wallet = $1 ORDER BY created_at DESC LIMIT 200`, [wallet])).map(toAlloc);
  }
  async getAllocation(id: string) {
    const r = await q(`SELECT ${A_COLS} FROM ${T.allocations} WHERE id = $1`, [id]);
    return r[0] ? toAlloc(r[0]) : null;
  }
  async toPending(id: string, wallet: string, distSig: string, lvbh: number) {
    const r = await q(
      `UPDATE ${T.allocations} a SET status = 'pending', dist_sig = $3, last_valid_block_height = $4, tx_sig = NULL
       FROM ${T.dcampaigns} c
       WHERE a.id = $1 AND a.wallet = $2 AND a.status = 'open' AND c.id = a.campaign_id AND NOT c.paused RETURNING a.id`,
      [id, wallet, distSig, lvbh]);
    return r.length === 1;
  }
  async settle(id: string, distSig: string, to: 'paid' | 'open', txSig: string | null) {
    const r = to === 'paid'
      ? await q(`UPDATE ${T.allocations} SET status = 'paid', tx_sig = $3, paid_at = now() WHERE id = $1 AND status = 'pending' AND dist_sig = $2 RETURNING id`, [id, distSig, txSig])
      : await q(`UPDATE ${T.allocations} SET status = 'open', dist_sig = NULL, tx_sig = NULL, last_valid_block_height = NULL
                 WHERE id = $1 AND status = 'pending' AND dist_sig = $2 RETURNING id`, [id, distSig]);
    return r.length === 1;
  }
}
