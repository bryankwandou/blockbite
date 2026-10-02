import React from 'react';
import type { Biome } from '@/lib/game/biomes';

/* ───────────────────────── shared building blocks ───────────────────────── */

const Spire = ({ x, y, w, h, fill, stroke, opacity = 1 }:
  { x: number; y: number; w: number; h: number; fill: string; stroke: string; opacity?: number }) => (
  <polygon
    points={`${x},${y + h} ${x + w / 2},${y} ${x + w},${y + h}`}
    fill={fill} stroke={stroke} strokeWidth="0.6" opacity={opacity}
  />
);

/** Bell-shaped mountain silhouette with shaded face. */
const Mountain = ({
  cx, baseY, peakH, baseW, light, shadow, opacity = 1,
}: {
  cx: number; baseY: number; peakH: number; baseW: number;
  light: string; shadow: string; opacity?: number;
}) => (
  <g opacity={opacity}>
    {/* lit face */}
    <polygon
      points={`${cx - baseW / 2},${baseY} ${cx},${baseY - peakH} ${cx + baseW / 6},${baseY}`}
      fill={light} />
    {/* shadowed face */}
    <polygon
      points={`${cx + baseW / 6},${baseY} ${cx},${baseY - peakH} ${cx + baseW / 2},${baseY}`}
      fill={shadow} />
    {/* snow cap */}
    <polygon
      points={`${cx - baseW * 0.18},${baseY - peakH * 0.78} ${cx},${baseY - peakH} ${cx + baseW * 0.22},${baseY - peakH * 0.78} ${cx + baseW * 0.08},${baseY - peakH * 0.66} ${cx},${baseY - peakH * 0.72} ${cx - baseW * 0.06},${baseY - peakH * 0.62}`}
      fill="rgba(255,255,255,0.92)" />
  </g>
);

/** Quick deterministic PRNG so each tile renders the same. */
const seeded = (seed: number) => () => {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
};

/** Per-biome turbulence noise filter id. Produces realistic ground texture. */
const NoiseFilter = ({ id, scale = 6, baseFreq = 0.9 }: { id: string; scale?: number; baseFreq?: number }) => (
  <filter id={id} x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency={baseFreq} numOctaves="3" seed="7" />
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0" />
    <feComposite in="SourceGraphic" in2="floodCheck" operator="in" />
    <feDisplacementMap in="SourceGraphic" scale={scale} />
  </filter>
);

/* ───────────────────────── 8 biome art components ───────────────────────── */

