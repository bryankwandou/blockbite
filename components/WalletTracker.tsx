'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { readToken } from '@/lib/ranked/client';

/**
 * Records one wallet-connect event per wallet per browser session.
 *
 * Must render inside <WalletProvider> — it reads the adapter state directly
 * rather than hooking connect(), so a connection restored by the modal, by a
 * deep link, or by the extension itself is all captured the same way.
 */
export function WalletTracker() {
  const { connected, publicKey, wallet } = useWallet();
  const pathname = usePathname();
  const sent = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!connected || !publicKey) return;
    const walletName = wallet?.adapter?.name ?? 'unknown';

    try {
      // Stable per-browser id so "unique wallets" is not inflated by reloads.
      let anon = localStorage.getItem('bb_anon');
      if (!anon) {
        anon = Math.random().toString(36).slice(2, 10);
        localStorage.setItem('bb_anon', anon);
      }

      // Dedupe within the session: one event per wallet app, not per render.
      const key = `bb_wc_${walletName}`;
      if (sent.current.has(key)) return;
      if (sessionStorage.getItem(key)) { sent.current.add(key); return; }
      sent.current.add(key);
      sessionStorage.setItem(key, '1');

      fetch('/api/wallet-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anon, walletName, path: pathname }),
      }).catch(() => {});
    } catch { /* ignore — tracking never breaks a connect */ }
  }, [connected, publicKey, wallet, pathname]);

  // Attribute a referral: /r/<referrer> stored the code, now a wallet has connected.
  // The claim is sent with the wallet's signed-in session (the server takes the
  // wallet from it), so it waits until the player signs in for ranked or the shop.
  // The server records it only for a wallet with no prior activity, once, and never
  // for the referrer's own wallet; any definitive answer is remembered (the code itself stays: the shop pays the 5% with it).
  const claimed = useRef<string | null>(null);
  const [session, setSession] = useState(0);
  const addr = publicKey?.toBase58() ?? null;
  useEffect(() => {
    const on = () => setSession((n) => n + 1);
    window.addEventListener('bb:ranked-session', on);
    return () => window.removeEventListener('bb:ranked-session', on);
  }, []);
  useEffect(() => {
    if (!connected || !addr || claimed.current === addr) return;
    let code: string | null = null;
    let done = false;
    try { code = localStorage.getItem('bb_referrer_code'); done = localStorage.getItem('bb_ref_claimed:' + addr) === '1'; } catch { /* storage blocked */ }
    if (!code || code === addr || done) return;
    const token = readToken(addr);
    if (!token) return;
    claimed.current = addr;
    fetch('/api/referrals/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ referrer: code }),
    })
      .then((r) => (r.status === 400 || r.ok ? r.json().catch(() => ({})) : null))
      .then((res) => {
        // 400 (not a wallet address) and every answered result are final.
        if (res) { try { localStorage.setItem('bb_ref_claimed:' + addr, '1'); } catch { /* ignore */ } }
        else claimed.current = null;
      })
      .catch(() => { claimed.current = null; });
  }, [connected, addr, session]);

  return null;
}
