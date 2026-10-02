'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

const CREW = [
  {
    src: '/mascots/mascot-brawler.png',
    name: 'Rex',
    title: 'The King',
    color: '#9499e8',
    glow: '#9499e844',
    tag: 'ROYALTY',
    bio: 'Crowned ruler of the board. Rex plays with iron discipline — every move is calculated, every block placed for maximum domination. Fear the crown.',
  },
  {
    src: '/mascots/mascot-sunny.png',
    name: 'Tide',
    title: 'The Wave',
    color: '#6ec8e0',
    glow: '#6ec8e044',
    tag: 'FLOW',
    bio: 'Cool as deep water. Tide reads the board like ocean currents — fluid, adaptive, unstoppable. Block by block, the tide always rises.',
  },
  {
    src: '/mascots/mascot-rex.png',
    name: 'Brawler',
    title: 'The Fighter',
    color: '#d94553',
    glow: '#d9455344',
    tag: 'POWER',
    bio: 'No mercy, no retreat. Brawler charges every Act head-on, smashing through obstacles with raw aggression. The board will break before he does.',
  },
  {
    src: '/mascots/mascot-tide.png',
    name: 'Sunny',
    title: 'The Spark',
    color: '#e1a438',
    glow: '#e1a43844',
    tag: 'ENERGY',
    bio: 'Pure joy, pure chaos. Sunny turns even the hardest levels into a party — always smiling, always surprising, always stealing the win.',
  },
];

