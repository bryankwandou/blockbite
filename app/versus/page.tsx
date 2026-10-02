'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import VersusMatch from '@/components/versus/VersusMatch';
import { useT } from '@/lib/i18n';
import { BOT_LEVELS, type BotLevel } from '@/lib/versus/bot';
import { randomSeed } from '@/lib/versus/deal';
import s from '@/components/versus/versus.module.css';

export default function VersusPage() {
  const t = useT('versus');
  const [level, setLevel] = useState<BotLevel>('pro');
  const [seed, setSeed] = useState<string | null>(null);

  return (
    <>
      <Navbar />
      <main className={s.page}>
        <h1 className={s.title}>{t('title')}</h1>
        <p className={s.sub}>{t('subtitle')}</p>
        <span className={s.badge}>{t('for_fun')}</span>

        {seed ? (
          <VersusMatch
            key={seed}
            seed={seed}
            level={level}
            onRematch={() => setSeed(randomSeed())}
            onLevels={() => setSeed(null)}
          />
        ) : (
          <section className={s.card} aria-labelledby="vs-pick">
            <h2 id="vs-pick" className={s.cardTitle}>{t('pick_level')}</h2>
            <div className={s.levels} role="radiogroup" aria-labelledby="vs-pick">
              {BOT_LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  className={`${s.level} ${level === l ? s.levelOn : ''}`}
                  onClick={() => setLevel(l)}
                >
                  <strong>{t(`level_${l}`)}</strong>
                  <span>{t(`level_${l}_desc`)}</span>
                </button>
              ))}
            </div>
            <ul className={s.sub}>
              <li>{t('rule_1')}</li>
              <li>{t('rule_2')}</li>
              <li>{t('rule_3')}</li>
            </ul>
            <button type="button" className={s.btn} onClick={() => setSeed(randomSeed())}>{t('start')}</button>
          </section>
        )}
      </main>
    </>
  );
}
