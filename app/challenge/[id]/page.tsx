'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import NameForm from '@/components/versus/NameForm';
import SoloRun from '@/components/versus/SoloRun';
import { useT } from '@/lib/i18n';
import type { LogMove } from '@/lib/versus/deal';
import type { Challenge } from '@/lib/versus/store';
import s from '@/components/versus/versus.module.css';

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; c: Challenge };

export default function ChallengePage({ params }: { params: { id: string } }) {
  const t = useT('challenge');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [phase, setPhase] = useState<'view' | 'play' | 'done' | 'sent'>('view');
  const [mine, setMine] = useState<{ log: LogMove[]; score: number } | null>(null);
  const [round, setRound] = useState(0);

  const fetchIt = useCallback(async () => {
    const r = await fetch(`/api/challenge/${encodeURIComponent(params.id)}`, { cache: 'no-store' }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    setLoad(j?.found ? { state: 'ok', c: j.challenge } : { state: 'missing' });
  }, [params.id]);

  useEffect(() => { fetchIt(); }, [fetchIt]);

  const send = async (name: string) => {
    if (!mine) return null;
    const r = await fetch(`/api/challenge/${encodeURIComponent(params.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, log: mine.log }),
    }).catch(() => null);
    if (!r || !r.ok) return r?.status === 429 ? t('err_rate') : r?.status === 409 ? t('err_full') : t('err_save');
    setPhase('sent');
    await fetchIt();
    return null;
  };

  return (
    <>
      <Navbar />
      <main className={s.page}>
        <h1 className={s.title}>{t('title')}</h1>
        <span className={s.badge}>{t('for_fun')}</span>

        {load.state === 'loading' && <p className={s.sub}>{t('loading')}</p>}

        {load.state === 'missing' && (
          <section className={s.card}>
            <h2 className={s.cardTitle}>{t('missing_title')}</h2>
            <p className={s.sub}>{t('missing_body')}</p>
            <div className={s.row}>
              <Link href="/challenge" className={s.btn}>{t('start_own')}</Link>
              <Link href="/versus" className={s.btnGhost}>{t('try_bot')}</Link>
            </div>
          </section>
        )}

        {load.state === 'ok' && (() => {
          const c = load.c;
          return (
            <>
              <p className={s.sub}>{t('invite', { name: c.name, n: c.score.toLocaleString() })}</p>

              {phase === 'play' && (
                <SoloRun
                  key={round}
                  seed={c.seed}
                  ghost={c.curve}
                  ghostName={c.name}
                  onDone={(log, score) => { setMine({ log, score }); setPhase('done'); }}
                />
              )}

              {(phase === 'done' || phase === 'sent') && mine && (
                <section className={`${s.card} ${s.result}`} aria-live="polite">
                  <h2 className={s.resultTitle}>{mine.score > c.score ? t('you_beat', { name: c.name }) : mine.score < c.score ? t('they_won', { name: c.name }) : t('tie')}</h2>
                  <div className={s.versusScores}>
                    <div><strong>{t('you')}</strong><div className={s.score}>{mine.score.toLocaleString()}</div></div>
                    <div><strong>{c.name}</strong><div className={s.score}>{c.score.toLocaleString()}</div></div>
                  </div>
                  {phase === 'done' ? <NameForm cta={t('post_score')} onSubmit={send} /> : <p className={s.note}>{t('posted')}</p>}
                  <div className={s.row} style={{ justifyContent: 'center', marginTop: 10 }}>
                    <button type="button" className={s.btnGhost} onClick={() => { setRound((n) => n + 1); setMine(null); setPhase('play'); }}>{t('retry')}</button>
                    <Link href="/challenge" className={s.btnGhost}>{t('start_own')}</Link>
                  </div>
                </section>
              )}

              {phase === 'view' && (
                <div className={s.row} style={{ marginBottom: 16 }}>
                  <button type="button" className={s.btn} onClick={() => setPhase('play')}>{t('play_it')}</button>
                </div>
              )}

              <section className={s.card} aria-labelledby="ch-board">
                <h2 id="ch-board" className={s.cardTitle}>{t('scores')}</h2>
                <ol className={s.list}>
                  <li><span>{c.name} · {t('challenger')}</span><strong>{c.score.toLocaleString()}</strong></li>
                  {c.replies.map((r, i) => (
                    <li key={i}><span>{r.name}</span><strong>{r.score.toLocaleString()}</strong></li>
                  ))}
                </ol>
                {c.replies.length === 0 && <p className={s.note}>{t('no_replies')}</p>}
              </section>
            </>
          );
        })()}
      </main>
    </>
  );
}