export default function MascotsPage() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 0%, #16103a 0%, #07060f 60%)',
      color: '#fff',
      fontFamily: "'Montserrat', 'Space Grotesk', system-ui, sans-serif",
      overflowX: 'hidden',
    }}>
      <style>{`
        @keyframes bbFloat  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        @keyframes bbPulse  { 0%,100%{opacity:.7} 50%{opacity:1} }
        @keyframes bbFadeUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        .crew-card { transition: transform .25s ease, box-shadow .25s ease; }
        .crew-card:hover { transform: translateY(-8px) scale(1.02); }
      `}</style>

      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(7,6,15,0.85)', backdropFilter: 'blur(20px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#fff' }}>
          <img src="/logo.png" alt="BlockBite" width={32} height={32} style={{ objectFit: 'contain' }} />
          <span style={{ fontSize: 17, fontWeight: 900 }}>BlockBite</span>
        </Link>
        <div style={{ flex: 1 }} />
        <Link href="/game" style={{
          padding: '8px 20px', borderRadius: 999,
          background: 'linear-gradient(135deg, #a78bfa, #7dd3fc)',
          color: '#0a0a14', fontWeight: 900, fontSize: 13, textDecoration: 'none',
          letterSpacing: '.5px',
        }}>PLAY NOW</Link>
      </nav>

      {/* Hero */}
      <section style={{
        textAlign: 'center',
        padding: 'clamp(48px,8vw,96px) 24px 32px',
        animation: 'bbFadeUp .6s ease both',
      }}>
        <div style={{
          display: 'inline-block', fontSize: 11, letterSpacing: 3,
          color: '#a78bfa', marginBottom: 16,
          padding: '6px 16px', borderRadius: 999,
          border: '1px solid rgba(167,139,250,.35)',
          background: 'rgba(167,139,250,.08)',
          fontWeight: 800,
        }}>
          BLOCKBITE UNIVERSE
        </div>

        <h1 style={{
          fontSize: 'clamp(36px, 8vw, 80px)',
          fontWeight: 900, letterSpacing: '-2px',
          margin: '0 0 16px',
          lineHeight: .95,
        }}>
          Meet the{' '}
          <span style={{
            background: 'linear-gradient(135deg, #a78bfa 0%, #7dd3fc 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Crew</span>
        </h1>

        <p style={{
          fontSize: 'clamp(13px,1.8vw,17px)',
          color: '#94a3b8', maxWidth: 520, margin: '0 auto 56px',
          lineHeight: 1.65,
        }}>
          Four characters. One mission. Conquer 4,000 levels and claim rewards on-chain.
        </p>
      </section>

      {/* Mascot grid */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 20,
        maxWidth: 1120,
        margin: '0 auto',
        padding: '0 24px 80px',
      }}>
        {CREW.map((m, i) => (
          <div
            key={m.name}
            className="crew-card"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            style={{
              borderRadius: 24,
              border: `1px solid ${active === i ? m.color + '80' : 'rgba(255,255,255,0.07)'}`,
              background: active === i
                ? `radial-gradient(ellipse at 50% 0%, ${m.glow} 0%, rgba(8,8,20,0.9) 70%)`
                : 'rgba(8,8,20,0.6)',
              backdropFilter: 'blur(16px)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '36px 24px 28px',
              cursor: 'default',
              boxShadow: active === i ? `0 0 48px ${m.glow}` : 'none',
              animation: `bbFadeUp .5s ease both`,
              animationDelay: `${i * .1}s`,
            }}
          >
            {/* Tag */}
            <div style={{
              alignSelf: 'flex-start',
              fontSize: 9, fontWeight: 800, letterSpacing: 2,
              color: m.color,
              padding: '4px 10px', borderRadius: 999,
              border: `1px solid ${m.color}55`,
              background: `${m.color}18`,
              marginBottom: 20,
            }}>
              {m.tag}
            </div>

            {/* Mascot PNG */}
            <div style={{
              position: 'relative',
              width: 200, height: 200,
              animation: `bbFloat ${3.2 + i * .4}s ease-in-out infinite`,
              animationDelay: `${i * .25}s`,
              marginBottom: 24,
            }}>
              {/* glow */}
              <div aria-hidden style={{
                position: 'absolute', inset: '15%', borderRadius: '50%',
                background: `radial-gradient(circle, ${m.color}55 0%, transparent 70%)`,
                filter: 'blur(18px)',
                animation: 'bbPulse 3s ease-in-out infinite',
                animationDelay: `${i * .3}s`,
              }} />
              <Image
                src={m.src} alt={m.name}
                width={200} height={200}
                priority={i < 2}
                style={{
                  objectFit: 'contain', position: 'relative', zIndex: 1,
                  filter: `drop-shadow(0 12px 24px ${m.color}88)`,
                }}
              />
            </div>

            {/* Info */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-1px', marginBottom: 2 }}>
                {m.name}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: m.color, marginBottom: 14 }}>
                {m.title.toUpperCase()}
              </div>
              <p style={{
                fontSize: 13, color: '#94a3b8', lineHeight: 1.65,
                margin: 0, maxWidth: 240,
              }}>
                {m.bio}
              </p>
            </div>
          </div>
        ))}
      </section>

      {/* Bottom CTA */}
      <section style={{
        textAlign: 'center',
        padding: '0 24px 80px',
        animation: 'bbFadeUp .7s ease both',
        animationDelay: '.4s',
      }}>
        <div style={{
          maxWidth: 480, margin: '0 auto',
          padding: '40px 32px',
          borderRadius: 24,
          border: '1px solid rgba(167,139,250,.2)',
          background: 'rgba(167,139,250,.05)',
        }}>
          <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>
            Choose your character.
          </div>
          <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            Enter the game, pick your playstyle, and fight for a spot at the top of the on-chain leaderboard.
          </p>
          <Link href="/game" style={{
            display: 'inline-block',
            padding: '14px 36px', borderRadius: 14,
            background: 'linear-gradient(135deg, #a78bfa, #7dd3fc)',
            color: '#0a0a14', fontWeight: 900, fontSize: 15,
            textDecoration: 'none', letterSpacing: '.5px',
            boxShadow: '0 0 32px rgba(167,139,250,.4)',
          }}>
            PLAY NOW
          </Link>
        </div>
      </section>
    </div>
  );
}
