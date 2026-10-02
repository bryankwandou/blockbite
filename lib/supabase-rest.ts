/**
 * Supabase REST API helpers (no extra npm package needed).
 * Uses service-role key so it bypasses RLS — server-side only.
 */

const SB_URL = process.env.SUPABASE_URL ?? '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function h(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    ...extra,
  };
}

export function supabaseReady(): boolean {
  return Boolean(SB_URL && SB_KEY);
}

/** Insert email. Returns 'inserted' | 'duplicate' | 'error:STATUS'.
 *  Strict: with Prefer:return=representation the response body MUST contain the
 *  inserted row. If RLS or a trigger silently drops the row, PostgREST returns
 *  201 with [] — we treat that as a silent failure instead of "inserted".
 */
export async function sbInsertEmail(
  email: string,
): Promise<'inserted' | 'duplicate' | string> {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: h({ Prefer: 'return=representation' }),
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
    if (res.status === 409) return 'duplicate';
    const bodyText = await res.text().catch(() => '');
    if (res.status === 200 || res.status === 201) {
      // representation should return the inserted row. Empty array = silent RLS drop.
      try {
        const parsed = JSON.parse(bodyText);
        if (Array.isArray(parsed) && parsed.length === 0) {
          return `error:silent-rls:body=[]:status=${res.status}`;
        }
      } catch { /* not JSON — accept as inserted */ }
      return 'inserted';
    }
    if (res.status === 204) return 'inserted'; // minimal — can't verify, trust status
    return `error:${res.status}:${bodyText.slice(0, 200)}`;
  } catch (e) {
    return `error:exception:${String(e).slice(0, 120)}`;
  }
}

/** Decode JWT payload without verifying — used only for diagnostics so we can
 *  tell the user whether the key in Vercel is the anon key vs service_role.
 */
export function sbKeyRole(): { role?: string; ref?: string; error?: string } {
  if (!SB_KEY) return { error: 'no-key' };
  const parts = SB_KEY.split('.');
  if (parts.length !== 3) return { error: 'not-jwt' };
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    return { role: decoded?.role, ref: decoded?.ref };
  } catch (e) {
    return { error: `decode:${String(e).slice(0, 60)}` };
  }
}

/** Probe Supabase with a raw SELECT and return the response details. */
export async function sbProbe(): Promise<{
  status: number;
  bodyHead: string;
  rowCount: number | null;
}> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/waitlist?select=email&limit=5`,
      { headers: h({ Prefer: 'count=exact' }), cache: 'no-store' },
    );
    const txt = await res.text().catch(() => '');
    let rowCount: number | null = null;
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) rowCount = parsed.length;
    } catch { /* ignore */ }
    return { status: res.status, bodyHead: txt.slice(0, 300), rowCount };
  } catch (e) {
    return { status: -1, bodyHead: `exception:${String(e).slice(0, 200)}`, rowCount: null };
  }
}

/** Return total row count. */
export async function sbGetCount(): Promise<number | null> {
  // Always use sbGetList() — the HEAD+count=exact approach returns unreliable
  // zeros from this PostgREST instance. List length is the authoritative count.
  const list = await sbGetList();
  if (list !== null) return list.length;
  return null;
}

export type SbEntry = { email: string; created_at: string };

/** Delete a single email from waitlist. Returns true on success. */
export async function sbDeleteEmail(email: string): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(email);
    const res = await fetch(
      `${SB_URL}/rest/v1/waitlist?email=eq.${encoded}`,
      { method: 'DELETE', headers: h({ Prefer: 'return=minimal' }), cache: 'no-store' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Return all entries ordered newest first.
 *  cache:no-store is REQUIRED — Next.js 14 caches server-side fetch() by
 *  default, so without it every GET sees the same frozen snapshot of rows
 *  even when force-dynamic is set on the route. That bug caused the public
 *  counter to stick at 2 while new signups kept landing in Supabase.
 */
export async function sbGetList(): Promise<SbEntry[] | null> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/waitlist?select=email,created_at&order=created_at.desc&limit=50000`,
      { headers: h(), cache: 'no-store' },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
