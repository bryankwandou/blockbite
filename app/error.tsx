'use client';
/**
 * Root-level error boundary — catches uncaught throws from any route under
 * app/ (homepage, distribute, partnership, profile, leaderboard, shop, …).
 *
 * Without this, an exception during render or in a useEffect with no try/catch
 * (e.g. wallet adapter glitch, fetch returning unexpected shape, hydration
 * mismatch) bubbles to the Next.js default which BLANKS the screen and leaves
 * the user no path back. That was the recurring "blank page" complaint from
 * production — 0% recovery rate.
 *
 * This boundary renders a small recovery card with:
 *   - Try Again (resets the boundary — re-runs the failing tree)
 *   - Back to Home
 *   - Clear cache + reload (heavy hammer if Try Again loops)
 *   - error.digest (Next.js server-bound digest for log correlation)
 */

import { useEffect } from 'react';
import Link from 'next/link';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app/error] uncaught:', error);
  }, [error]);

  const hardReload = () => {
    if (typeof window === 'undefined') return;
    try {
      // Bust local + sessionStorage in case stale wallet adapter state is the cause.
      window.localStorage.removeItem('walletName');
      window.sessionStorage.clear();
    } catch { /* ignore */ }
    window.location.reload();
  };

  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 30%, #1a1a3e 0%, #08081a 100%)',
      color: '#fff', fontFamily: "'Montserrat', 'Space Grotesk', system-ui, sans-serif",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 480, width: '100%',
        background: 'rgba(8,8,22,0.7)',
        border: '1px solid rgba(167,139,250,0.35)',
        borderRadius: 18, padding: 28, textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: '#a78bfa', marginBottom: 8 }}>
          SOMETHING TRIPPED
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, marginBottom: 10 }}>
          We hit a snag rendering this page.
        </h1>
        <p style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 22 }}>
          Usually a transient browser issue or a stale wallet session.
          Try again first — if it loops, the heavy reload below clears
          local state and gets you a fresh start.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={reset}
            style={{
              padding: '12px 18px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #a78bfa, #7dd3fc)',
              color: '#0a0a14', fontWeight: 800, fontSize: 14, cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            TRY AGAIN
          </button>
          <Link href="/" style={{
            padding: '12px 18px', borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
            letterSpacing: 0.5,
          }}>
            BACK TO HOME
          </Link>
          <button
            onClick={hardReload}
            style={{
              padding: '10px 18px', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#94a3b8', fontWeight: 600, fontSize: 12, cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            Clear session &amp; reload
          </button>
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
    </div>
  );
}
