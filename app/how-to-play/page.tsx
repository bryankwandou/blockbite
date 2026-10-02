'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { useT } from '@/lib/i18n';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import k from '@/components/PageKit.module.css';
import Tutorial from './Tutorial';
import Prizes from './Prizes';
import s from './guide.module.css';

/** 4×4 thumbnails for each rule; numbers are the filled cells. */
const RULES = [
  { key: 'board', on: [8, 12, 13] },
  { key: 'pieces', on: [0, 1, 4, 3, 7, 13, 14, 15] },
  { key: 'clear', on: [8, 9, 10, 11] },
  { key: 'end', on: [0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 15] },
] as const;

const FAQ = ['skill', 'disconnect', 'ticket', 'referral', 'open'] as const;

export default function HowToPlayPage() {
  const t = useT('guide');

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.narrow} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('kicker')}</div>
            <h1 className={k.title}>{t('title')}</h1>
            <p className={k.lede}>{t('subtitle')}</p>
            {!RANKED_SALES_OPEN && (
              <div className={k.notice} role="status">
                <p className={k.noticeText}>{t('status_note')}</p>
                <Link href="/game" className={k.btn}>{t('cta_play')}</Link>
              </div>
            )}
          </div>
        </header>

        <div className={`${k.wrap} ${k.narrow}`}>
          {/* Practice board */}
          <section className={k.section} aria-labelledby="tut-title">
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('tut_kicker')}</div>
            <h2 id="tut-title" className={k.h2} style={{ marginTop: 8, marginBottom: 8 }}>{t('tut_title')}</h2>
            <p className={k.body} style={{ marginBottom: 18 }}>{t('tut_desc')}</p>
            <Tutorial />
          </section>

          {/* Modes */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('modes_title')}</h2>
            <div className={k.grid2}>
              <div className={`${k.card} ${k.lift}`}>
                <div className={s.modeHead}>
                  <span className={s.modeName}>{t('adventure_mode')}</span>
                  <span className={`${k.tag} ${k.tagOk}`}>{t('adventure_tag')}</span>
                </div>
                <p className={k.body}>{t('adventure_desc')}</p>
              </div>
              <div className={`${k.card} ${k.lift}`}>
                <div className={s.modeHead}>
                  <span className={s.modeName}>{t('daily_ranked')}</span>
                  <span className={`${k.tag} ${k.tagAccent}`}>{t('daily_tag')}</span>
                </div>
                <p className={k.body}>{t('daily_ranked_desc')}</p>
              </div>
            </div>
          </section>

          {/* Rules */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('rules_title')}</h2>
            <div className={k.grid2}>
              {RULES.map((r) => (
                <div key={r.key} className={`${k.card} ${s.rule}`}>
                  <div className={s.mini} aria-hidden>
                    {Array.from({ length: 16 }, (_, i) => (
                      <i key={i} className={(r.on as readonly number[]).includes(i) ? s.on : undefined} />
                    ))}
                  </div>
                  <div>
                    <h3 className={k.h3}>{t(`${r.key}_title`)}</h3>
                    <p className={k.body}>{t(`${r.key}_desc`)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className={k.card} style={{ marginTop: 16 }}>
              <h3 className={k.h3}>{t('fair_title')}</h3>
              <p className={k.body}>{t('fair_desc')}</p>
            </div>
          </section>

          {/* Money */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('money_title')}</h2>
            <div className={k.card}>
              <p className={k.body}>{t('split_explain')}</p>
              <div className={s.bar} aria-hidden dir="ltr">
                <span className={s.barVault}>70%</span>
                <span className={s.barTeam}>25%</span>
                <span className={s.barRef}>5%</span>
              </div>
              {[
                { pct: '70%', cls: s.pVault, key: 'vault' },
                { pct: '25%', cls: s.pTeam, key: 'team' },
                { pct: '5%', cls: s.pRef, key: 'referrer' },
              ].map((row) => (
                <div key={row.key} className={s.splitRow}>
                  <span className={`${s.splitPct} ${row.cls}`}>{row.pct}</span>
                  <div>
                    <h3 className={k.h3}>{t(`${row.key}_label`)}</h3>
                    <p className={k.body}>{t(`${row.key}_desc`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Prizes: 40/60 split, top-10 curve, monthly score, then the claim steps */}
          <Prizes>
            <div className={k.card} style={{ marginTop: 16 }}>
              <h3 className={k.h3} style={{ marginBottom: 14 }}>{t('when_you_win')}</h3>
              <ol className={s.timeline}>
                {(['win_daily', 'win_block', 'win_claim', 'win_unclaim'] as const).map((key, i) => (
                  <li key={key}>
                    <span className={s.dot}>{i + 1}</span>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Prizes>

          {/* Risks */}
          <section className={k.section}>
            <h2 className={k.h2} style={{ color: 'var(--ds-warn, #fbbf24)' }}>{t('risks_title')}</h2>
            <div className={`${k.card} ${s.risk}`}>
              <ul className={s.riskList}>
                {([1, 2, 3, 4] as const).map((n) => (
                  <li key={n}>
                    <strong>{t(`risk_${n}_title`)}</strong>
                    <span className={k.body}>{t(`risk_${n}_desc`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* FAQ */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('faq_title')}</h2>
            {FAQ.map((q) => (
              <details key={q} className={`${k.card} ${s.faq}`}>
                <summary>{t(`q_${q}_title`)}</summary>
                <div className={s.faqBody}>
                  <p className={k.body}>{t(`q_${q}_desc`)}</p>
                </div>
              </details>
            ))}
          </section>

          {/* CTA */}
          <div className={`${k.card} ${s.cta}`}>
            <h2 className={k.h2} style={{ margin: 0 }}>{t('ready_title')}</h2>
            <p className={k.body}>{t('ready_desc')}</p>
            <div className={k.row}>
              <Link href="/game" className={k.btn}>{t('cta_play')}</Link>
              <Link href="/shop" className={k.btnGhost}>{t('cta_shop')}</Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