export const CrystalArt = ({ b, seed = 101 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  // Procedural mountain ranges — positions jittered per tile so no two tiles
  // share the same silhouette. The bigger the jitter, the less obvious the loop.
  const farMountains = Array.from({ length: 4 }, () => ({
    cx: rng() * 440 - 20,
    baseY: 280 + rng() * 60,
    peakH: 160 + rng() * 120,
    baseW: 200 + rng() * 120,
    hueShift: Math.floor(rng() * 30) - 15,
  }));
  const midMountains = Array.from({ length: 3 }, () => ({
    cx: rng() * 440 - 20,
    baseY: 400 + rng() * 50,
    peakH: 140 + rng() * 80,
    baseW: 180 + rng() * 100,
  }));
  const archMidX1 = 100 + rng() * 60;
  const archMidY1 = 230 + rng() * 40;
  const archMidX2 = 240 + rng() * 60;
  const archMidY2 = 230 + rng() * 40;
  const archTopY  = 360 + rng() * 30;
  // Background hue tint per tile keeps each section visually distinct.
  const tintHue = Math.floor(rng() * 40) - 20;
  const crystals = Array.from({ length: 18 }, (_, i) => ({
    x: 8 + rng() * 384, baseY: 350 + rng() * 230,
    h: 50 + rng() * 220, w: 16 + rng() * 42,
    tone: Math.floor(rng() * 3),
    flip: rng() > 0.5,
  }));
  return (
    <g>
      <defs>
        <linearGradient id={`${b.id}-${seed}-c1`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e9d5ff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#a78bfa" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#4c1d95" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id={`${b.id}-${seed}-c2`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0891b2" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id={`${b.id}-${seed}-c3`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0abfc" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#a21caf" stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id={`${b.id}-${seed}-glow`} cx="50%" cy="20%" r="60%">
          <stop offset="0%" stopColor={`hsl(${260 + tintHue} 70% 70%)`} stopOpacity="0.55" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* atmospheric backdrop with per-tile hue tint */}
      <rect width="400" height="600" fill={`url(#${b.id}-${seed}-glow)`} />
      {/* far mountain range — procedural positions */}
      {farMountains.map((m, i) => (
        <Mountain key={`far-${i}`} cx={m.cx} baseY={m.baseY} peakH={m.peakH} baseW={m.baseW}
          light={`hsl(${260 + m.hueShift} 50% 30%)`} shadow={`hsl(${260 + m.hueShift} 60% 18%)`}
          opacity={0.55 + (i % 3) * 0.08} />
      ))}
      {/* mid mountain range */}
      {midMountains.map((m, i) => (
        <Mountain key={`mid-${i}`} cx={m.cx} baseY={m.baseY} peakH={m.peakH} baseW={m.baseW}
          light="#5b3d9c" shadow="#2a1c5e" opacity={0.88} />
      ))}
      {/* cavern arch — control points jittered per tile */}
      <path d={`M 0 ${archTopY + 20} Q ${archMidX1} ${archMidY1}, 200 260 Q ${archMidX2} ${archMidY2}, 400 ${archTopY + 20} L 400 600 L 0 600 Z`}
        fill={b.rock} opacity="0.92" />
      <path d={`M 40 ${archTopY} Q 200 ${archMidY1 - 20}, 360 ${archTopY} L 360 460 L 40 460 Z`}
        fill="rgba(0,0,0,0.55)" />
      {/* foreground crystal cluster — procedural, varied count */}
      {crystals.map((c, i) => {
        const grad = c.tone === 0 ? `url(#${b.id}-${seed}-c1)`
                   : c.tone === 1 ? `url(#${b.id}-${seed}-c2)`
                                  : `url(#${b.id}-${seed}-c3)`;
        const stroke = c.tone === 0 ? '#c4b5fd'
                     : c.tone === 1 ? '#67e8f9' : '#f0abfc';
        return (
          <g key={i} transform={c.flip ? `translate(${c.x + c.w} 0) scale(-1 1) translate(${-c.x} 0)` : undefined}>
            {/* shadow on ground */}
            <ellipse cx={c.x + c.w / 2 + 4} cy={c.baseY + 4}
              rx={c.w * 0.55} ry={c.w * 0.16} fill="#000" opacity="0.5" />
            <Spire x={c.x} y={c.baseY - c.h} w={c.w} h={c.h}
              fill={grad} stroke={stroke} />
            {/* specular highlight on crystal */}
            <polygon
              points={`${c.x + c.w * 0.18},${c.baseY - c.h * 0.1} ${c.x + c.w * 0.4},${c.baseY - c.h * 0.85} ${c.x + c.w * 0.32},${c.baseY - c.h * 0.18}`}
              fill="#fff" opacity="0.5" />
          </g>
        );
      })}
      {/* glowing dust motes — seeded position so per-tile placement varies */}
      {Array.from({ length: 60 }).map((_, i) => (
        <circle key={i} cx={(seed * 17 + i * 37 + 7) % 400} cy={(seed * 23 + i * 53 + 17) % 600}
          r={0.6 + (i % 3) * 0.5}
          fill="#e0f2fe" opacity={0.25 + ((i * 7) % 5) / 14} />
      ))}
    </g>
  );
};

export const FrostArt = ({ b, seed = 202 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  // Procedural peaks per tile so identical mountain silhouettes don't repeat.
  const peaks = Array.from({ length: 4 }, () => ({
    cx: rng() * 440 - 20,
    baseY: 400 + rng() * 50,
    peakH: 220 + rng() * 140,
    baseW: 200 + rng() * 100,
    tone: rng() > 0.5 ? 'light' : 'dark',
  }));
  // Mid-ridge varies per tile too.
  const ridgePoints = Array.from({ length: 7 }, (_, i) => {
    const x = -20 + i * 75;
    const y = i % 2 === 0 ? 440 + rng() * 30 : 320 + rng() * 50;
    return `${x},${y}`;
  }).join(' ');
  // Pines drift positions per tile.
  const pines = Array.from({ length: 22 }, (_, i) => ({
    x: -10 + i * 20 + rng() * 12,
    y: 460 + rng() * 70,
    s: 0.7 + rng() * 0.8,
  }));
  const auroraOffsetA = rng() * 40 - 20;
  const auroraOffsetB = rng() * 40 - 20;
  return (
    <g>
      <defs>
        <linearGradient id={`${b.id}-${seed}-aurora`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5eead4" stopOpacity="0" />
          <stop offset="40%" stopColor={`hsl(${170 + Math.floor(rng() * 30)} 70% 60%)`} stopOpacity="0.65" />
          <stop offset="60%" stopColor="#a78bfa" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${b.id}-${seed}-ice`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0f9ff" stopOpacity="0.98" />
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id={`${b.id}-${seed}-snow`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#bae6fd" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {/* aurora ribbons — control points jittered per tile */}
      <path d={`M -20 ${80 + auroraOffsetA} Q 100 ${30 + auroraOffsetA}, 220 ${100 + auroraOffsetA} Q 320 ${150 + auroraOffsetA}, 420 ${60 + auroraOffsetA} L 420 240 L -20 240 Z`}
        fill={`url(#${b.id}-${seed}-aurora)`} opacity="0.85" />
      <path d={`M -20 ${130 + auroraOffsetB} Q 120 ${90 + auroraOffsetB}, 260 ${140 + auroraOffsetB} Q 360 ${170 + auroraOffsetB}, 420 ${130 + auroraOffsetB} L 420 220 L -20 220 Z`}
        fill={`url(#${b.id}-${seed}-aurora)`} opacity="0.55" />
      {/* distant peaks — procedural */}
      {peaks.map((p, i) => (
        <Mountain key={i} cx={p.cx} baseY={p.baseY} peakH={p.peakH} baseW={p.baseW}
          light={p.tone === 'light' ? '#2a5b85' : '#1e3a5f'}
          shadow={p.tone === 'light' ? '#102640' : '#0c1a2f'}
          opacity={0.82 + (i % 3) * 0.04} />
      ))}
      {/* mid ridge — vertices per tile */}
      <polygon points={ridgePoints} fill="#3a6f95" opacity="0.85" />
      {/* snow plain */}
      <path d="M 0 470 L 400 470 L 400 600 L 0 600 Z" fill={`url(#${b.id}-${seed}-snow)`} />
      <path d="M 0 510 Q 200 488, 400 514 L 400 600 L 0 600 Z" fill="#e0f2fe" opacity="0.9" />
      {/* ice shards on path */}
      {Array.from({ length: 14 }).map((_, i) => (
        <polygon key={i}
          points={`${20 + i * 28 + (seed % 10)},${478 + (i % 3) * 6} ${30 + i * 28 + (seed % 10)},${462 + (i % 3) * 6} ${40 + i * 28 + (seed % 10)},${478 + (i % 3) * 6}`}
          fill={`url(#${b.id}-${seed}-ice)`} opacity="0.95" stroke="#bae6fd" strokeWidth="0.5" />
      ))}
      {/* pine forest silhouette — varied positions per tile */}
      {pines.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y}) scale(${p.s})`}>
          <polygon points="0,0 -10,24 10,24" fill="#0a1f1a" />
          <polygon points="0,-10 -12,18 12,18" fill="#0c2a22" />
          <polygon points="0,-22 -14,12 14,12" fill="#0e3127" />
          <rect x="-2" y="22" width="4" height="6" fill="#3b2a1f" />
        </g>
      ))}
      {/* falling snow — seeded */}
      {Array.from({ length: 30 }).map((_, i) => (
        <circle key={i} cx={(seed * 11 + i * 41 + 7) % 400} cy={(seed * 19 + i * 23) % 480}
          r={1 + (i % 3) * 0.4} fill="#fff" opacity={0.55 + (i % 4) / 10} />
      ))}
    </g>
  );
};

export const EmberArt = ({ b, seed = 303 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  const v1cx = 80 + rng() * 80;
  const v1peakH = 240 + rng() * 100;
  const v2cx = 240 + rng() * 100;
  const v2peakH = 280 + rng() * 120;
  const embers = Array.from({ length: 60 }, () => ({
    x: rng() * 400, y: 80 + rng() * 380, r: 0.8 + rng() * 1.4,
  }));
  // Ridge vertices vary per tile so the charred horizon doesn't repeat.
  const ridge = Array.from({ length: 8 }, (_, i) =>
    `${-20 + i * 65},${i % 2 === 0 ? 460 + rng() * 40 : 360 + rng() * 60}`
  ).join(' ');
  return (
    <g>
      <defs>
        <radialGradient id={`${b.id}-${seed}-lava`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="55%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#7c2d12" />
        </radialGradient>
        <linearGradient id={`${b.id}-${seed}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c2d12" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#1c0a08" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill={`url(#${b.id}-${seed}-sky)`} />
      {/* twin volcanoes with jittered positions */}
      <Mountain cx={v1cx} baseY={400} peakH={v1peakH} baseW={240 + rng() * 60} light="#3d1f15" shadow="#1c0a08" opacity={0.88} />
      <Mountain cx={v2cx} baseY={400} peakH={v2peakH} baseW={260 + rng() * 80} light="#4a2418" shadow="#22100b" opacity={0.95} />
      <ellipse cx={v2cx} cy={400 - v2peakH + 5} rx={24} ry={6} fill="#fbbf24" opacity="0.9" />
      <path d={`M ${v2cx} ${400 - v2peakH} Q ${v2cx - 8} ${400 - v2peakH - 20}, ${v2cx - 5} ${400 - v2peakH - 40} Q ${v2cx} ${400 - v2peakH - 62}, ${v2cx - 4} ${400 - v2peakH - 76}`}
        stroke="#1c0a08" strokeWidth="20" fill="none" opacity="0.85" />
      <path d={`M ${v2cx} ${400 - v2peakH} Q ${v2cx - 8} ${400 - v2peakH - 20}, ${v2cx - 5} ${400 - v2peakH - 40} Q ${v2cx} ${400 - v2peakH - 62}, ${v2cx - 4} ${400 - v2peakH - 76}`}
        stroke="#fbbf24" strokeWidth="3" fill="none" opacity="0.45" />
      {/* charred ridge — vertices per tile */}
      <polygon points={`${ridge} 420,600 -20,600`} fill="#1c0a08" />
      <polygon points={`${ridge} 420,600 -20,600`} fill="#3d1f15" opacity="0.55" transform="translate(0 20)" />
      <path d="M 30 530 Q 80 510, 130 540 Q 180 565, 230 530 Q 280 500, 330 540 Q 380 565, 420 540"
        stroke="#fb923c" strokeWidth="4" fill="none" opacity="0.95" />
      <path d="M 0 560 Q 70 540, 140 562 Q 210 580, 280 560 Q 340 540, 400 562"
        stroke="#fcd34d" strokeWidth="2.5" fill="none" opacity="0.9" />
      <ellipse cx="200" cy="575" rx="200" ry="22" fill={`url(#${b.id}-${seed}-lava)`} opacity="0.95" />
      <ellipse cx="200" cy="575" rx="120" ry="10" fill="#fcd34d" opacity="0.85" />
      {embers.map((e, i) => (
        <circle key={i} cx={e.x} cy={e.y} r={e.r}
          fill={i % 3 === 0 ? '#fbbf24' : '#fb923c'}
          opacity={0.55 + ((i * 7) % 5) / 14} />
      ))}
    </g>
  );
};

export const VerdantArt = ({ b, seed = 404 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  // Canopy positions per tile so the upper jungle silhouette varies.
  const canopies = Array.from({ length: 3 }, () => ({
    cx: rng() * 400, cy: 100 + rng() * 100, rx: 100 + rng() * 80, ry: 60 + rng() * 60,
  }));
  // Tree trunk positions vary.
  const trees = Array.from({ length: 3 }, () => ({
    x: 60 + rng() * 280, y: 260 + rng() * 80, h: 130 + rng() * 40,
  }));
  const mushrooms = Array.from({ length: 12 }, () => ({
    x: 10 + rng() * 380, y: 460 + rng() * 80, s: 10 + rng() * 18,
  }));
  const fireflies = Array.from({ length: 26 }, () => ({
    x: rng() * 400, y: 100 + rng() * 380, a: 0.5 + rng() * 0.5,
  }));
  const vines = Array.from({ length: 6 }, () => ({
    vx: rng() * 400, sway: rng() * 16 - 8, len: 140 + rng() * 60,
  }));
  return (
    <g>
      <defs>
        <radialGradient id={`${b.id}-${seed}-glow`} cx="50%" cy="80%" r="60%">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#86efac" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${b.id}-${seed}-leaf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#14352a" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id={`${b.id}-${seed}-trunk`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3b2218" />
          <stop offset="100%" stopColor="#1f140d" />
        </linearGradient>
      </defs>
      {canopies.map((c, i) => (
        <ellipse key={i} cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry}
          fill={i === 1 ? '#1f5236' : `url(#${b.id}-${seed}-leaf)`}
          opacity={0.92 + (i % 2) * 0.05} />
      ))}
      {trees.map((t, i) => (
        <g key={i}>
          <rect x={t.x - 12} y={t.y} width="24" height={t.h}
            fill={`url(#${b.id}-${seed}-trunk)`} />
          <ellipse cx={t.x} cy={t.y + t.h} rx={20} ry={6} fill="#000" opacity="0.5" />
          <ellipse cx={t.x} cy={t.y} rx={56} ry={32} fill="#1f5236" opacity="0.95" />
        </g>
      ))}
      <path d="M 0 470 Q 200 448, 400 478 L 400 600 L 0 600 Z" fill="#166534" />
      <path d="M 0 510 Q 200 490, 400 516 L 400 600 L 0 600 Z" fill="#15803d" opacity="0.88" />
      <ellipse cx="200" cy="540" rx="220" ry="48" fill={`url(#${b.id}-${seed}-glow)`} />
      {mushrooms.map((m, i) => (
        <g key={i}>
          <rect x={m.x - 4} y={m.y} width="8" height={m.s} rx="3" fill="#f5f5f4" />
          <ellipse cx={m.x} cy={m.y} rx={m.s} ry={m.s * 0.6} fill="#dc2626" />
          <ellipse cx={m.x} cy={m.y} rx={m.s} ry={m.s * 0.4} fill="#b91c1c" opacity="0.5" />
          <circle cx={m.x - m.s * 0.32} cy={m.y - m.s * 0.18} r={m.s * 0.16} fill="#fef3c7" />
          <circle cx={m.x + m.s * 0.32} cy={m.y - m.s * 0.06} r={m.s * 0.10} fill="#fef3c7" />
        </g>
      ))}
      {vines.map((v, i) => (
        <path key={i} d={`M ${v.vx} 70 Q ${v.vx + 8 + v.sway} 130, ${v.vx - 4 + v.sway} ${v.len + 50}`}
          stroke="#22c55e" strokeWidth="2" fill="none" opacity="0.7" />
      ))}
      {fireflies.map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y} r={4} fill="#fef08a" opacity={f.a * 0.3} />
          <circle cx={f.x} cy={f.y} r={1.5} fill="#fff" opacity={f.a} />
        </g>
      ))}
    </g>
  );
};

