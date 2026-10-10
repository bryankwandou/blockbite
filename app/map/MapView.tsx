'use client';

/**
 * Shared body of /map and /map/[act].
 *
 * /map used to render nothing and then router.replace() to /map/<act>. That
 * left a blank screen for a second or more (several seconds on a cold dev
 * server) and picked the act with `level / 5000`, while acts are 500 levels
 * each, so a player on level 1,200 landed in Act I instead of Act III.
 * Now /map draws the player's own act in place, and the act comes from the
 * biome ranges.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { MapScreen, type Layout } from '@/lib/components/MapScreen';
import { BIOMES, biomeForAct, biomeForLevel as biomeOfLevel, type Biome } from '@/lib/game/biomes';
import { getPlayerProgress } from '@/lib/api/progress';
import { useT } from '@/lib/i18n';

// SSR has no window, so the first render assumes desktop (most visitors) and
// the effect corrects it. Breakpoints: 900+ desktop, 600-899 tablet, <600
// mobile. They stay low on purpose: a desktop browser zoomed past 200%
// reports a small innerWidth and should get the compact layout.
function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>('desktop');
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      setLayout(w >= 900 ? 'desktop' : w >= 600 ? 'tablet' : 'mobile');
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);
  return layout;
}

/** The act that contains `level`; levels past the last act stay on the last act. */
export function biomeForLevel(level: number): Biome {
  return biomeOfLevel(level);
}

function MapLoading() {
  const t = useT('map');
  const b = BIOMES[0];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        width: '100%', minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
        background: b.sky, color: '#e2e8f0', fontSize: 13, letterSpacing: '0.08em',
      }}
    >
      <div className="spinner" aria-hidden />
      {t('loading')}
    </div>
  );
}

/** `act` given: show that act. Omitted: show the act the player is currently in. */
export default function MapView({ act }: { act?: number }) {
  const router = useRouter();
  const layout = useLayout();
  const t = useT('map');
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? '';
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getPlayerProgress(wallet).then((p) => { if (live) setLevel(p.currentLevel); });
    return () => { live = false; };
  }, [wallet]);

  if (level === null) return <MapLoading />;
  const biome: Biome = act !== undefined ? biomeForAct(act) : biomeForLevel(level);

  // The real level, not clamped to this act: nodes below it show as cleared,
  // above it as locked, so browsing another act tells the truth.
  const currentLevel = Math.max(1, level);

  return (
    <main>
      {/* The map is drawn, so screen readers and the outline get its title here. */}
      <h1 className="bb-sr-only">{t('act_n', { n: biome.act })} · {biome.name}</h1>
      <MapScreen
        biome={biome}
        currentLevel={currentLevel}
        layout={layout}
        onEnterLevel={(lvl) => router.push(`/play/${lvl}`)}
        walletAddress={wallet || undefined}
      />
    </main>
  );
}
