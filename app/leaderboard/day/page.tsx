'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Podium, { type PodiumRow } from '@/components/leaderboard/Podium';
import { PlayerAvatar } from '@/components/CssAvatars';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import s from './day.module.css';

interface DayData {
  day: string;
  final: boolean;
  commitment: string;
  seed?: string;
  leaderboard?: PodiumRow[];
  runs?: unknown[];
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function shortWallet(addr: string) {
  return addr.length < 12 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Time left until the next UTC midnight, as h:mm:ss. */
function useUntilMidnight() {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const sec = Math.max(0, Math.floor((end - now.getTime()) / 1000));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
      setLeft(`${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return left;
}

/**
 * Human view of /api/ranked/day: the day's results with the animated podium
 * once final, or the sealed seed fingerprint and a countdown while it runs.
 */
function DayResults() {
  const t = useT('leaderboard');
  const day = useSearchParams().get('d') ?? todayUtc();
  const [data, setData] = useState<DayData | null>(null);
  const [failed, setFailed] = useState(false);
  const left = useUntilMidnight();

  useEffect(() => {
    setData(null);
    setFailed(false);
    fetch(`/api/ranked/day?d=${encodeURIComponent(day)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setFailed(true));
  }, [day]);

  const rows = data?.leaderboard ?? [];
  const api = `/api/ranked/day?d=${encodeURIComponent(day)}`;

  return (
    <div className={`${k.wrap} ${s.top}`}>
      <section className={k.section}>
        <p className={k.kicker}>{t('day_kicker')}</p>
        <h1 className={k.title}>{t('day_title', { day })}</h1>

        {!data && !failed && <p className={k.dim}>{t('loading')}</p>}
        {failed && <p className={k.msgErr}>{t('day_error')}</p>}

        {data && !data.final && (
          <div className={s.sealed}>
            <div className={s.lock} aria-hidden>
              <span className={s.shackle} />
              <span className={s.body} />
            </div>
            <span className={`${k.tag} ${k.tagWarn}`}>{t('day_live')}</span>
            <p className={s.big}>{t('day_sealed')}</p>
            {day === todayUtc() && <p className={s.clock} dir="ltr">{left}</p>}
            <p className={k.dim}>{t('day_sealed_desc')}</p>
            <p className={s.label}>{t('day_fingerprint')}</p>
            <code className={s.hash}>{data.commitment}</code>
          </div>
        )}

        {data && data.final && (
          <>
            <span className={`${k.tag} ${k.tagOk}`}>{t('day_final')}</span>
            {rows.length > 0 ? (
              <>
                <Podium rows={rows.slice(0, 3)} tabKey={`day-${day}`} unit={t('col_score')} me={null} />
                <ol className={s.list}>
                  {rows.slice(3, 50).map((r, i) => (
                    <li key={r.wallet} className={s.row} style={{ animationDelay: `${i * 40}ms` }}>
                      <span className={s.rank}>{i + 4}</span>
                      <PlayerAvatar id={r.avatarId} size={28} />
                      <span className={s.wallet} dir="ltr" title={r.wallet}>{shortWallet(r.wallet)}</span>
                      <span className={s.score}>{r.score.toLocaleString('en-US')}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className={s.big}>{t('day_nobody')}</p>
            )}
            <div className={s.facts}>
              <div><p className={s.label}>{t('day_runs')}</p><p className={s.factV}>{(data.runs?.length ?? 0).toLocaleString('en-US')}</p></div>
              <div><p className={s.label}>{t('day_players')}</p><p className={s.factV}>{rows.length.toLocaleString('en-US')}</p></div>
            </div>
            <p className={s.label}>{t('day_seed')}</p>
            <code className={s.hash}>{data.seed}</code>
            <p className={s.label}>{t('day_fingerprint')}</p>
            <code className={s.hash}>{data.commitment}</code>
          </>
        )}

        <div className={s.links}>
          <Link href="/leaderboard" className={k.btn}>{t('day_back')}</Link>
          <a href={api} className={k.btnGhost} target="_blank" rel="noopener noreferrer">{t('day_raw')}</a>
        </div>
      </section>
    </div>
  );
}

export default function DayPage() {
  return (
    <main className={k.page}>
      <Navbar />
      <Suspense fallback={null}>
        <DayResults />
      </Suspense>
    </main>
  );
}
