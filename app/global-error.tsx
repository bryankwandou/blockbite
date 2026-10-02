'use client';
/**
 * Global error boundary — catches throws that escape even the root layout.
 *
 * Required by Next.js App Router: when the root layout itself throws
 * (provider init crash, wallet adapter throwing during initial render,
 * Supabase env-var read failure in a layout-level component) the regular
 * app/error.tsx boundary is unmounted along with the layout. This file
 * replaces the entire <html>/<body> tree with a minimal recovery card.
 *
 * Keep this file dependency-free — it must render without the providers
 * that may have caused the crash.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app/global-error] root-level uncaught:', error);
  }, [error]);

  const hardReload = () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem('walletName');
      window.sessionStorage.clear();
    } catch { /* ignore */ }
    window.location.reload();
  };

  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: '100vh', width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 30%, #1a1a3e 0%, #08081a 100%)',
        color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 480, width: '100%',
          background: 'rgba(8,8,22,0.85)',
          border: '1px solid rgba(167,139,250,0.4)',
          borderRadius: 18, padding: 28, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: '#a78bfa', marginBottom: 8 }}>
            CRITICAL — ROOT FAILURE
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, marginBottom: 12 }}>
            BlockBite tripped during startup.
          </h1>
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 22 }}>
            The app couldn&apos;t mount. Usually a stale wallet session
            or a browser extension conflict. Clear the session and
            reload — that resolves nearly every case.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button" onClick={reset}
              style={{
                padding: '12px 18px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #a78bfa, #7dd3fc)',
                color: '#0a0a14', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                letterSpacing: 0.5,
              }}
            >
              TRY AGAIN
            </button>
            <button
              type="button" onClick={hardReload}
              style={{
                padding: '12px 18px', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                letterSpacing: 0.5,
              }}
            >
              CLEAR SESSION &amp; RELOAD
            </button>
            <a href="/" style={{
              padding: '10px', color: '#94a3b8', fontSize: 12,
              textDecoration: 'underline',
            }}>
              Hard-navigate to home
            </a>
          </div>
          {error?.digest && (
            <div style={{
              marginTop: 18, fontSize: 10, color: '#64748b',
              fontFamily: 'monospace', opacity: 0.6,
            }}>
              digest: {error.digest}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
