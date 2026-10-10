/**
 * Cross-site guard for cookie-authenticated, state-changing requests (server only).
 *
 * The admin/partner/account cookies are SameSite=Strict/Lax, which already keeps a
 * browser from attaching them to a cross-site POST. This is the second layer: even
 * if a cookie were attached (an older browser, a same-site sibling subdomain, a
 * future SameSite change), the server refuses a mutation whose own headers say it
 * came from another site. Requests with neither header (curl, server-to-server,
 * tests) are not browser CSRF and pass.
 */

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isCrossSiteMutation(req: Request): boolean {
  if (SAFE.has(req.method.toUpperCase())) return false;
  const site = req.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // "null" or garbage Origin: a sandboxed or opaque context
  }
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  return originHost !== host;
}
