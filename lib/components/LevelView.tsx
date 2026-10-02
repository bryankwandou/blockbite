'use client';

import React from 'react';
import type { LevelConfig } from '@/lib/game/levelConfig';
import type { Biome } from '@/lib/game/biomes';
import { ART } from '@/lib/components/MapArt';
import { BLOCK_DEFS } from '@/lib/game/blockDefs';

export type Layout = 'mobile' | 'tablet' | 'desktop';

interface Props {
  cfg: LevelConfig;
  layout: Layout;
  onSubmit?: (score: number) => void;
  onBack?: () => void;
}

function Pulse({ label, value, biome }: { label: string; value: number | string; biome: Biome }) {
  return (
    <div style={{
      padding: '6px 12px', borderRadius: 14, background: 'rgba(0,0,0,0.45)',
      border: `1px solid ${biome.accent}55`, textAlign: 'center', minWidth: 56,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 1.4, color: biome.glow, opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function Booster({ icon, label, biome }: { icon: string; label: string; biome: Biome }) {
  return (
    <button style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      padding: '8px 14px', borderRadius: 14,
      background: 'rgba(0,0,0,0.45)', border: `1px solid ${biome.accent}55`,
      color: biome.glow, fontWeight: 700, cursor: 'pointer', minWidth: 64,
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 10, color: '#cbd5e1' }}>{label}</span>
    </button>
  );
}

function Board({ cfg, blockSize }: { cfg: LevelConfig; blockSize: number }) {
  const cells: { kind: string; x: number; y: number }[] = [];
  cfg.board.forEach((row, y) => row.forEach((c, x) => cells.push({ ...c, x, y })));
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(8, ${blockSize}px)`,
      gap: 3, padding: 10, borderRadius: 18,
      background: 'rgba(0,0,0,0.55)',
      border: `1px solid ${cfg.biome.accent}55`,
      boxShadow: `0 0 40px ${cfg.biome.accent}33, inset 0 0 24px rgba(0,0,0,0.5)`,
    }}>
      {cells.map((c, i) => {
        const def = BLOCK_DEFS[c.kind];
        return (
          <div key={i} style={{
            width: blockSize, height: blockSize, borderRadius: 8,
            background: c.kind === 'empty' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${cfg.biome.accent}22`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {def ? def.render(blockSize - 4) : null}
          </div>
        );
      })}
    </div>
  );
}

function LevelHeader({ biome, cfg, layout, onBack }: { biome: Biome; cfg: LevelConfig; layout: Layout; onBack?: () => void }) {
  return (
    <div style={{
      padding: layout === 'mobile' ? '16px 16px 8px' : '20px 24px 12px',
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
      position: 'relative', zIndex: 2,
    }}>
      <button onClick={onBack} style={{
        width: 36, height: 36, borderRadius: 12, border: `1px solid ${biome.accent}55`,
        background: 'rgba(0,0,0,0.4)', color: biome.glow, cursor: 'pointer', fontSize: 18,
      }}>‹</button>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.8, color: biome.glow, opacity: 0.85 }}>
          {biome.name.toUpperCase()} · {cfg.rarity}
        </div>
        <div style={{ fontSize: layout === 'mobile' ? 18 : 22, fontWeight: 800 }}>
          Level {cfg.level} — {cfg.title}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pulse label="MOVES" value={cfg.moves} biome={biome}/>
        <Pulse label="GOAL" value={cfg.goal} biome={biome}/>
      </div>
    </div>
  );
}

function LevelFooter({ biome, layout, onSubmit }: { biome: Biome; layout: Layout; onSubmit?: () => void }) {
  return (
    <div style={{
      padding: layout === 'mobile' ? '12px 16px 16px' : '16px 24px 20px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 100%)',
      position: 'relative', zIndex: 2,
    }}>
      <Booster icon="↻" label="Shuffle" biome={biome}/>
      <Booster icon="*" label="Bomb" biome={biome}/>
      <Booster icon=">" label="Hint" biome={biome}/>
      <button onClick={onSubmit} style={{
        marginLeft: 'auto', padding: '12px 22px', borderRadius: 999,
        background: `linear-gradient(135deg, ${biome.accent}, ${biome.glow})`,
        color: '#0a0a14', fontWeight: 900, fontSize: 14, border: 'none', cursor: 'pointer',
        boxShadow: `0 0 16px ${biome.accent}88`,
      }}>
        SUBMIT SCORE
      </button>
    </div>
  );
}

function LevelSidebar({ biome, cfg }: { biome: Biome; cfg: LevelConfig }) {
  return (
    <div style={{
      width: 280, padding: 24, background: 'rgba(8,8,22,0.6)', backdropFilter: 'blur(14px)',
      borderRight: `1px solid ${biome.accent}33`,
      display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', zIndex: 2,
    }}>
      <div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: biome.glow }}>OBJECTIVES</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
          Clear {cfg.goal} {cfg.targetType} blocks
        </div>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 }}>
          Match 3+ adjacent blocks. Reach goal within {cfg.moves} moves to claim ◆ {cfg.reward}.
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, letterSpacing: 2, color: biome.glow }}>ACTIVE FX</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {biome.fx.map((id, i) => (
            <div key={i} style={{
              padding: '8px 10px', borderRadius: 10, fontSize: 12,
              background: 'rgba(0,0,0,0.35)', border: `1px solid ${biome.accent}33`,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{id.replace(/-/g,' ').toUpperCase()}</span>
              <span style={{ color: biome.glow, fontSize: 10 }}>ACTIVE</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 'auto', padding: 14, borderRadius: 14, background: 'rgba(0,0,0,0.4)', border: `1px solid ${biome.accent}33` }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: biome.glow }}>REWARD</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>◆ {cfg.reward}</div>
        <div style={{ fontSize: 11, color: biome.glow, marginTop: 4 }}>{cfg.rarity}</div>
      </div>
    </div>
  );
}

export function LevelView({ cfg, layout, onSubmit, onBack }: Props) {
  const biome = cfg.biome;
  const Art = ART[biome.id];
  const blockSize = layout === 'desktop' ? 56 : layout === 'tablet' ? 64 : 38;
  const isDesktop = layout === 'desktop';

  return (
    <div style={{
      width: '100%', minHeight: '100vh', background: biome.sky, color: '#fff',
      fontFamily: '"Space Grotesk", system-ui, sans-serif',
      display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Ambient backdrop */}
      <svg viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.35, pointerEvents: 'none' }}>
        {Art && <Art b={biome}/>}
      </svg>

      {isDesktop && <LevelSidebar biome={biome} cfg={cfg}/>}

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <LevelHeader biome={biome} cfg={cfg} layout={layout} onBack={onBack}/>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: layout === 'mobile' ? 12 : 24, position: 'relative',
        }}>
          <Board cfg={cfg} blockSize={blockSize}/>
        </div>
        <LevelFooter biome={biome} layout={layout} onSubmit={onSubmit ? () => onSubmit(0) : undefined}/>
      </div>
    </div>
  );
}