export const TideArt = ({ b, seed = 505 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  const corals = Array.from({ length: 9 }, () => ({
    x: 20 + rng() * 360, y: 280 + rng() * 200, h: 100 + rng() * 180,
  }));
  const bubbles = Array.from({ length: 36 }, () => ({
    x: rng() * 400, y: 60 + rng() * 540, r: 1.5 + rng() * 4,
  }));
  return (
    <g>
      <defs>
        <radialGradient id={`${b.id}-${seed}-deep`} cx="50%" cy="0%" r="100%">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0c1f3a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${b.id}-${seed}-coral`} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fbcfe8" />
          <stop offset="100%" stopColor="#9d174d" />
        </radialGradient>
        <linearGradient id={`${b.id}-${seed}-kelp`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.65" />
        </linearGradient>
      </defs>
      {/* god rays — origin shifts per tile */}
      <path d={`M ${20 + rng() * 60} 0 L 120 600 L 0 600 Z`}   fill={`url(#${b.id}-${seed}-deep)`} opacity="0.55" />
      <path d={`M ${160 + rng() * 60} 0 L 240 600 L 140 600 Z`} fill={`url(#${b.id}-${seed}-deep)`} opacity="0.65" />
      <path d={`M ${300 + rng() * 60} 0 L 400 600 L 280 600 Z`} fill={`url(#${b.id}-${seed}-deep)`} opacity="0.55" />
      {/* kelp forest swaying — positions varied per tile */}
      {Array.from({ length: 6 }, () => 20 + rng() * 360).map((kx, i) => (
        <path key={i}
          d={`M ${kx} 600 Q ${kx + 16} 460, ${kx - 8} 320 Q ${kx + 4} 180, ${kx + 12} 80`}
          stroke={`url(#${b.id}-${seed}-kelp)`} strokeWidth={6 + (i % 2) * 2}
          fill="none" opacity="0.85" />
      ))}
      {/* coral towers */}
      {corals.map((c, i) => (
        <g key={i}>
          <rect x={c.x - 12} y={c.y} width="24" height={c.h} rx="8" fill="#0c2540" />
          <circle cx={c.x} cy={c.y} r="18" fill={`url(#${b.id}-${seed}-coral)`} />
          <circle cx={c.x - 12} cy={c.y + 10} r="10" fill="#ec4899" opacity="0.9" />
          <circle cx={c.x + 11} cy={c.y + 6} r="11" fill="#a5f3fc" opacity="0.78" />
          {/* polyp dots */}
          {[0, 1, 2, 3].map((j) => (
            <circle key={j} cx={c.x + ((j * 17) % 24) - 10}
              cy={c.y + 20 + j * 18} r="2" fill="#fbcfe8" opacity="0.85" />
          ))}
        </g>
      ))}
      {/* ocean floor */}
      <path d="M 0 540 Q 200 520, 400 545 L 400 600 L 0 600 Z" fill="#0a2540" />
      <path d="M 0 560 Q 200 545, 400 564 L 400 600 L 0 600 Z" fill="#102f55" opacity="0.95" />
      {/* bubbles */}
      {bubbles.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={b.r}
          fill="#a5f3fc" opacity={0.45 + ((i * 5) % 4) / 14}
          stroke="#67e8f9" strokeWidth="0.5" />
      ))}
    </g>
  );
};

