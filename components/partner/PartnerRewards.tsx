'use client';

/**
 * "Partner rewards" list for the connected player, with a Claim button.
 * Claim = the server returns a transaction already signed by the distributor;
 * the player signs it, pays the fee and the token-account rent, and sends it.
 * Uses the ranked sign-in session (same sessionStorage key as lib/ranked/client.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import bs58 from 'bs58';
import { Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useT } from '@/lib/i18n';

interface Reward { id: string; period: string; status: 'open' | 'pending' | 'paid'; txSig: string | null; amount: string; mint: string; paused: boolean }

const tokenKey = (w: string) => `bb_rk_session_${w}`;
const short = (v: string) => `${v.slice(0, 4)}…${v.slice(-4)}`;

function readToken(w: string): string | null {
  try {
    const t = sessionStorage.getItem(tokenKey(w));
    return t && Number(t.split('.')[1]) > Date.now() + 60_000 ? t : null;
  } catch { return null; }
}

async function call<T>(url: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `request failed (${res.status})`);
  return j as T;
}

export default function PartnerRewards() {
  const t = useT('partner');
  const { connection } = useConnection();
  const { publicKey, signMessage, signTransaction } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [token, setToken] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setToken(wallet ? readToken(wallet) : null); setRewards(null); }, [wallet]);

  const load = useCallback(async (tk: string) => {
    try { setRewards((await call<{ rewards: Reward[] }>('/api/partner/rewards', tk)).rewards); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (token) load(token); }, [token, load]);

  const signIn = async () => {
    if (!wallet || !signMessage) return;
    setErr(null);
    try {
      const { message } = await call<{ message: string }>('/api/ranked/auth', null, { wallet });
      const sig = await signMessage(new TextEncoder().encode(message));
      const { token: tk } = await call<{ token: string }>('/api/ranked/auth', null, { wallet, message, signature: bs58.encode(sig) });
      try { sessionStorage.setItem(tokenKey(wallet), tk); } catch { /* this page still works */ }
      setToken(tk);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const claim = async (r: Reward) => {
    if (!token || !signTransaction) return;
    setBusy(r.id);
    setErr(null);
    try {
      const { transaction } = await call<{ transaction: string }>('/api/partner/claim', token, { allocationId: r.id });
      const tx = Transaction.from(Buffer.from(transaction, 'base64'));
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, 'finalized').catch(() => null);
      await call('/api/partner/claim/confirm', token, { allocationId: r.id, signature: sig });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      load(token);
    }
  };

  if (!wallet) return null;
  return (
    <section aria-labelledby="partner-rewards-h" style={{ margin: '16px 0' }}>
      <h2 id="partner-rewards-h" style={{ fontSize: 18, margin: '0 0 8px' }}>{t('rewards_title')}</h2>
      {!token ? (
        <button type="button" onClick={signIn} disabled={!signMessage}>{t('rewards_sign_in')}</button>
      ) : rewards === null ? (
        <p>{t('rewards_loading')}</p>
      ) : rewards.length === 0 ? (
        <p>{t('rewards_none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rewards.map((r) => (
            <li key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{r.amount} · <code>{short(r.mint)}</code> · {r.period}</span>
              {r.status === 'paid' ? <span>{t('rewards_paid')}</span>
                : r.paused ? <span>{t('rewards_paused')}</span>
                  : r.status === 'pending' ? <span>{t('rewards_pending')}</span>
                    : <button type="button" onClick={() => claim(r)} disabled={busy !== null}>{busy === r.id ? t('rewards_claiming') : t('rewards_claim')}</button>}
            </li>
          ))}
        </ul>
      )}
      {token && <p style={{ fontSize: 12, opacity: 0.75 }}>{t('rewards_fee_note')}</p>}
      {err && <p role="alert" style={{ color: 'var(--danger, #c0392b)' }}>{err}</p>}
    </section>
  );
}
