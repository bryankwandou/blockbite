/**
 * GET /api/auth/status → always 200:
 *   { available, google, wallet, migratedTo, methods: [{provider, email, createdMs}],
 *     passkeys: [{createdMs}], codesLeft,
 *     recovery: { wallet, provider, email, cooldownLeftMs } | null }
 */
import { cooldownLeft } from '@/lib/auth/core';
import { codesLeft, identitiesOf, lastMigrationInto, migratedTo, passkeysOf } from '@/lib/auth/db';
import { googleConfig } from '@/lib/auth/google';
import { accountsConfigured, json, recoverySession, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const google = Boolean(googleConfig());
  if (!accountsConfigured()) return json({ available: false, google, wallet: null, migratedTo: null, methods: [], passkeys: [], codesLeft: 0, recovery: null });
  try {
    const ws = walletSession(req);
    const rs = recoverySession(req);
    const methods = ws
      ? (await identitiesOf(ws.w)).map((i) => ({ provider: i.provider, email: i.email, createdMs: i.created_ms }))
      : [];
    const recovery = rs
      ? { wallet: rs.w, provider: rs.p, email: rs.m, cooldownLeftMs: cooldownLeft(await lastMigrationInto(rs.w)) }
      : null;
    const passkeys = ws ? (await passkeysOf(ws.w)).map((p) => ({ createdMs: p.created_ms })) : [];
    const left = ws ? await codesLeft(ws.w) : 0;
    return json({ available: true, google, wallet: ws?.w ?? null, migratedTo: ws ? await migratedTo(ws.w) : null, methods, passkeys, codesLeft: left, recovery });
  } catch {
    return json({ available: false, google, wallet: null, migratedTo: null, methods: [], passkeys: [], codesLeft: 0, recovery: null });
  }
}