export const DunesArt = ({ b, seed = 606 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  const motes = Array.from({ length: 70 }, () => ({
    x: rng() * 400, y: rng() * 600, r: 0.6 + rng() * 1.2,
  }));
  return (
    <g>
      <defs>
        <radialGradient id={`${b.id}-${seed}-sun`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${b.id}-${seed}-dune-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id={`${b.id}-${seed}-dune-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
      </defs>
      {/* haze sun — position jittered per tile so it doesn't repeat */}
      {(() => { const sx = 80 + rng() * 240, sy = 100 + rng() * 80; return (
        <g>
          <circle cx={sx} cy={sy} r="110" fill={`url(#${b.id}-${seed}-sun)`} />
          <circle cx={sx} cy={sy} r="50" fill="#fbbf24" opacity="0.92" />
          <circle cx={sx} cy={sy} r="38" fill="#fde68a" />
        </g>
      ); })()}
      {/* layered dunes — wave amplitude per tile */}
      {(() => {
        const a1 = rng() * 30, a2 = rng() * 30, a3 = rng() * 30, a4 = rng() * 30;
        return <g>
          <path d={`M -20 360 Q 80 ${320 + a1}, 180 ${350 - a1} Q 280 ${380 + a1}, 420 ${330 - a1} L 420 480 L -20 480 Z`}
            fill="#9a3412" opacity="0.6" />
          <path d={`M -20 400 Q 100 ${360 + a2}, 220 ${390 - a2} Q 320 ${420 + a2}, 420 ${370 - a2} L 420 600 L -20 600 Z`}
            fill={`url(#${b.id}-${seed}-dune-a)`} />
          <path d={`M -20 460 Q 80 ${420 + a3}, 200 ${450 - a3} Q 300 ${480 + a3}, 420 ${430 - a3} L 420 600 L -20 600 Z`}
            fill={`url(#${b.id}-${seed}-dune-b)`} />
          <path d={`M -20 520 Q 100 ${500 + a4}, 220 ${515 - a4} Q 340 ${530 + a4}, 420 ${510 - a4} L 420 600 L -20 600 Z`}
            fill="#f59e0b" opacity="0.92" />
        </g>;
      })()}
      {/* obelisks + pyramid */}
      <polygon points="40,540 60,440 80,540" fill="#3f2613" />
      <polygon points="60,540 60,440 80,540" fill="#1f1208" opacity="0.85" />
      <polygon points="120,560 180,400 240,560" fill="#7c2d12" />
      <polygon points="180,560 180,400 240,560" fill="#451a07" opacity="0.85" />
      <polygon points="340,540 356,420 372,540" fill="#3f2613" />
      <polygon points="356,540 356,420 372,540" fill="#1f1208" opacity="0.85" />
      {/* lone caravan */}
      <g transform="translate(110 510)">
        <ellipse cx="0" cy="2" rx="14" ry="2" fill="#000" opacity="0.55" />
        <path d="M -10 -2 Q -8 -16, 0 -16 Q 8 -16, 10 -2 L 10 0 L -10 0 Z" fill="#3f2613" />
        <path d="M -4 -2 Q -4 -10, 0 -10 Q 4 -10, 4 -2" fill="#3f2613" />
        <line x1="-7" y1="0" x2="-7" y2="6" stroke="#3f2613" strokeWidth="1.5" />
        <line x1="7"  y1="0" x2="7"  y2="6" stroke="#3f2613" strokeWidth="1.5" />
      </g>
      {/* dust + wind motes */}
      {motes.map((m, i) => (
        <circle key={i} cx={m.x} cy={m.y} r={m.r}
          fill="#fef3c7" opacity={0.3 + ((i * 11) % 4) / 12} />
      ))}
    </g>
  );
};

