'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import NameForm from '@/components/versus/NameForm';
import SoloRun from '@/components/versus/SoloRun';
import { useT } from '@/lib/i18n';
import { randomSeed, type LogMove } from '@/lib/versus/deal';
import s from '@/components/versus/versus.module.css';

export default function ChallengeHome() {
  const t = useT('challenge');
  const [seed, setSeed] = useState<string | null>(null);
  const [result, setResult] = useState<{ log: LogMove[]; score: number } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setSeed(randomSeed()), []);

  const again = () => { setSeed(randomSeed()); setResult(null); setLink(null); setCopied(false); };

  const create = async (name: string) => {
    if (!seed || !result) return null;
    const res = await fetch('/api/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed, name, log: result.log }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j.id) return res?.status === 429 ? t('err_rate') : t('err_save');
    setLink(`${location.origin}/challenge/${j.id}`);
    return null;
  };

  const share = async () => {
    if (!link) return;
    const text = t('share_text', { n: result?.score.toLocaleString() ?? '0' });
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: 'BlockBite', text, url: link }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* clipboard blocked */ }
  };

  return (
    <>
      <Navbar />
      <main className={s.page}>
        <h1 className={s.title}>{t('title')}</h1>
        <p className={s.sub}>{t('subtitle')}</p>
        <span className={s.badge}>{t('for_fun')}</span>

        {seed && !result && <SoloRun key={seed} seed={seed} onDone={(log, score) => setResult({ log, score })} />}

        {result && (
          <section className={`${s.card} ${s.result}`} aria-live="polite">
            <p className={s.note}>{t('your_score')}</p>
            <h2 className={s.resultTitle}>{result.score.toLocaleString()}</h2>
            {link ? (
              <>
                <p className={s.sub} style={{ margin: '0 auto 10px' }}>{t('link_ready')}</p>
                <p className={s.link}>{link}</p>
                <div className={s.row} style={{ justifyContent: 'center' }}>
                  <button type="button" className={s.btn} onClick={share}>{copied ? t('copied') : t('share')}</button>
                  <Link href={link.slice(link.indexOf('/challenge/'))} className={s.btnGhost}>{t('open_board')}</Link>
                  <button type="button" className={s.btnGhost} onClick={again}>{t('play_again')}</button>
                </div>
              </>
            ) : (
              <>
                <p className={s.sub} style={{ margin: '0 auto 10px' }}>{t('make_link')}</p>
                <NameForm cta={t('create')} onSubmit={create} />
                <div className={s.row} style={{ justifyContent: 'center', marginTop: 10 }}>
                  <button type="button" className={s.btnGhost} onClick={again}>{t('play_again')}</button>
                </div>
              </>
            )}
          </section>
        )}
        <p className={s.note}><Link href="/versus">{t('try_bot')}</Link></p>
      </main>
    </>
  );
}
