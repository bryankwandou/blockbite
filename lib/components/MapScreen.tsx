'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Biome } from '@/lib/game/biomes';
import { levelConfig } from '@/lib/game/levelConfig';
import { getLevelTier } from '@/lib/game/constants';
import SagaMap from '@/components/map/SagaMap';
import { BIOMES, biomeForAct, TOTAL_ACTS } from '@/lib/game/biomes';
import { useT } from '@/lib/i18n';
import { useNumber } from '@/components/game/useNumber';

type T =(key: string, vars?: Record<string, string | number>) => string;

const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Level title from levelConfig, shown through the `map` namespace. */
function levelTitle(t: T, level: number): string {
  const raw = levelConfig(level).title;
  if (raw.startsWith('BOSS: ')) return t('title_boss', { name: t(`title_${slug(raw.slice(6))}`) });
  if (raw.startsWith('FINAL: ')) {
    const b = BIOMES.find((x) => x.name === raw.slice(7));
    return t('title_final', { name: b ? t(`biome_${b.id}`) : raw.slice(7) });
  }
  return t(`title_${slug(raw)}`);
}

const tierKey = (tier: string) => `tier_${tier.toLowerCase()}`;

export type Layout = 'mobile' | 'tablet' | 'desktop';

interface Props {
  biome: Biome;
  currentLevel: number;
  layout: Layout;
  onEnterLevel: (lvl: number) => void;
  walletAddress?: string;
}

// One SVG node per level (500 per act). Virtualization only paints nodes
// near the viewport, so the cost is ~60 rendered <g> elements at a time
// regardless of total length.
// Drawing width in SVG units. Phones get a narrower drawing so the same node
// sizes come out ~1.7x larger on screen: at 800 units a 360px phone shrank
// everything to 45% and level numbers were ~5px tall.
const SVG_W_WIDE   = 800;
const SVG_W_NARROW = 480;
// Nodes keep this share of the width; the rest is margin so edge nodes and
// the active node's pulse ring are not clipped.
const PATH_SPAN    = 0.9;
const NODE_DY     = 70;           // SVG units between consecutive levels
                                  // Was 130 — too sparse, made the SVG 650K tall and put
                                  // huge swaths of dark fog between levels. 70 gives a
                                  // candy-crush-tight switchback while keeping levels
                                  // distinguishable.
const SVG_MARGIN  = 140;          // top + bottom padding inside SVG
const VIS_BUFFER  = 1200;         // SVG units of nodes to render outside viewport
const REVEAL_AHEAD = 5;           // how many locked-but-near nodes to show ahead
const ART_TILE_H  = 700;          // biome backdrop tile height in SVG units
                                  // Was 1200 — made tile #0 fade out before reaching
                                  // Level 1, leaving a dark band over the active area.
                                  // 700 lines up with the new node density so each tile
                                  // covers ~10 levels of path.

function romanize(n: number) {
  if (!(n >= 1 && n <= 3999)) return String(n);
  const R: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of R) while (n >= v) { out += r; n -= v; }
  return out;
}

function usePlayerData(currentLevel: number) {
  const [username, setUsername]       = useState('');
  const [gamesPlayed, setGamesPlayed] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = localStorage.getItem('bb_username') || '';
    const g = parseInt(localStorage.getItem('bb_games_played') ?? '0');
    setUsername(u === 'Explorer' ? '' : u);
    setGamesPlayed(isNaN(g) ? 0 : g);
  }, [currentLevel]);

  return { username, gamesPlayed, tier: getLevelTier(currentLevel) };
}

type Vault = { balance: number; live: boolean };

function usePrizePool(): Vault {
  const [pool, setPool] = useState<Vault>({ balance: 0, live: false });
  useEffect(() => {
    fetch('/api/prizepool')
      .then(r => r.json())
      .then(d => setPool({ balance: typeof d.balance === 'number' ? d.balance : 0, live: d.source === 'on-chain' }))
      .catch(() => {});
  }, []);
  return pool;
}

function Avatar({ biome, small }: { biome: Biome; small?: boolean }) {
  const size = small ? 36 : 48;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `radial-gradient(circle at 30% 30%, ${biome.glow}, ${biome.accent}, ${biome.rock})`,
      border: `2px solid ${biome.glow}`,
      boxShadow: `0 0 ${small ? 8 : 14}px ${biome.accent}88`,
      flexShrink: 0,
    }} />
  );
}

