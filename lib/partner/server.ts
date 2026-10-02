/**
 * Server wiring for partner distribution: Postgres store, RPC connection,
 * distributor key from PARTNER_DISTRIBUTOR_SECRET, and eligibility read from
 * the existing data (rk_runs, ach_unlocks, KV user profile). Server only.
 */

import { Connection } from '@solana/web3.js';
import { T, qMaybe, SCHEMA } from '@/lib/admin/db';
import { rpcUrl } from '@/lib/admin/rpc';
import { getUser } from '@/lib/store';
import { Distribution, parseSecret, type Eligibility } from './distribution';
import { PgStore } from './store-pg';

export const dbEligibility: Eligibility = {
  async dailyTop(day, n) {
    const r = await qMaybe<{ wallet: string }>(
      `SELECT wallet FROM ${T.runs} WHERE day = $1::date AND score > 0
       GROUP BY wallet ORDER BY max(score) DESC, min(created_at), wallet LIMIT $2`, [day, n]);
    return (r ?? []).map((x) => x.wallet);
  },
  async levelOf(wallet) {
    const u = await getUser(wallet).catch(() => null);
    return u && typeof u.currentLevel === 'number' && u.currentLevel > 0 ? u.currentLevel : null;
  },
  async achievementHolders(id, until) {
    const r = await qMaybe<{ wallet: string }>(
      `SELECT wallet FROM ${SCHEMA}.ach_unlocks WHERE id = $1 AND unlocked_at < ($2::date + 1) ORDER BY unlocked_at, wallet LIMIT 5000`, [id, until]);
    return (r ?? []).map((x) => x.wallet);
  },
};

let cached: Distribution | null = null;

export function distribution(): Distribution {
  cached ??= new Distribution(new PgStore(), new Connection(rpcUrl(), 'confirmed'), parseSecret(process.env.PARTNER_DISTRIBUTOR_SECRET), dbEligibility);
  return cached;
}
