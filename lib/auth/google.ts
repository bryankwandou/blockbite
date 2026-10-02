/** Google OAuth I/O (server only). Pure checks live in ./core. */

import { verifyIdToken, type GoogleClaims, type Jwks } from './core';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export function googleConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

let jwksCache: { at: number; ttl: number; jwks: Jwks } | null = null;

async function jwks(force = false): Promise<Jwks> {
  if (!force && jwksCache && Date.now() - jwksCache.at < jwksCache.ttl) return jwksCache.jwks;
  const res = await fetch(JWKS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('jwks_fetch');
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  jwksCache = { at: Date.now(), ttl: Math.min(maxAge, 6 * 3600) * 1000, jwks: (await res.json()) as Jwks };
  return jwksCache.jwks;
}

/** Exchanges the code (with the PKCE verifier) and returns verified claims. */
export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<GoogleClaims> {
  const cfg = googleConfig();
  if (!cfg) throw new Error('not_configured');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: cfg.clientId, client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri, grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('token_exchange');
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error('no_id_token');
  try {
    return verifyIdToken(idToken, await jwks(), { clientId: cfg.clientId, nonce });
  } catch (e) {
    if ((e as Error).message !== 'kid') throw e;
    return verifyIdToken(idToken, await jwks(true), { clientId: cfg.clientId, nonce }); // keys rotated
  }
}
