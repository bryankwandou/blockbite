'use client';

import { useEffect, useState } from 'react';

interface PrizePoolCounterProps {
  size?: 'sm' | 'md' | 'lg' | 'hero';
}

/** Live prize-pool vault balance from /api/prizepool (read on-chain). */
export default function PrizePoolCounter({ size = 'md' }: PrizePoolCounterProps) {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/prizepool')
      .then((r) => r.json())
      .then((d) => { if (alive) setBalance(typeof d.balance === 'number' ? d.balance : 0); })
      .catch(() => { if (alive) setBalance(0); });
    return () => { alive = false; };
  }, []);

  const fontSizeMap = {
    sm:   { main: 18, sub: 10 },
    md:   { main: 28, sub: 12 },
    lg:   { main: 42, sub: 14 },
    hero: { main: 68, sub: 16 },
  };
  const { main, sub } = fontSizeMap[size];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: sub,
        fontWeight: 600,
        color: '#8888BB',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
      }}>
        Prize Pool
      </span>
      <span style={{
        fontFamily: "'Orbitron', monospace",
        fontSize: main,
        fontWeight: 900,
        background: 'linear-gradient(135deg, #FFD700, #FF8C00)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        lineHeight: 1.1,
      }}>
        {balance === null ? '…' : balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
        <span style={{
          fontSize: main * 0.45,
          background: 'linear-gradient(135deg, #FFD700, #FF8C00)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>USDC</span>
      </span>
      <span style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: sub - 1,
        color: '#55557A',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#00FF88', display: 'inline-block',
          animation: 'pulseGlow 2s infinite',
        }} />
        On-chain balance · Grows with every ticket sold
      </span>
    </div>
  );
}