function Pill({ label, value, biome, small }: {
  label: string; value: string | number; biome: Biome; small?: boolean;
}) {
  return (
    <div style={{
      padding: small ? '6px 10px' : '8px 12px', borderRadius: 12,
      background: 'rgba(0,0,0,0.4)', border: `1px solid ${biome.accent}44`,
      display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: biome.glow, opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: small ? 12 : 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  );
}

function ActSelector({ biome }: { biome: Biome }) {
  const t = useT('map');
  return (
    <div style={{
      flexShrink: 0,
      padding: '8px 12px',
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'rgba(8,8,22,0.7)', backdropFilter: 'blur(14px)',
      borderTop: `1px solid ${biome.accent}22`,
      borderBottom: `1px solid ${biome.accent}33`,
      overflowX: 'auto', whiteSpace: 'nowrap',
    }}>
      <span style={{
        fontSize: 10, letterSpacing: 2, color: biome.glow, opacity: 0.7,
        marginInlineEnd: 6, flexShrink: 0,
      }}>
        {t('acts')}
      </span>
      {/* 1,000 acts: show a window of 8 around the current one (themes repeat). */}
      {Array.from({ length: 8 }, (_, i) => Math.min(TOTAL_ACTS - 7, Math.max(1, biome.act - 3)) + i).map((a) => {
        const b = biomeForAct(a);
        const active = b.act === biome.act;
        return (
          <Link
            key={b.act}
            href={`/map/${b.act}`}
            style={{
              flexShrink: 0,
              padding: '7px 13px', borderRadius: 999,
              background: active
                ? `linear-gradient(135deg, ${b.accent}, ${b.glow})`
                : 'rgba(255,255,255,0.04)',
              border: active
                ? `1px solid ${b.glow}`
                : `1px solid ${b.accent}33`,
              color: active ? '#0a0a14' : '#cbd5e1',
              fontSize: 11, fontWeight: active ? 900 : 600,
              letterSpacing: 1, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              boxShadow: active ? `0 0 14px ${b.accent}66` : 'none',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: 2,
              background: b.accent,
              boxShadow: `0 0 6px ${b.glow}`,
            }} />
            {t('act_n', { n: romanize(b.act) })}
            <span style={{ opacity: active ? 0.75 : 0.6, fontWeight: 600 }}>
              {t(`biome_${b.id}`)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

const NAV_ITEMS = [
  { href: '/game',        key: 'nav_play' },
  { href: '/leaderboard', key: 'nav_leaderboard' },
  { href: '/shop',        key: 'nav_shop' },
  { href: '/how-to-play', key: 'nav_guide' },
];

function MobileTabBar({ biome }: { biome: Biome }) {
  const t = useT('map');
  return (
    <div style={{
      flexShrink: 0,
      padding: '10px 16px 16px',
      background: 'rgba(8,8,22,0.96)', backdropFilter: 'blur(16px)',
      borderTop: `1px solid ${biome.accent}33`,
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
    }}>
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '7px 12px', borderRadius: 16,
          background: item.href === '/game'
            ? `linear-gradient(135deg, ${biome.accent}, ${biome.glow})`
            : 'transparent',
          color: item.href === '/game' ? '#0a0a14' : '#cbd5e1',
          fontWeight: item.href === '/game' ? 800 : 500,
          fontSize: 10, textDecoration: 'none',
          boxShadow: item.href === '/game' ? `0 0 16px ${biome.accent}88` : 'none',
        }}>
          {t(item.key)}
        </Link>
      ))}
    </div>
  );
}

function DesktopRail({
  biome, username, gamesPlayed, tier, currentLevel, walletAddress,
}: {
  biome: Biome; username: string;
  gamesPlayed: number; tier: string; currentLevel: number; walletAddress?: string;
}) {
  void currentLevel;
  const t = useT('map');
  const displayName = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : username || t('explore');
  return (
    <div style={{
      width: 240, flexShrink: 0, padding: 24,
      background: 'rgba(8,8,22,0.55)', backdropFilter: 'blur(16px)',
      borderInlineEnd: `1px solid ${biome.accent}33`,
      display: 'flex', flexDirection: 'column', gap: 6,
      height: '100%',
      position: 'relative', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Avatar biome={biome} small />
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, color: biome.glow }}>{t(tierKey(tier)).toUpperCase()}</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{displayName}</div>
          <div style={{ fontSize: 10, opacity: 0.75, color: '#94a3b8' }}>{t('games_played_n', { n: gamesPlayed })}</div>
        </div>
      </div>
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 10,
          background: item.href === '/game' ? `${biome.accent}22` : 'transparent',
          border: item.href === '/game' ? `1px solid ${biome.accent}55` : '1px solid transparent',
          color: item.href === '/game' ? biome.glow : '#cbd5e1',
          fontSize: 14, fontWeight: item.href === '/game' ? 700 : 500,
          textDecoration: 'none',
        }}>
          {t(item.key)}
        </Link>
      ))}
      <div style={{ marginTop: 'auto' }}>
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: 'rgba(0,0,0,0.45)', border: `1px solid ${biome.glow}55`,
          fontSize: 12, fontWeight: 600, lineHeight: 1.45, color: '#e2e8f0', width: '100%',
        }}>
          {t('free_note')}
        </div>
      </div>
    </div>
  );
}

