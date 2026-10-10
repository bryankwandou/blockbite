import { NextResponse } from 'next/server';
import { SessionCheckError, walletFromRequestAsync } from './auth';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, status);
}

/** Wallet of the signed-in caller (not revoked), a 401 response, or 503 JSON if the session store is down. */
export async function requireWallet(req: Request): Promise<string | Response> {
  try {
    return (await walletFromRequestAsync(req)) ?? fail(401, 'sign in with your wallet first');
  } catch (e) {
    if (e instanceof SessionCheckError) return fail(503, 'session check unavailable, try again');
    throw e;
  }
}

/** Hard cap for JSON bodies read by body(). Larger than any legitimate payload (replay moves included). */
export const MAX_JSON_BYTES = 256 * 1024;

/**
 * Parses a JSON object body, counting bytes as they stream in so a huge or
 * Content-Length-less body is cut off at MAX_JSON_BYTES instead of being
 * buffered whole. Returns null (callers answer 400) for oversize, bad JSON
 * or a non-object.
 */
export async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return null;
    let text = '';
    if (req.body) {
      const reader = req.body.getReader();
      const dec = new TextDecoder();
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > MAX_JSON_BYTES) { await reader.cancel().catch(() => {}); return null; }
        text += dec.decode(value, { stream: true });
      }
      text += dec.decode();
    }
    if (/\\u0000/i.test(text)) return null; // a NUL escape makes Postgres throw (a 500)
    const b = JSON.parse(text);
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Ranked is served only when its secret and database are configured. */
export function rankedConfigured(): boolean {
  return Boolean(process.env.RANKED_SECRET && (process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL));
}