export const VoidArt = ({ b, seed = 707 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  const stars = Array.from({ length: 140 }, () => ({
    x: rng() * 400, y: rng() * 600, r: 0.4 + rng() * 1.3,
  }));
  return (
    <g>
      <defs>
        <radialGradient id={`${b.id}-${seed}-rift`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#fff" stopOpacity="0.95" />
          <stop offset="20%" stopColor="#f0abfc" />
          <stop offset="55%" stopColor="#a855f7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${b.id}-${seed}-pillar`} cx="50%" cy="0%" r="100%">
          <stop offset="0%" stopColor="#c084fc" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0e0524" />
        </radialGradient>
      </defs>
      {/* dense starfield */}
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r}
          fill="#fff" opacity={0.35 + ((i * 13) % 5) / 12} />
      ))}
      {/* shooting stars — varied trajectory per tile */}
      <line x1={280 + rng() * 80} y1={40 + rng() * 40} x2={360 + rng() * 40} y2={10 + rng() * 20} stroke="#fff" strokeWidth="1.5" opacity="0.7" />
      <line x1={40 + rng() * 60}  y1={160 + rng() * 40} x2={90 + rng() * 30}  y2={150 + rng() * 30} stroke="#fff" strokeWidth="1" opacity="0.55" />
      {/* dimensional rift — position + size per tile */}
      {(() => {
        const rcx = 160 + rng() * 80, rcy = 180 + rng() * 80, rrx = 160 + rng() * 80, rry = 60 + rng() * 40;
        return <g>
          <ellipse cx={rcx} cy={rcy} rx={rrx} ry={rry} fill={`url(#${b.id}-${seed}-rift)`} />
          <ellipse cx={rcx} cy={rcy} rx={rrx * 0.7} ry={rry * 0.52} fill="#f0abfc" opacity="0.55" />
          <ellipse cx={rcx} cy={rcy} rx={rrx * 0.35} ry={rry * 0.22} fill="#fff" opacity="0.85" />
        </g>;
      })()}
      {/* obsidian pillars — positions varied per tile */}
      {Array.from({ length: 4 }).map((_, i) => {
        const px = 14 + i * 110 + rng() * 30;
        return (
          <g key={i}>
            <polygon points={`${px},560 ${px + 18},${180 + rng() * 80} ${px + 36},560`} fill={`url(#${b.id}-${seed}-pillar)`} />
            <polygon points={`${px + 18},560 ${px + 18},${180 + rng() * 80} ${px + 36},560`} fill="#08031a" opacity="0.85" />
          </g>
        );
      })}
      {/* floating runic glyphs */}
      {[[90, 320], [320, 280], [200, 370], [60, 420], [340, 400]].map((p, i) => (
        <g key={i} transform={`translate(${p[0]} ${p[1]})`}>
          <rect x="-9" y="-9" width="18" height="18" fill="none"
            stroke="#c084fc" strokeWidth="1.2" transform="rotate(45)" />
          <rect x="-5" y="-5" width="10" height="10" fill="none"
            stroke="#f0abfc" strokeWidth="0.8" transform="rotate(45)" />
          <circle r="2.5" fill="#f0abfc" />
        </g>
      ))}
    </g>
  );
};