function TopHeader({ biome, layout, username, tier }: {
  biome: Biome; layout: Layout; username: string; tier: string;
}) {
  const t = useT('map');
  const pad = layout === 'mobile' ? 14 : 22;
  return (
    <div style={{
      padding: `${pad}px ${pad}px 10px`,
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%)',
      position: 'relative', zIndex: 2, flexShrink: 0,
    }}>
      <Avatar biome={biome} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: biome.glow, opacity: 0.85 }}>
          {t('act_n', { n: romanize(biome.act) })} · {t(`cohort_${biome.cohort.toLowerCase()}`)} · {t(tierKey(tier)).toUpperCase()}
        </div>
        <div style={{ fontSize: layout === 'mobile' ? 18 : 24, fontWeight: 800, lineHeight: 1.1, overflowWrap: 'anywhere' }}>
          {username || t('explore')}
        </div>
      </div>
    </div>
  );
}

function SideCards({
  biome, level, layout, onEnterLevel, prizePool,
}: {
  biome: Biome; level: number; layout: Layout;
  onEnterLevel: (l: number) => void; prizePool: Vault;
}) {
  const t = useT('map');
  const { num } = useNumber();
  return (
    <div style={{
      width: layout === 'desktop' ? 360 : 280, padding: 20,
      background: 'rgba(8,8,22,0.65)', backdropFilter: 'blur(12px)',
      borderInlineStart: `1px solid ${biome.accent}33`,
      display: 'flex', flexDirection: 'column', gap: 14,
      overflowY: 'auto', minWidth: 0,
    }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: biome.glow }}>{t('up_next')}</div>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, overflowWrap: 'anywhere' }}>
        {t('level_n', { n: num(level) })}<br />
        <span style={{ color: biome.glow }}>{levelTitle(t, level)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
        <Pill label={t('pill_tier')} value={t(tierKey(getLevelTier(level)))} biome={biome} />
        <Pill label={t('pill_act')}  value={romanize(biome.act)}               biome={biome} />
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#cbd5e1' }}>{t('free_note')}</p>
      <button
        type="button"
        onClick={() => onEnterLevel(level)}
        style={{
          marginTop: 2, padding: '14px 20px', borderRadius: 14,
          background: `linear-gradient(135deg, ${biome.accent}, ${biome.glow})`,
          color: '#0a0a14', fontWeight: 900, fontSize: 16, border: 'none',
          boxShadow: `0 4px 0 rgba(0,0,0,0.45)`, cursor: 'pointer',
        }}
      >
        {t('play_level', { n: num(level) })}
      </button>
      <div style={{
        marginTop: 'auto', padding: 14, borderRadius: 14,
        background: 'rgba(0,0,0,0.4)', border: `1px solid ${biome.accent}33`,
      }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: biome.glow, opacity: 0.9 }}>
          {t('vault_title')}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
          {num(prizePool.balance, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          <span style={{ fontSize: 11, opacity: 0.7, marginInlineStart: 6 }}>USDC</span>
        </div>
        <div style={{ fontSize: 11, color: '#cbd5e1', opacity: 0.8, marginTop: 2 }}>
          {prizePool.live ? t('vault_live') : t('vault_pending')}
        </div>
        <Link href="/ranked" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, fontWeight: 700, color: biome.glow }}>
          {t('vault_link')}
        </Link>
      </div>
    </div>
  );
}

function BottomCard({
  biome, level, onEnterLevel,
}: {
  biome: Biome; level: number;
  onEnterLevel: (l: number) => void;
}) {
  const t = useT('map');
  const { num } = useNumber();
  return (
    <div style={{
      padding: '14px 16px 0',
      background: 'rgba(8,8,22,0.85)', backdropFilter: 'blur(14px)',
      borderTop: `1px solid ${biome.accent}44`,
      flexShrink: 0, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: biome.glow }}>{t('up_next')}</div>
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15, marginTop: 4, overflowWrap: 'anywhere' }}>
        {t('level_n', { n: num(level) })}: <span style={{ color: biome.glow }}>{levelTitle(t, level)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 12px', alignItems: 'center', minWidth: 0 }}>
        <Pill label={t('pill_tier')} value={t(tierKey(getLevelTier(level)))} biome={biome} small />
        <Pill label={t('pill_act')}  value={romanize(biome.act)}               biome={biome} small />
        <button
          type="button"
          onClick={() => onEnterLevel(level)}
          style={{
            marginInlineStart: 'auto', padding: '10px 20px', borderRadius: 999, flexShrink: 0,
            background: `linear-gradient(135deg, ${biome.accent}, ${biome.glow})`,
            color: '#0a0a14', fontWeight: 900, fontSize: 13, border: 'none',
            boxShadow: `0 3px 0 rgba(0,0,0,0.45)`, cursor: 'pointer',
          }}
        >
          {t('play')}
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 11, lineHeight: 1.45, color: '#cbd5e1', opacity: 0.85 }}>
        {t('free_note')}
      </p>
    </div>
  );
}

