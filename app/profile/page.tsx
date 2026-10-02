'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { useWallet } from '@solana/wallet-adapter-react';
import { Edit2, Check, Copy, ExternalLink } from 'lucide-react';
import { PlayerAvatar, useMyAvatar } from '@/components/CssAvatars';
import { AVATARS, getAvatar, saveAvatar, type AvatarGroup } from '@/lib/avatars';
import { explorerAddr } from '@/lib/solana/config';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import { useT } from '@/lib/i18n';
import Link from 'next/link';
import { AvatarBuilder } from '@/components/avatar/AvatarBuilder';
import PartnerRewards from '@/components/partner/PartnerRewards';
import k from '@/components/PageKit.module.css';
import styles from './profile.module.css';

export default function ProfilePage() {
  const t = useT('profile');
  const tc = useT('common');
  const myAvatar = useMyAvatar();
  const [avatarSave, setAvatarSave] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');
  const [group, setGroup] = useState<AvatarGroup | 'all'>('all');
  const { publicKey, wallet } = useWallet();
  const [username, setUsername] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [refCopied, setRefCopied] = useState(false);
  const [maxLevel, setMaxLevel] = useState(1);
  const [gamesPlayed, setGamesPlayed] = useState(0);

  useEffect(() => {
    try {
      const u = localStorage.getItem('bb_username') || '';
      setUsername(u);
      setEditValue(u);
      const lvl = parseInt(localStorage.getItem('bb_max_level') || '1');
      setMaxLevel(isNaN(lvl) ? 1 : lvl);
      const gp = parseInt(localStorage.getItem('bb_games_played') || '0');
      setGamesPlayed(isNaN(gp) ? 0 : gp);
    } catch { /* storage blocked */ }
  }, []);

  // Sync maxLevel from server when wallet is connected (source of truth)
  useEffect(() => {
    if (!publicKey) return;
    const addr = publicKey.toBase58();
    fetch(`/api/profile?addr=${encodeURIComponent(addr)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (typeof data.currentLevel === 'number' && data.currentLevel >= 1) {
          setMaxLevel(data.currentLevel);
          try { localStorage.setItem('bb_max_level', String(data.currentLevel)); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, [publicKey]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    setUsername(trimmed);
    try { localStorage.setItem('bb_username', trimmed); } catch { /* ignore */ }
    window.dispatchEvent(new Event('storage'));
    setIsEditing(false);
  };

  const handleAvatarSelect = async (id: string) => {
    const wallet = publicKey?.toBase58();
    setAvatarSave(wallet ? 'saving' : 'local');
    const ok = await saveAvatar(id, wallet);
    if (wallet) setAvatarSave(ok ? 'saved' : 'local');
  };

  const walletAddr = publicKey?.toBase58() ?? '';
  const refLink = walletAddr ? `https://blockbite.vercel.app/r/${walletAddr}` : '';

  const handleCopy = () => {
    if (!walletAddr) return;
    navigator.clipboard.writeText(walletAddr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyRef = () => {
    if (!refLink) return;
    navigator.clipboard.writeText(refLink).catch(() => {});
    setRefCopied(true);
    setTimeout(() => setRefCopied(false), 2000);
  };

  const displayAddr = walletAddr ? `${walletAddr.slice(0, 6)}…${walletAddr.slice(-6)}` : t('not_connected');
  const avatar = getAvatar(myAvatar);
  const shown = group === 'all' ? AVATARS : AVATARS.filter((a) => a.group === group);
  const GROUPS: (AvatarGroup | 'all')[] = ['all', 'crew', 'bite', 'gem', 'pilot'];

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('title')}</div>
            <div className={styles.hero} style={{ marginTop: 14 }}>
              <div className={styles.avatarWrap}>
                <PlayerAvatar id={avatar.id} size={80} selected label={avatar.name} />
                {wallet?.adapter.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wallet.adapter.icon} alt={wallet.adapter.name} className={styles.walletBadgeIcon} />
                )}
              </div>

              <div className={styles.info}>
                <div className={styles.usernameRow}>
                  {isEditing ? (
                    <div className={styles.editInputWrap}>
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        className={styles.usernameInput}
                        placeholder={t('name_placeholder')}
                        aria-label={t('name_placeholder')}
                        maxLength={24}
                        autoFocus
                      />
                      <button type="button" onClick={handleSave} className={styles.editBtn} title={t('save')} aria-label={t('save')}>
                        <Check size={18} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h1 className={styles.name}>{username || t('anon')}</h1>
                      <button type="button" onClick={() => setIsEditing(true)} className={styles.editBtn} title={t('edit_name')} aria-label={t('edit_name')}>
                        <Edit2 size={16} />
                      </button>
                    </>
                  )}
                </div>

                <div className={styles.walletAddrRow}>
                  <span className={styles.walletAddr} dir="ltr">{displayAddr}</span>
                  {walletAddr && (
                    <>
                      <button type="button" className={`${styles.iconBtn} ${copied ? styles.copiedIcon : ''}`} onClick={handleCopy} title={t('copy_addr')} aria-label={t('copy_addr')}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <a
                        href={explorerAddr(walletAddr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.iconBtn}
                        title={t('view_explorer')}
                        aria-label={t('view_explorer')}
                      >
                        <ExternalLink size={14} />
                      </a>
                    </>
                  )}
                </div>
                <p className={k.body} style={{ marginTop: 6, fontSize: 13 }}>{t('name_note')}</p>
              </div>
            </div>
          </div>
        </header>

        <div className={k.wrap}>
          {/* Avatar builder */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('builder_title')}</h2>
            <p className={k.body} style={{ marginBottom: 12 }}>{t('builder_note')}</p>
            <div className={k.card}>
              <AvatarBuilder current={avatar.id} onUse={handleAvatarSelect} />
              <p className={k.body} style={{ marginTop: 14 }} aria-live="polite">
                {t('selected', { name: avatar.name })}
                {avatarSave === 'saving' && ` · ${tc('avatar_saving')}`}
                {avatarSave === 'saved' && ` · ${tc('avatar_saved')}`}
                {avatarSave === 'local' && ` · ${tc('avatar_local')}`}
              </p>
            </div>
          </section>

          {/* Classic avatars */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('classic_title')}</h2>
            <div className={k.card}>
              <div role="group" aria-label={tc('avatar_filter')} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {GROUPS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={group === g}
                    className={k.btn}
                    style={{ padding: '6px 12px', fontSize: 13, opacity: group === g ? 1 : 0.6 }}
                    onClick={() => setGroup(g)}
                  >
                    {tc(`avatar_group_${g}`)}
                  </button>
                ))}
              </div>
              <div
                role="radiogroup"
                aria-label={t('avatar_title')}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 10, maxHeight: 360, overflowY: 'auto', padding: 4 }}
              >
                {shown.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={avatar.id === a.id}
                    aria-label={a.name}
                    title={a.name}
                    className={styles.pick}
                    style={{ justifySelf: 'center' }}
                    onClick={() => handleAvatarSelect(a.id)}
                  >
                    <PlayerAvatar id={a.id} size={48} selected={avatar.id === a.id} />
                  </button>
                ))}
              </div>
              <p className={k.body} style={{ marginTop: 14 }}>
                {tc('avatar_count', { n: AVATARS.length })}
              </p>
            </div>
          </section>

          {/* Adventure stats */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('stats_title')}</h2>
            <div className={k.stats} style={{ marginTop: 0 }}>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{t('stat_games')}</span>
                <span className={k.statV}>{gamesPlayed}</span>
                <span className={k.statNote}>{t('stat_games_note')}</span>
              </div>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{t('stat_level')}</span>
                <span className={k.statV}>{maxLevel}</span>
                <span className={k.statNote}>{t('stat_level_note')}</span>
              </div>
            </div>
            <p className={k.body} style={{ marginTop: 12 }}><Link href="/achievements" className={k.btn}>{t('ach_link')}</Link></p>
          </section>

          <PartnerRewards />

          {/* Referral */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('ref_title')}</h2>
            <div className={k.card}>
              <p className={k.body} style={{ color: 'var(--ds-text, #fff)' }}>{t('ref_desc')}</p>
              <div className={styles.referralLinkWrap}>
                <input
                  type="text"
                  readOnly
                  dir="ltr"
                  value={refLink || t('ref_connect')}
                  aria-label={t('ref_title')}
                  className={styles.referralInput}
                />
                <button type="button" className={k.btn} onClick={copyRef} disabled={!refLink}>
                  {refCopied ? t('ref_copied') : t('ref_copy')}
                </button>
              </div>
              <p className={k.body} style={{ marginTop: 14, fontSize: 13 }}>{RANKED_SALES_OPEN ? t('ref_note_open') : t('ref_note')}</p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