export const ApexArt = ({ b, seed = 808 }: { b: Biome; seed?: number }) => {
  const rng = seeded(seed);
  const motes = Array.from({ length: 50 }, () => ({
    x: rng() * 400, y: rng() * 600, r: 0.8 + rng() * 1.6,
  }));
  return (
    <g>
      <defs>
        <radialGradient id={`${b.id}-${seed}-halo`} cx="50%" cy="38%" r="55%">
          <stop offset="0%"  stopColor="#fff" stopOpacity="0.95" />
          <stop offset="35%" stopColor="#fbbf24" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${b.id}-${seed}-obelisk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7e22ce" />
          <stop offset="100%" stopColor="#1a0524" />
        </linearGradient>
      </defs>
      {/* radial divine rays — center position shifts per tile */}
      {(() => {
        const hcx = 160 + rng() * 80, hcy = 180 + rng() * 80;
        return <g>
          {Array.from({ length: 36 }).map((_, i) => {
            const a = (i * Math.PI * 2) / 36;
            const x2 = hcx + Math.cos(a) * 480;
            const y2 = hcy + Math.sin(a) * 480;
            return (
              <line key={i} x1={hcx} y1={hcy} x2={x2} y2={y2}
                stroke="#fbbf24" strokeWidth="1" opacity="0.16" />
            );
          })}
          <circle cx={hcx} cy={hcy} r="220" fill={`url(#${b.id}-${seed}-halo)`} />
          <circle cx={hcx} cy={hcy} r="84"  fill="none" stroke="#fef3c7" strokeWidth="3" opacity="0.85" />
          <circle cx={hcx} cy={hcy} r="56"  fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.7" />
          <circle cx={hcx} cy={hcy} r="34"  fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.55" />
        </g>;
      })()}
      {/* obelisk colonnade — positions varied per tile */}
      {Array.from({ length: 4 }).map((_, i) => {
        const ox = 30 + i * 110 + rng() * 20;
        const oh = 180 + rng() * 100;
        return (
          <polygon key={i}
            points={`${ox},540 ${ox + 16},${540 - oh} ${ox + 32},540`}
            fill={`url(#${b.id}-${seed}-obelisk)`}
            stroke="#fbbf24" strokeWidth="0.8" />
        );
      })}
      {/* central altar */}
      <rect x="160" y="450" width="80" height="150" fill="#1a0524" stroke="#fbbf24" strokeWidth="1.2" />
      <rect x="150" y="438" width="100" height="16" fill="#fbbf24" opacity="0.92" />
      <circle cx="200" cy="430" r="14" fill="#fff" />
      <circle cx="200" cy="430" r="6" fill="#fbbf24" />
      {/* ember rain */}
      {motes.map((m, i) => (
        <circle key={i} cx={m.x} cy={m.y} r={m.r}
          fill={i % 3 === 0 ? '#fff' : '#fef3c7'}
          opacity={0.4 + ((i * 7) % 5) / 12} />
      ))}
    </g>
  );
};

