'use client';

import { useEffect, useRef, useState } from 'react';
import GameCanvas from '@/components/game/GameCanvas';
import { useT } from '@/lib/i18n';
import { MODES, modeStyle } from '@/lib/game/modes';
import s from './Adventure.module.css';

// Real numbers from lib/game/scoring.ts + constants.ts (8 blocks × 10 pts per line × multiplier).
const SCORING = [
  { lines: 1, pts: 80, mult: '×1', color: 'var(--ds-block-5, #7dd3fc)' },
  { lines: 2, pts: 240, mult: '×1.5', color: 'var(--ds-block-2, #5eead4)' },
  { lines: 3, pts: 480, mult: '×2', color: 'var(--ds-block-3, #fbbf24)' },
  { lines: 4, pts: 960, mult: '×3', color: 'var(--ds-block-6, #fb923c)' },
  { lines: 5, pts: 2000, mult: '×5', color: 'var(--ds-block-4, #f472b6)' },
];

/**
 * /game: the board and nothing else competing with it. One slim bar names
 * the mode; scoring and tips live behind the "?" button (closed by default,
 * Esc or a click outside closes it again).
 */
export default function AdventureShell() {
  const t = useT('game');
  const rules = MODES.free;
  const [help, setHelp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelp(false); };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setHelp(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [help]);

  return (
    <main className={s.main} data-mode="free" style={modeStyle('free')}>
      <div className={s.focus}>
        <div className={s.barWrap} ref={wrap}>
          <header className={s.modeBar}>
            <h1 className={s.modeTitle}>{t(rules.nameKey)}</h1>
            <span className={s.modeRules}>
              {[t('rule_level_goal'), !rules.timer && t('rule_no_timer'), rules.hints && t('rule_hints_on')].filter(Boolean).join(' · ')}
            </span>
            <button
              type="button"
              className={s.helpBtn}
              aria-expanded={help}
              aria-controls="adv-help"
              aria-label={help ? t('help_close') : t('help_open')}
              title={help ? t('help_close') : t('help_open')}
              onClick={() => setHelp((v) => !v)}
            >
              {help ? '×' : '?'}
            </button>
          </header>

          {help && (
            <div id="adv-help" className={s.helpPanel} role="region" aria-label={t('help_open')}>
              <section aria-labelledby="adv-scoring">
                <h2 id="adv-scoring" className={s.cardTitle}>{t('scoring_title')}</h2>
                <ul className={s.rows}>
                  {SCORING.map((r) => (
                    <li key={r.lines} className={s.row}>
                      <span className={s.bars} aria-hidden>
                        {Array.from({ length: Math.min(r.lines, 5) }).map((_, i) => (
                          <span key={i} className={s.bar} style={{ background: r.color }} />
                        ))}
                      </span>
                      <span className={s.rowLabel}>
                        {r.lines === 1 ? t('scoring_lines_1') : r.lines >= 5 ? t('scoring_lines_5') : t('scoring_lines_n', { n: r.lines })}
                        {' · '}
                        {t('scoring_points', { n: r.pts })}
                      </span>
                      <span className={s.mult}>{r.mult}</span>
                    </li>
                  ))}
                </ul>
                <p className={s.note}>{t('scoring_chain')}</p>
              </section>
              <section aria-labelledby="adv-tips">
                <h2 id="adv-tips" className={s.cardTitle}>{t('tips_title')}</h2>
                <ol className={s.tips}>
                  <li className={s.tip}>{t('tip_keys')}</li>
                  <li className={s.tip}>{t('tip_click')}</li>
                  <li className={s.tip}>{t('tip_space')}</li>
                </ol>
              </section>
            </div>
          )}
        </div>

        <GameCanvas />
      </div>
    </main>
  );
}
