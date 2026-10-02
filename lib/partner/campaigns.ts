/**
 * Partner applications (server only): apply, admin approve/reject.
 * Campaigns, deposits, allocations and claims live in distribution.ts.
 * (Tables ptn_campaigns / ptn_deposits from the first version are no longer
 * written; they are left in place, never dropped.)
 */

import { isWallet } from '@/lib/ranked/auth';
import { T, q } from '@/lib/admin/db';

export interface Partner {
  wallet: string; name: string; token_mint: string; contact: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function getPartner(wallet: string): Promise<Partner | null> {
  const r = await q<Partner>(`SELECT wallet, name, token_mint, contact, status, created_at::text AS created_at FROM ${T.partners} WHERE wallet = $1`, [wallet]);
  return r[0] ?? null;
}

export async function listPartners(): Promise<Partner[]> {
  return q<Partner>(`SELECT wallet, name, token_mint, contact, status, created_at::text AS created_at FROM ${T.partners} ORDER BY created_at DESC LIMIT 500`);
}

export async function apply(wallet: string, b: Record<string, unknown>): Promise<string | null> {
  const name = clean(b.name, 80);
  const mint = clean(b.tokenMint, 44);
  const contact = clean(b.contact, 120);
  if (name.length < 2) return 'name is required';
  if (!isWallet(mint)) return 'token mint is not a valid address';
  if (contact.length < 3) return 'contact is required';
  const rows = await q(
    `INSERT INTO ${T.partners} (wallet, name, token_mint, contact) VALUES ($1, $2, $3, $4)
     ON CONFLICT (wallet) DO UPDATE SET name = EXCLUDED.name, token_mint = EXCLUDED.token_mint, contact = EXCLUDED.contact,
       status = 'pending', decided_by = NULL, decided_at = NULL
     WHERE ${T.partners}.status <> 'approved' RETURNING wallet`, [wallet, name, mint, contact]);
  return rows.length ? null : 'already approved';
}

export async function decide(wallet: string, status: 'approved' | 'rejected', admin: string): Promise<boolean> {
  const r = await q(`UPDATE ${T.partners} SET status = $2, decided_by = $3, decided_at = now() WHERE wallet = $1 RETURNING wallet`, [wallet, status, admin]);
  return r.length === 1;
}
