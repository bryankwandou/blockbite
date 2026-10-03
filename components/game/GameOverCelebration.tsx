'use client';

import BlockBurst from '@/components/leaderboard/BlockBurst';
import { useT } from '@/lib/i18n';
import s from './GameOverCelebration.module.css';

/**
 * Short, non-blocking badge shown over the game-over card for a new personal
 * best and/or a top-10 place on the free board. Never takes pointer events.
 */
export default function GameOverCelebration({ personalBest, rank }: { personalBest: boolean; rank: number | null }) {
  const t = useT('game');
  if (!personalBest && rank === null) return null;
  return (
    <div className={s.wrap} role="status">
      <BlockBurst />
      {personalBest && <span className={s.badge}>{t('new_personal_best')}</span>}
      {rank !== null && <span className={`${s.badge} ${s.top}`}>{t('top10_place', { rank })}</span>}
    </div>
  );
}
