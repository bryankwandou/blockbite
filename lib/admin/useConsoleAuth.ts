'use client';

/** Browser side of /api/{admin,partner}/auth. The session is an httpOnly cookie. */

import { useCallback, useEffect, useState } from 'react';
import bs58 from 'bs58';
import { useWallet } from '@solana/wallet-adapter-react';

export async function api<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `request failed (${res.status})`);
  return j as T;
}

export function useConsoleAuth(role: 'admin' | 'partner') {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [session, setSession] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ wallet: string | null; configured: boolean }>(`/api/${role}/auth`)
      .then((r) => { setSession(r.wallet); setConfigured(r.configured); })
      .catch(() => setConfigured(false))
      .finally(() => setChecked(true));
  }, [role]);

  const signIn = useCallback(async () => {
    if (!wallet || !signMessage) { setError('This wallet cannot sign messages.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { message } = await api<{ message: string }>(`/api/${role}/auth`, { wallet });
      const sig = await signMessage(new TextEncoder().encode(message));
      const r = await api<{ wallet: string }>(`/api/${role}/auth`, { wallet, message, signature: bs58.encode(sig) });
      setSession(r.wallet);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [role, wallet, signMessage]);

  const signOut = useCallback(async () => {
    await api(`/api/${role}/auth`, undefined, 'DELETE').catch(() => null);
    setSession(null);
  }, [role]);

  return { wallet, session, configured, checked, busy, error, signIn, signOut, setSession };
}