export const ART: Record<string, React.ComponentType<{ b: Biome; seed?: number }>> = {
  crystal:  CrystalArt,
  frost:    FrostArt,
  ember:    EmberArt,
  verdant:  VerdantArt,
  tidewave: TideArt,
  dunes:    DunesArt,
  voidline: VoidArt,
  apex:     ApexArt,
};

/* ───────────────────────── path + node generators ──────────────────────── */

export function buildPathD(nodes: { x: number; y: number }[]): string {
  if (!nodes.length) return '';
  let d = `M ${nodes[0].x} ${nodes[0].y}`;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], c = nodes[i];
    const cy = (a.y + c.y) / 2;
    d += ` C ${a.x} ${cy}, ${c.x} ${cy}, ${c.x} ${c.y}`;
  }
  return d;
}

export function generateNodes(startLevel: number, endLevel: number, count: number, w = 400, h = 600) {
  const out: { x: number; y: number; level: number }[] = [];
  const margin = 80, usable = h - margin * 2;
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(count - 1, 1);
    const y = margin + t * usable;
    const x = w / 2 + Math.sin(t * Math.PI * 2.2) * (w * 0.28);
    const level = Math.round(startLevel + t * (endLevel - startLevel));
    out.push({ x, y, level });
  }
  return out;
}

