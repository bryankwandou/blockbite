/**
 * POST /api/auth/passkey/options { mode: 'bind' | 'recover' }
 *   → WebAuthn options (binary fields base64url) and a 5-minute signed
 *   challenge cookie. bind needs the wallet session cookie. No third party:
 *   the passkey lives on the player's device or password manager.
 */
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { randomToken } from '@/lib/auth/core';
import { passkeysOf } from '@/lib/auth/db';
import { ALG_ES256, ALG_RS256 } from '@/lib/auth/webauthn';
import { accountsConfigured, body, COOKIE, fail, limited, relyingParty, sealPasskey, setCookie, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available', { code: 'unavailable' });
  if (await limited(req, 'passkey-options', 30)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const mode = (await body(req))?.mode === 'bind' ? 'bind' : 'recover';
  const { rpId } = relyingParty(req);
  const challenge = randomToken(32);
  let publicKey: Record<string, unknown>;
  let w: string | null = null;
  if (mode === 'bind') {
    const ws = walletSession(req);
    if (!ws) return fail(401, 'sign with your wallet first', { code: 'wallet_session' });
    w = ws.w;
    const label = `BlockBite ${w.slice(0, 4)}…${w.slice(-4)}`;
    const existing = await passkeysOf(w);
    publicKey = {
      challenge,
      rp: { id: rpId, name: 'BlockBite' },
      user: {
        id: createHash('sha256').update(`blockbite:user:${w}`).digest().subarray(0, 16).toString('base64url'),
        name: label,
        displayName: label,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: ALG_ES256 }, { type: 'public-key', alg: ALG_RS256 }],
      timeout: 120_000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.credential_id })),
    };
  } else {
    publicKey = { challenge, rpId, timeout: 120_000, userVerification: 'preferred', allowCredentials: [] };
  }
  const res = NextResponse.json({ mode, publicKey }, { headers: { 'Cache-Control': 'no-store' } });
  setCookie(res, COOKIE.passkey, sealPasskey({ c: challenge, mode, w }), 5 * 60_000);
  return res;
}
