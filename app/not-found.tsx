/**
 * 404 — canonical "page not found" UI.
 *
 * Replaces the Next.js default white "404: This page could not be found"
 * which previously made mistyped or stale-link visits look like the
 * site was broken. Now branded + offers an obvious path back.
 *
 * Note: uppercase route variants (/PARTNERSHIP, /SHOP, etc.) are
 * already 308-redirected to lowercase canonical paths in next.config.mjs,
 * so the most common 404 source is gone.
 */

import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 30%, #1a1a3e 0%, #08081a 100%)',
      color: '#fff', fontFamily: "'Montserrat', 'Space Grotesk', system-ui, sans-serif",
      padding: 24,
    }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{
          fontSize: 11, letterSpacing: 3, color: '#a78bfa', marginBottom: 8,
        }}>
          404 · PAGE NOT FOUND
        </div>
        <h1 style={{
          fontSize: 'clamp(40px, 8vw, 72px)', fontWeight: 900,
          background: 'linear-gradient(135deg, #a78bfa, #7dd3fc)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text', margin: '0 0 8px',
        }}>
          Lost in the Map
        </h1>
        <p style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 26 }}>
          This route doesn&apos;t exist on the on-chain side either.
          Maybe try one of these:
        </p>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10, marginBottom: 22,
        }}>
          {[
            { href: '/',            label: 'HOME' },
            { href: '/partnership', label: 'PARTNERSHIP' },
            { href: '/game',        label: 'PLAY' },
          ].map((l) => (
            <Link key={l.href} href={l.href} style={{
              padding: '12px 16px', borderRadius: 12,
              border: '1px solid rgba(167,139,250,0.4)',
              background: 'rgba(167,139,250,0.06)',
              color: '#a78bfa', fontWeight: 800, fontSize: 12,
              letterSpacing: 1.2, textDecoration: 'none',
            }}>
              {l.label}
            </Link>
          ))}
        </div>
        <Link href="/" style={{
          color: '#94a3b8', fontSize: 12, textDecoration: 'underline',
        }}>
          Or just take me home
        </Link>
      </div>
    </div>
  );
}
