'use client';

import { useParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import GameCanvas from '@/components/game/GameCanvas';
import { biomeForLevel, type Biome } from '@/lib/game/biomes';
import { useT } from '@/lib/i18n';
import { useNumber } from '@/components/game/useNumber';
import { MAX_GAME_LEVEL } from '@/lib/game/constants';

/**
 * Backdrop3D is intentionally a no-op as of 2026-05-16 — see the matching
 * comment in lib/components/MapScreen.tsx. The biome.sky gradient + biome.fog
 * tint + radial vignette layers below still give the page its themed feel,
 * without any WebGL dependency.
 */
function Backdrop3D(_props: { biome: Biome; progress: number }) {
  return null;
}

export default function PlayLevelPage() {
  const params = useParams<{ level: string }>();
  const level = Math.max(1, Math.min(MAX_GAME_LEVEL, parseInt(params.level || '1', 10) || 1));
  const router = useRouter();
  const t = useT('game');
  const tm = useT('map');
  const { num } = useNumber();

  // Pick the biome that owns this level so the in-game backdrop matches the
  // map theme the player just came from (Crystal/Frost/Ember/.../Apex).
  const biome = biomeForLevel(level);
  const progress = Math.max(
    0,
    Math.min(1, (level - biome.range[0]) / Math.max(1, biome.range[1] - biome.range[0])),
  );

  return (
    <>
      {/* Real-time 3D biome backdrop — fixed behind the entire game UI so
          the canvas always plays "inside" the act's landscape. Pointer
          events disabled so it never blocks game controls. */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: -2,
          background: biome.sky, overflow: 'hidden', pointerEvents: 'none',
        }}
      >
        <Backdrop3D biome={biome} progress={progress} />
      </div>
      {/* Vignette + biome fog tint above the 3D layer for legibility. */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: -1,
          background: biome.fog, pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, zIndex: -1,
          background: `radial-gradient(ellipse at 50% 50%, transparent 0%, transparent 40%, rgba(0,0,0,0.55) 100%)`,
          pointerEvents: 'none',
        }}
      />

      <Navbar />
      <main style={{ paddingTop: 64, minHeight: '100vh' }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto', paddingBlock: '12px 0', paddingInline: 'clamp(12px, 4vw, 24px)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0,
        }}>
          {/* Text uses theme tokens; the biome shows as an accent border and
              dot. Biome glow colours are pale and vanished on the light theme. */}
          <button
            type="button"
            onClick={() => router.push(`/map/${biome.act}`)}
            style={{
              minHeight: 36, padding: '7px 16px', borderRadius: 10, maxWidth: '100%',
              border: `1px solid ${biome.accent}`,
              background: 'var(--ds-surface, rgba(255,255,255,0.05))', color: 'var(--ds-text, #fff)',
              fontFamily: "'Orbitron', monospace", fontSize: 11, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.06em',
            }}
          >
            {t('back_to_map')}
          </button>
          <span style={{
            fontFamily: "'Orbitron', monospace", fontSize: 13,
            color: 'var(--ds-text, #fff)', fontWeight: 800,
          }}>
            {t('play_level', { n: num(level) })}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: "'Orbitron', monospace", fontSize: 10, fontWeight: 700,
            color: 'var(--ds-text-dim, #cbd5e1)', letterSpacing: '0.12em', maxWidth: '100%', overflowWrap: 'anywhere',
            padding: '4px 10px', borderRadius: 999,
            background: 'var(--ds-surface, rgba(255,255,255,0.05))',
            border: `1px solid ${biome.accent}`,
          }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, flex: '0 0 auto', background: biome.accent }} />
            {tm('act_n', { n: ['I','II','III','IV','V','VI','VII','VIII'][biome.act - 1] ?? num(biome.act) })} · {tm(`biome_${biome.id}`).toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: '16px 40px', paddingInline: 'clamp(8px, 4vw, 24px)', minWidth: 0 }}>
          {/* Biome-themed frame around the canvas. Border + accent tint give
              players a visual cue of which Act they're in.
              NOTE: backdrop-filter: blur() and large box-shadow blur radii were
              removed here — both are GPU-heavy compositor operations that
              crashed the renderer on lower-end mobile devices, leaving users
              with a blank /play/[level] page. The visual identity is now
              carried by the border + flat translucent fill, which costs zero
              GPU and renders identically on every device. */}
          <div style={{
            padding: 'clamp(8px, 3vw, 14px)',
            borderRadius: 24, width: '100%', maxWidth: 440, minWidth: 0,
            background: `linear-gradient(180deg, ${biome.accent}22 0%, var(--ds-surface2, rgba(8,8,22,0.55)) 60%)`,
            border: `1px solid ${biome.accent}66`,
          }}>
            {/* push, not back(): a level opened from a link or a new tab has no map behind it in history. */}
            <GameCanvas initialLevel={level} onBack={() => router.push(`/map/${biome.act}`)} biome={biome} />
          </div>
        </div>
      </main>
    </>
  );
}
