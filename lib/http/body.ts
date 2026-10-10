import { fail } from '@/lib/ranked/http';

/** Default cap for JSON request bodies on write routes. */
export const MAX_BODY_BYTES = 8 * 1024;

/**
 * Reads a JSON object body with a byte cap, counting bytes as they stream in
 * (a missing or lying Content-Length does not help the sender).
 * Returns the parsed object, or a Response: 413 too large, 400 not a JSON object.
 */
export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return fail(413, 'request body too large');
  let text = '';
  if (req.body) {
    const reader = req.body.getReader();
    const dec = new TextDecoder();
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > maxBytes) { await reader.cancel().catch(() => {}); return fail(413, 'request body too large'); }
      text += dec.decode(value, { stream: true });
    }
    text += dec.decode();
  }
  if (hasNul(text)) return fail(400, 'invalid JSON');
  try {
    const b = JSON.parse(text);
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : fail(400, 'expected a JSON object');
  } catch {
    return fail(400, 'invalid JSON');
  }
}

/**
 * For public GET routes: an Authorization header that is present but not a valid
 * session token is a 401 (JSON), not a silent downgrade. No header = anonymous.
 */
export async function badBearer(req: Request, walletFromRequest: (r: Request) => string | null | Promise<string | null>): Promise<Response | null> {
  if (!req.headers.get('authorization')) return null;
  try {
    return (await walletFromRequest(req)) ? null : fail(401, 'invalid or expired session', { signIn: '/api/ranked/auth' });
  } catch {
    return fail(503, 'session check unavailable, try again');
  }
}

/** NUL in a JSON string reaches Postgres, which refuses it (a 500). Reject it at the door. */
export const hasNul = (jsonText: string) => /\\u0000/i.test(jsonText);

/**
 * Plain JSON-object body for routes that answer their own 400: the object, or null for
 * bad JSON, JSON null/array/scalar, a NUL escape, or a body over maxBytes (64 KiB default).
 */
export async function jsonObject<T = Record<string, unknown>>(req: Request, maxBytes = 64 * 1024): Promise<T | null> {
  const r = await readJson(req, maxBytes);
  return r instanceof Response ? null : (r as T);
}
