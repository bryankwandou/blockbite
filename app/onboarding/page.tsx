'use client';
import { useApp } from '@/lib/useApp';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT, useLang, LOCALES } from '@/lib/i18n';

export default function OnboardingPage() {
  const { theme } = useApp();
  const router = useRouter();
  const tt = useT('onboarding');
  const lang = useLang();
  const rtl = LOCALES.find((x) => x.code === lang)?.dir === 'rtl';
  const [idx, setIdx] = useState(0);
  const slides = [1, 2, 3, 4].map((n) => [`0${n}`, tt(`s${n}_t`), tt(`s${n}_d`)]);
  const s = slides[idx];
  return (
    <main data-theme={theme} className="onboard" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
      <div className="ic">{s[0]}</div>
      <h1>{s[1]}</h1>
      <p>{s[2]}</p>
      <div className="dots">{slides.map((_, i) =>
        <span key={i} data-on={i === idx}/>)}</div>
      <button onClick={() => (idx >= slides.length - 1 ? router.push('/game') : setIdx(idx + 1))}>
        {idx === slides.length - 1 ? tt('start') : tt('next')} {rtl ? '←' : '→'}
      </button>
    </main>
  );
}
