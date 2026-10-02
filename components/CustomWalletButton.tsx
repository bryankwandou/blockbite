'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import Link from 'next/link';
import { PlayerAvatar, useMyAvatar } from './CssAvatars';
import { useT } from '@/lib/i18n';
import styles from './CustomWalletButton.module.css';

function shortenAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export default function CustomWalletButton() {
  const { wallet, wallets, publicKey, disconnect, connecting, connected, select, connect } = useWallet();
  const { setVisible } = useWalletModal();

  // autoConnect is disabled globally (prevents stuck-connecting on page load).
  // But that means after the user picks a wallet via the standard modal,
  // select() is called but connect() never fires — so nothing happens.
  // This effect bridges the gap: whenever a wallet becomes selected and we
  // are not yet connected/connecting, trigger connect() explicitly.
  useEffect(() => {
    if (wallet && !connected && !connecting) {
      connect().catch(() => {});
    }
  }, [wallet, connected, connecting, connect]);

  // Inline picker — bypasses the @solana/wallet-adapter-react-ui modal entirely
  // for environments where wallet-extension content scripts eat the modal's
  // click handlers or where its CSS gets stripped by an aggressive blocker.
  // Shows our own dropdown with the same wallet list and calls `select(name)`
  // directly. The react-ui modal is still attempted in parallel as a fallback.
  const [inlinePicker, setInlinePicker] = useState(false);

  const openPicker = useCallback(() => {
    // eslint-disable-next-line no-console
    console.info('[BlockBite] wallet picker invoked — build v6-observer-dedup');
    // Always start hidden — the observer below decides whether to show it.
    setInlinePicker(false);
    if (connecting && !connected) {
      try { select(null as unknown as Parameters<typeof select>[0]); } catch { /* ignore */ }
    }
    // 1) Try the standard modal — works in most browsers (CSP fix in 65ee8e1
    //    means the wallet adapter's network handshake no longer fails silently).
    try { setVisible(true); } catch { /* ignore */ }
    // 2) Use a MutationObserver to watch for the standard modal. If it ever
    //    appears (any time within 1500 ms), we DON'T show inline. If it never
    //    appears, we fall back to inline. Active observer also catches the case
    //    where the standard modal mounts AFTER our initial probe — in that case
    //    we close the inline picker so only one is ever visible.
    let standardSeen = false;
    const isStandardModalVisible = () => {
      const m = document.querySelector('.wallet-adapter-modal-container, .wallet-adapter-modal');
      if (!m) return false;
      const rect = (m as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const observer = new MutationObserver(() => {
      if (isStandardModalVisible()) {
        standardSeen = true;
        setInlinePicker(false);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Initial check in case the modal was already there
    if (isStandardModalVisible()) standardSeen = true;
    // Fallback timer — if no standard modal after 600 ms, show inline.
    const fallbackTimer = window.setTimeout(() => {
      if (!standardSeen && !isStandardModalVisible()) {
        setInlinePicker(true);
      }
    }, 600);
    // Stop observing after 1500 ms either way (modal animations complete by then).
    window.setTimeout(() => {
      observer.disconnect();
      window.clearTimeout(fallbackTimer);
    }, 1500);
  }, [connecting, connected, select, setVisible]);

  const pickWallet = useCallback((adapterName: string) => {
    setInlinePicker(false);
    try {
      // select() is type-narrowed to WalletName | null in the adapter; cast at the call site
      select(adapterName as unknown as Parameters<typeof select>[0]);
    } catch (e) {
      console.warn('[wallet] inline select failed:', e);
    }
  }, [select]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const [username, setUsername] = useState('');
  const avatarId = useMyAvatar();
  const tn = useT('nav');
  const tw = useT('shop');

  useEffect(() => {
    const sync = () => setUsername(localStorage.getItem('bb_username') || '');
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCopy = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Disconnected ──────────────────────────────────────────────
  if (!connected || !publicKey) {
    return (
      <div style={{ position: 'relative' }} ref={dropdownRef}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openPicker}
          title={connecting ? tn('wallet_reset_hint') : tn('wallet_connect_hint')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          {connecting ? (
            <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />{tn('wallet_connecting')}</>
          ) : (
            <>{tn('connect_wallet')}</>
          )}
        </button>

        {/* Inline fallback picker — appears 200 ms after click in case the
            standard wallet-adapter-react-ui modal is blocked by a browser
            extension. Lists every adapter that's been installed by the
            WalletProvider with a "Detected" badge for browser extensions
            actually present on this device. */}
        {inlinePicker && (
          <div
            data-testid="bb-inline-wallet-picker"
            data-build="v6-2026-05-18-observer-dedup"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              minWidth: 280,
              zIndex: 10000,
              background: 'rgba(10,10,24,0.96)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(125,211,252,0.35)',
              borderRadius: 14,
              padding: 12,
              boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 22px rgba(125,211,252,0.15)',
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
            }}
            role="dialog"
            aria-label={tn('wallet_select')}
          >
            <div style={{
              fontSize: 10, letterSpacing: 2.5, color: '#7dd3fc',
              fontWeight: 800, marginBottom: 10, textTransform: 'uppercase',
            }}>
              {tn('wallet_pick')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wallets.map(w => {
                const ready = w.readyState === 'Installed' || w.readyState === 'Loadable';
                return (
                  <button
                    key={w.adapter.name}
                    type="button"
                    onClick={() => pickWallet(w.adapter.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 10,
                      background: ready ? 'rgba(125,211,252,0.10)' : 'rgba(255,255,255,0.03)',
                      border: ready ? '1px solid rgba(125,211,252,0.30)' : '1px solid rgba(255,255,255,0.07)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {w.adapter.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.adapter.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} />
                    )}
                    <span style={{ flex: 1 }}>{w.adapter.name}</span>
                    {ready && (
                      <span style={{
                        fontSize: 9, letterSpacing: 1.5, color: '#86efac',
                        background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(134,239,172,0.35)',
                        padding: '3px 7px', borderRadius: 999,
                      }}>
                        {tn('wallet_detected')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setInlinePicker(false)}
              style={{
                width: '100%', marginTop: 10, padding: '8px 12px',
                background: 'transparent', color: '#94a3b8',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {tn('cancel')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Connected ─────────────────────────────────────────────────
  const base58 = publicKey.toBase58();

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        type="button"
        className={`${styles.triggerPill} ${dropdownOpen ? styles.open : ''}`}
        onClick={() => setDropdownOpen(!dropdownOpen)}
      >
        <PlayerAvatar id={avatarId} size={28} />
        <div className={styles.triggerInfo}>
          <span className={styles.triggerName}>{username || shortenAddress(base58)}</span>
          <span className={styles.triggerStatus}>{tw('wallet_connected')}</span>
        </div>
        <svg
          width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="#8888BB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`${styles.chevron} ${dropdownOpen ? styles.rotated : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {dropdownOpen && (
        <div className={styles.dropdown}>
          <>
              <div className={styles.profileHeader}>
                <div className={styles.avatarWrap}>
                  <PlayerAvatar id={avatarId} size={44} />
                  <Link
                    href="/profile"
                    className={styles.avatarEditBtn}
                    onClick={() => setDropdownOpen(false)}
                    aria-label={tw('wallet_change_avatar')}
                    title={tw('wallet_change_avatar')}
                  ><span aria-hidden>✎</span></Link>
                </div>
                <div className={styles.profileMeta}>
                  <div className={styles.profileUsername}>{username || shortenAddress(base58)}</div>
                  <button
                    type="button"
                    className={`${styles.copyBtn} ${copied ? styles.copied : ''}`}
                    onClick={handleCopy}
                  >
                    {copied ? tw('wallet_copied') : shortenAddress(base58)}
                  </button>
                  {wallet?.adapter.name && (
                    <div className={styles.walletBadge}>
                      {wallet.adapter.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={wallet.adapter.icon} alt="" className={styles.walletBadgeIcon} />
                      )}
                      {wallet.adapter.name}
                    </div>
                  )}
                </div>
              </div>

              <nav className={styles.navLinks}>
                {([
                  { href: '/shop',        label: tw('wallet_buy') },
                  { href: '/leaderboard', label: tn('leaderboard') },
                ]).map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className={styles.navLink}
                    onClick={() => setDropdownOpen(false)}
                  >
                    {label}
                  </Link>
                ))}
                <Link href="/profile" className={styles.navLink} onClick={() => setDropdownOpen(false)}>
                  {tw('wallet_change_avatar')}
                </Link>
              </nav>

              <button
                type="button"
                className={styles.disconnectBtn}
                onClick={() => { disconnect(); setDropdownOpen(false); }}
              >
                <DisconnectIcon />{tn('disconnect')}
              </button>
          </>
        </div>
      )}
    </div>
  );
}

function DisconnectIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