export function MapScreen({ biome, currentLevel, layout, onEnterLevel, walletAddress }: Props) {
  const t         = useT('map');
  const { num }   = useNumber();
  const player    = usePlayerData(currentLevel);
  const prizePool = usePrizePool();
  const isDesktop = layout === 'desktop';
  const isTablet  = layout === 'tablet';
  const isMobile  = layout === 'mobile';
  const displayName = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : player.username || t('explore');

  return (
    <div style={{
      width: '100%', height: '100vh',
      background: biome.sky, color: '#fff',
      fontFamily: '"Space Grotesk", system-ui, sans-serif',
      display: 'flex',
      flexDirection: isDesktop ? 'row' : 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Real-time 3D biome backdrop — terrain, lighting, fog, scattered
          props, winding path. Renders BEHIND the SVG candy-crush layer so
          clicks on level nodes still work. Gated on a small client-side
          delay so the SVG paints first and the WebGL context creation can't
          block first paint. Can be force-disabled via localStorage
          `bb_3d_disabled=1` — protects users whose GPU drivers refuse a
          WebGL context. */}
      {/* Subtle vignette to anchor the UI on top of the 3D scene. */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1,
        background: `radial-gradient(ellipse at 50% 60%, transparent 0%, transparent 35%, rgba(0,0,0,0.55) 100%)`,
        pointerEvents: 'none',
      }} />
      {isDesktop && (
        <DesktopRail
          biome={biome}
          username={player.username}
          gamesPlayed={player.gamesPlayed}
          tier={player.tier}
          currentLevel={currentLevel}
          walletAddress={walletAddress}
        />
      )}

      {!isDesktop && (
        <TopHeader
          biome={biome}
          layout={layout}
          username={displayName}
          tier={player.tier}
        />
      )}

      {/* Main column. On desktop it sits to the right of DesktopRail inside
          the outer flex-ROW container; flex:1 there means "grow to fill the
          remaining width". On mobile/tablet the outer is flex-COLUMN and
          this same div stacks below TopHeader; flex:1 there means "grow to
          fill the remaining height" and its width comes from align-items:
          stretch.
          PREVIOUS BUG: had `width: 0` which forced the wrapper to zero
          cross-axis on the mobile flex-column outer, collapsing every child
          inside (act selector, map, BottomCard) and leaving only TopHeader
          + badge visible. Replaced with width:'100%' so mobile gets full
          viewport width; desktop's `flex: 1 1 0` still distributes width
          via the main-axis growth path. */}
      <div style={{
        flex: '1 1 0', display: 'flex', flexDirection: 'column',
        width: '100%',
        height: '100%',
        minWidth: 0, minHeight: 0, overflow: 'hidden',
        position: 'relative', zIndex: 2,
      }}>

      {/* 8-act selector strip — lets the player browse every biome map. */}
      <ActSelector biome={biome} />

      <div style={{
        flex: 1, display: 'flex',
        // Mobile = column (map on top, bottom card below + tab bar).
        // Tablet + desktop = row (map fills left, side cards on the right).
        flexDirection: isMobile ? 'column' : 'row',
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0,
      }}>
        <SagaMap
          biome={biome}
          playerLevel={currentLevel}
          compact={isMobile}
          onEnterLevel={onEnterLevel}
          titleFor={(lvl) => levelTitle(t, lvl)}
        />

        {!isMobile ? (
          <SideCards
            biome={biome}
            level={currentLevel}
            layout={layout}
            onEnterLevel={onEnterLevel}
            prizePool={prizePool}
          />
        ) : (
          <BottomCard
            biome={biome}
            level={currentLevel}
            onEnterLevel={onEnterLevel}
          />
        )}
      </div>
      </div>{/* close the new column wrapper holding ActSelector + map+sidecards row */}

      {isMobile && <MobileTabBar biome={biome} />}

    </div>
  );
}
