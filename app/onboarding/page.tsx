'use client';
import { useApp } from '@/lib/useApp';
import { useState } from 'react';

export default function OnboardingPage() {
  const { t, lang, theme } = useApp();
  const [idx, setIdx] = useState(0);
  const slides = (lang === 'id' ? [
    ['01','Selamat Datang','Game match-3 dengan hadiah USDC on-chain.'],
    ['02','Beli Tiket','Mulai dari $1 USDC.'],
    ['03','Selesaikan Babak','500 level → bukti on-chain → klaim USDC.'],
    ['04','Cooldown 24h','Dipaksa oleh program Solana.'],
  ] : [
    ['01','Welcome','On-chain match-3 with real USDC rewards.'],
    ['02','Buy Tickets','Starts at $1 USDC.'],
    ['03','Clear Acts','500 levels → on-chain proof → claim USDC.'],
    ['04','24h Cooldown','Enforced by the Solana program.'],
  ]);
  const s = slides[idx];
  return (
    <main data-theme={theme} className="onboard">
      <div className="ic">{s[0]}</div>
      <h1>{s[1]}</h1>
      <p>{s[2]}</p>
      <div className="dots">{slides.map((_, i) =>
        <span key={i} data-on={i === idx}/>)}</div>
      <button onClick={() => setIdx(Math.min(slides.length - 1, idx + 1))}>
        {idx === slides.length - 1
          ? (lang === 'id' ? 'Mulai' : 'Get Started')
          : (lang === 'id' ? 'Lanjut' : 'Next')} →
      </button>
    </main>
  );
}
