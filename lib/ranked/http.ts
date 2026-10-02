import { NextResponse } from 'next/server';
import { walletFromRequest } from './auth';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return json({ error, ...extra }, status);
}

/** Wallet of the signed-in caller, or a 401 response. */
export function requireWallet(req: Request): string | Response {
  return walletFromRequest(req) ?? fail(401, 'sign in with your wallet first');
}

export async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Ranked is served only when its secret and database are configured. */
export function rankedConfigured(): boolean {
  return Boolean(process.env.RANKED_SECRET && (process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL));
}
