'use client';

/**
 * Monthly Ranked view (gold). There is no monthly board: the monthly score is
 * the sum of a player's best daily scores (MODES.monthly.sumBestDays), read
 * from /api/ranked/leaderboard?period=month. This screen says that plainly
 * and sends the player to the daily board.
 */

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { leaderboard, type BoardRow } from '@/lib/ranked/client';
import { PlayerAvatar, useMyAvatar } from '@/components/CssAvatars';
import { MODES, modeStyle } from '@/lib/game/modes';
import { useT } from '@/lib/i18n';
import { useNumber } from './useNumber';
import styles from './GameCanvas.module.css';
import rs from './Ranked.module.css';

export default function RankedMonthly({ onPlayDaily }: { onPlayDaily: () => void }) {
  const t = useT('ranked');
  const { publicKey, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey?.toBase58() ?? null;
  const avatarId = useMyAvatar();
  const { score: fmt, num } = useNumber();
  const rules = MODES.monthly;

  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [month, setMonth] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    leaderboard('month')
      .then((r) => { if (live) { setRows(r.rows ?? []); setMonth(r.month ?? ''); } })
      .catch(() => { if (live) { setRows([]); setFailed(true); } });
    return () => { live = false; };
  }, []);

  const idx = rows && wallet ? rows.findIndex((r) => r.wallet === wallet) : -1;
  const mine = idx >= 0 && rows ? rows[idx] : null;

  return (
    <div className={rs.stage} data-mode="monthly" style={modeStyle('monthly')}>
      <div className={`${rs.card} ${rs.modeCard}`}>
        <span className={rs.kicker}>{t('monthly_kicker')}</span>
        <h1 className={rs.title}>{t('monthly_title')}</h1>
        {month && <p className={rs.sub}>{t('monthly_month', { month })}</p>}

        <p className={rs.modeExplain} data-testid="monthly-explain">{t('monthly_explain', { days: rules.sumBestDays })}</p>

        {wallet ? (
          <>
            <div className={rs.player}>
              <PlayerAvatar id={avatarId} size={44} label={t('your_avatar')} />
              <div className={rs.playerText}>
                <span className={rs.statLabel}>{t('playing_as')}</span>
                <code className={rs.playerWallet} title={wallet}>{wallet.slice(0, 4)}…{wallet.slice(-4)}</code>
              </div>
            </div>
            <div className={rs.stats}>
              <div className={rs.stat}>
                <div className={rs.statLabel}>{t('monthly_total')}</div>
                <div className={rs.statValue}>{rows === null ? '…' : fmt(mine?.score ?? 0)}</div>
              </div>
              <div className={rs.stat}>
                <div className={rs.statLabel}>{t('monthly_rank')}</div>
                <div className={rs.statValue}>{rows === null ? '…' : mine ? `#${num(idx + 1)}` : t('monthly_unranked')}</div>
              </div>
            </div>
          </>
        ) : (
          <div className={rs.player}>
            <PlayerAvatar id={avatarId} size={44} label={t('your_avatar')} />
            <p className={rs.note} style={{ margin: 0 }}>{t('monthly_connect')}</p>
          </div>
        )}

        {rows && rows.length > 0 && <p className={rs.sub}>{t('monthly_players', { n: num(rows.length) })}</p>}
        {failed && <p className={rs.note}>{t('monthly_offline')}</p>}

        <div className={rs.actions}>
          <button type="button" className={styles.btnMain} onClick={onPlayDaily}>{t('monthly_play_daily')}</button>
          {!wallet && (
            <button type="button" className={styles.btnGhost} onClick={() => setVisible(true)}>
              {connecting ? t('connecting') : t('connect_btn')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