/**
 * Long-form node generator. Candy-Crush orientation:
 *   - level startLevel (i=0) sits at the BOTTOM of the SVG
 *   - level endLevel   (i=count-1) sits at the TOP
 * Player scrolls UPWARD to climb levels.
 *
 * Path winds in serpentine S-curves like a real mountain switchback road —
 * tight enough to feel dense (good for thousands of levels per act) and varied
 * enough to never look mechanical.
 */
export function generateLongNodes(
  startLevel: number,
  endLevel: number,
  spacingY: number,
  w: number,
  topMargin: number,
  svgH: number,
) {
  const count = endLevel - startLevel + 1;
  const out: { x: number; y: number; level: number }[] = new Array(count);
  // Switchback rate: one full S-curve every ~8 levels. Visually busier =
  // feels like a winding mountain road instead of a lazy meander.
  const wave = 8;
  const ampl = w * 0.34;
  const cx = w / 2;
  for (let i = 0; i < count; i++) {
    const t = i / wave;
    // Layer three sines for organic, never-repeating serpentine
    const x = cx
      + Math.sin(t * Math.PI) * ampl
      + Math.sin(t * Math.PI * 0.43 + 1.3) * (ampl * 0.22)
      + Math.sin(t * Math.PI * 0.17 + 2.1) * (ampl * 0.10);
    const y = svgH - topMargin - i * spacingY;
    out[i] = { x, y, level: startLevel + i };
  }
  return out;
}
