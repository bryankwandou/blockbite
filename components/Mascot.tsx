import React from 'react';

// ── Palette library (BlockBite brand + extended) ───────────────────
export const PALETTES: Record<string, [string, string, string]> = {
  magenta: ['#b12c84', '#7a1d5a', '#e879b4'],
  teal:    ['#3d7c91', '#1f4f61', '#6ec8e0'],
  gold:    ['#e1a438', '#a87020', '#f9d87c'],
  purple:  ['#5055a4', '#2e3270', '#9499e8'],
  coral:   ['#d94553', '#9c2535', '#f78a97'],
  violet:  ['#a78bfa', '#7c3aed', '#c4b5fd'],
  cyan:    ['#5eead4', '#0d9488', '#99f6e4'],
  amber:   ['#fbbf24', '#d97706', '#fde68a'],
  sky:     ['#7dd3fc', '#0284c7', '#bae6fd'],
  rose:    ['#f472b6', '#db2777', '#fbcfe8'],
};

export const PAL_KEYS = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

// ── Expression renderers ───────────────────────────────────────────
type ExprFn = (c: [string, string, string], s: number) => React.ReactNode;

export const EXPR: Record<string, ExprFn> = {
  happy: (c, s) => <>
    <circle cx={s*.37} cy={s*.52} r={s*.07} fill="#fff"/>
    <circle cx={s*.63} cy={s*.52} r={s*.07} fill="#fff"/>
    <circle cx={s*.39} cy={s*.52} r={s*.035} fill="#0a0a14"/>
    <circle cx={s*.65} cy={s*.52} r={s*.035} fill="#0a0a14"/>
    <circle cx={s*.40} cy={s*.50} r={s*.015} fill="#fff"/>
    <circle cx={s*.66} cy={s*.50} r={s*.015} fill="#fff"/>
    <path d={`M${s*.34} ${s*.65} Q${s*.5} ${s*.76} ${s*.66} ${s*.65}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
  </>,
  sad: (c, s) => <>
    <circle cx={s*.37} cy={s*.52} r={s*.07} fill="#fff"/>
    <circle cx={s*.63} cy={s*.52} r={s*.07} fill="#fff"/>
    <circle cx={s*.38} cy={s*.53} r={s*.035} fill="#0a0a14"/>
    <circle cx={s*.64} cy={s*.53} r={s*.035} fill="#0a0a14"/>
    <path d={`M${s*.34} ${s*.68} Q${s*.5} ${s*.62} ${s*.66} ${s*.68}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    <path d={`M${s*.36} ${s*.40} Q${s*.40} ${s*.36} ${s*.44} ${s*.40}`} stroke="#fff" strokeWidth={s*.018} fill="none"/>
    <path d={`M${s*.56} ${s*.40} Q${s*.60} ${s*.36} ${s*.64} ${s*.40}`} stroke="#fff" strokeWidth={s*.018} fill="none"/>
  </>,
  wink: (c, s) => <>
    <circle cx={s*.37} cy={s*.52} r={s*.07} fill="#fff"/>
    <circle cx={s*.63} cy={s*.52} r={s*.07} fill="#fff"/>
    <circle cx={s*.38} cy={s*.52} r={s*.035} fill="#0a0a14"/>
    <line x1={s*.57} y1={s*.50} x2={s*.69} y2={s*.54} stroke="#fff" strokeWidth={s*.025} strokeLinecap="round"/>
    <path d={`M${s*.34} ${s*.65} Q${s*.5} ${s*.76} ${s*.66} ${s*.65}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
  </>,
  angry: (c, s) => <>
    <circle cx={s*.37} cy={s*.52} r={s*.07} fill="#f87171"/>
    <circle cx={s*.63} cy={s*.52} r={s*.07} fill="#f87171"/>
    <circle cx={s*.37} cy={s*.52} r={s*.035} fill="#0a0a14"/>
    <circle cx={s*.63} cy={s*.52} r={s*.035} fill="#0a0a14"/>
    <path d={`M${s*.30} ${s*.37} Q${s*.37} ${s*.32} ${s*.44} ${s*.38}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    <path d={`M${s*.56} ${s*.38} Q${s*.63} ${s*.32} ${s*.70} ${s*.37}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    <path d={`M${s*.36} ${s*.68} Q${s*.5} ${s*.63} ${s*.64} ${s*.68}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
  </>,
  wow: (c, s) => <>
    <circle cx={s*.37} cy={s*.51} r={s*.07} fill="#fff"/>
    <circle cx={s*.63} cy={s*.51} r={s*.07} fill="#fff"/>
    <circle cx={s*.37} cy={s*.51} r={s*.04} fill="#0a0a14"/>
    <circle cx={s*.63} cy={s*.51} r={s*.04} fill="#0a0a14"/>
    <ellipse cx={s*.5} cy={s*.67} rx={s*.07} ry={s*.055} fill="#fff"/>
    <ellipse cx={s*.5} cy={s*.67} rx={s*.035} ry={s*.025} fill="#0a0a14"/>
  </>,
  cool: (c, s) => <>
    <rect x={s*.25} y={s*.44} width={s*.22} height={s*.10} rx={s*.04} fill="#0a0a14"/>
    <rect x={s*.53} y={s*.44} width={s*.22} height={s*.10} rx={s*.04} fill="#0a0a14"/>
    <rect x={s*.44} y={s*.47} width={s*.12} height={s*.04} rx={s*.02} fill="#0a0a14"/>
    <path d={`M${s*.34} ${s*.64} Q${s*.5} ${s*.76} ${s*.66} ${s*.64}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
  </>,
  sleepy: (c, s) => <>
    <path d={`M${s*.30} ${s*.50} Q${s*.37} ${s*.46} ${s*.44} ${s*.50}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    <path d={`M${s*.56} ${s*.50} Q${s*.63} ${s*.46} ${s*.70} ${s*.50}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    <path d={`M${s*.36} ${s*.66} Q${s*.5} ${s*.72} ${s*.64} ${s*.66}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
    <text x={s*.68} y={s*.40} fontSize={s*.14} fill={c[2]}>z</text>
    <text x={s*.74} y={s*.30} fontSize={s*.10} fill={c[2]} opacity=".7">z</text>
  </>,
  star: (c, s) => <>
    <polygon points={`${s*.34},${s*.46} ${s*.36},${s*.52} ${s*.42},${s*.52} ${s*.37},${s*.56} ${s*.39},${s*.62} ${s*.34},${s*.58} ${s*.29},${s*.62} ${s*.31},${s*.56} ${s*.26},${s*.52} ${s*.32},${s*.52}`} fill="#fff"/>
    <polygon points={`${s*.61},${s*.46} ${s*.63},${s*.52} ${s*.69},${s*.52} ${s*.64},${s*.56} ${s*.66},${s*.62} ${s*.61},${s*.58} ${s*.56},${s*.62} ${s*.58},${s*.56} ${s*.53},${s*.52} ${s*.59},${s*.52}`} fill="#fff"/>
    <path d={`M${s*.34} ${s*.65} Q${s*.5} ${s*.76} ${s*.66} ${s*.65}`} stroke="#fff" strokeWidth={s*.025} fill="none" strokeLinecap="round"/>
  </>,
};

export const EXPR_KEYS = Object.keys(EXPR);

// ── Accessories ────────────────────────────────────────────────────
type AccFn = (c: [string, string, string], s: number) => React.ReactNode;

export const ACC: Record<string, AccFn> = {
  none:      () => null,
  crown:     (c, s) => <polygon points={`${s*.3},${s*.22} ${s*.36},${s*.10} ${s*.43},${s*.20} ${s*.5},${s*.08} ${s*.57},${s*.20} ${s*.64},${s*.10} ${s*.7},${s*.22}`} fill={c[0]}/>,
  hat:       (c, s) => <><rect x={s*.28} y={s*.12} width={s*.44} height={s*.12} rx={s*.03} fill={c[0]}/><rect x={s*.36} y={s*.05} width={s*.28} height={s*.10} rx={s*.04} fill={c[0]}/></>,
  halo:      (c, s) => <ellipse cx={s*.5} cy={s*.10} rx={s*.24} ry={s*.06} fill="none" stroke={c[0]} strokeWidth={s*.025}/>,
  bow:       (c, s) => <><polygon points={`${s*.40},${s*.15} ${s*.50},${s*.20} ${s*.40},${s*.25}`} fill={c[0]}/><polygon points={`${s*.60},${s*.15} ${s*.50},${s*.20} ${s*.60},${s*.25}`} fill={c[0]}/><circle cx={s*.5} cy={s*.20} r={s*.03} fill={c[0]}/></>,
  headband:  (c, s) => <rect x={s*.22} y={s*.24} width={s*.56} height={s*.06} rx={s*.03} fill={c[0]} opacity=".9"/>,
  antenna:   (c, s) => <><line x1={s*.5} y1={s*.05} x2={s*.5} y2={s*.20} stroke={c[0]} strokeWidth={s*.025}/><circle cx={s*.5} cy={s*.05} r={s*.04} fill={c[0]}/></>,
  lightning: (c, s) => <polygon points={`${s*.70},${s*.08} ${s*.62},${s*.20} ${s*.68},${s*.20} ${s*.60},${s*.34} ${s*.72},${s*.19} ${s*.66},${s*.19}`} fill={c[0]}/>,
  star_acc:  (c, s) => <polygon points={`${s*.66},${s*.10} ${s*.68},${s*.17} ${s*.75},${s*.17} ${s*.70},${s*.21} ${s*.72},${s*.28} ${s*.66},${s*.24} ${s*.60},${s*.28} ${s*.62},${s*.21} ${s*.57},${s*.17} ${s*.64},${s*.17}`} fill={c[0]}/>,
};

export const ACC_KEYS = Object.keys(ACC);

// ── Body shapes ────────────────────────────────────────────────────
type ShapeFn = (s: number, c: [string, string, string]) => React.ReactNode;

export const SHAPES: Record<string, ShapeFn> = {
  square:  (s, c) => <rect x={s*.18} y={s*.18} width={s*.64} height={s*.64} rx={s*.15} fill={`url(#gbody${c[0].slice(1)})`}/>,
  round:   (s, c) => <rect x={s*.18} y={s*.22} width={s*.64} height={s*.58} rx={s*.30} fill={`url(#gbody${c[0].slice(1)})`}/>,
  diamond: (s, c) => <polygon points={`${s*.5},${s*.15} ${s*.82},${s*.5} ${s*.5},${s*.85} ${s*.18},${s*.5}`} fill={`url(#gbody${c[0].slice(1)})`}/>,
  chunky:  (s, c) => <rect x={s*.14} y={s*.22} width={s*.72} height={s*.58} rx={s*.12} fill={`url(#gbody${c[0].slice(1)})`}/>,
};

export const SHAPE_KEYS = Object.keys(SHAPES);

// ── Bite marks ────────────────────────────────────────────────────
type BiteFn = (s: number, bg: string) => React.ReactNode;
export const BITES: Record<string, BiteFn> = {
  none:        () => null,
  topright:    (s, bg) => <circle cx={s*.82} cy={s*.18} r={s*.18} fill={bg}/>,
  bottomleft:  (s, bg) => <circle cx={s*.18} cy={s*.82} r={s*.16} fill={bg}/>,
  topleft:     (s, bg) => <circle cx={s*.18} cy={s*.18} r={s*.16} fill={bg}/>,
};
export const BITE_KEYS = Object.keys(BITES);

// ── Cheeks ─────────────────────────────────────────────────────────
type CheekFn = (c: [string, string, string], s: number) => React.ReactNode;
export const CHEEKS: Record<string, CheekFn> = {
  none:  () => null,
  round: (c, s) => <><ellipse cx={s*.25} cy={s*.60} rx={s*.07} ry={s*.04} fill={c[0]} opacity=".5"/><ellipse cx={s*.75} cy={s*.60} rx={s*.07} ry={s*.04} fill={c[0]} opacity=".5"/></>,
  heart: (c, s) => <><ellipse cx={s*.22} cy={s*.62} rx={s*.05} ry={s*.03} fill={c[0]} opacity=".5"/><ellipse cx={s*.75} cy={s*.62} rx={s*.05} ry={s*.03} fill={c[0]} opacity=".5"/></>,
};
export const CHEEK_KEYS = Object.keys(CHEEKS);

// ── Config & deterministic generator ──────────────────────────────
export interface MascotConfig {
  id: number;
  palKey: string;
  exprKey: string;
  accKey: string;
  shapeKey: string;
  biteKey: string;
  cheekKey: string;
  bgType: 'dark' | 'block' | 'grad' | 'white' | 'glass';
  hasBorder: boolean;
  category: 'cute' | 'emotion' | 'themed' | 'special';
  name?: string;
}

function hash(n: number, m: number) { return ((n * 1664525 + 1013904223) >>> 0) % m; }

export function generateMascots(count = 100): MascotConfig[] {
  const bgTypes = ['dark', 'block', 'grad', 'white', 'glass'] as const;
  const cats = ['cute', 'emotion', 'themed', 'special'] as const;
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    palKey:   PAL_KEYS[hash(i * 7 + 1, PAL_KEYS.length)],
    exprKey:  EXPR_KEYS[hash(i * 13 + 2, EXPR_KEYS.length)],
    accKey:   ACC_KEYS[hash(i * 5 + 3, ACC_KEYS.length)],
    shapeKey: SHAPE_KEYS[hash(i * 11 + 4, SHAPE_KEYS.length)],
    biteKey:  BITE_KEYS[hash(i * 3 + 5, BITE_KEYS.length)],
    cheekKey: CHEEK_KEYS[hash(i * 17 + 6, CHEEK_KEYS.length)],
    bgType:   bgTypes[hash(i * 19 + 7, 5)],
    hasBorder: hash(i * 23 + 8, 3) === 0,
    category:  cats[Math.min(3, Math.floor(i / 25))],
  }));
}

// ── The 5 named brand mascots ──────────────────────────────────────
export const BRAND_MASCOTS: MascotConfig[] = [
  { id: 101, palKey: 'coral',   exprKey: 'angry',  accKey: 'none',     shapeKey: 'chunky',  biteKey: 'topright',    cheekKey: 'none',  bgType: 'dark',  hasBorder: true,  category: 'special', name: 'Brawler' },
  { id: 102, palKey: 'gold',    exprKey: 'happy',  accKey: 'none',     shapeKey: 'round',   biteKey: 'none',        cheekKey: 'round', bgType: 'dark',  hasBorder: false, category: 'special', name: 'Sunny'   },
  { id: 103, palKey: 'purple',  exprKey: 'cool',   accKey: 'crown',    shapeKey: 'chunky',  biteKey: 'bottomleft',  cheekKey: 'none',  bgType: 'grad',  hasBorder: true,  category: 'special', name: 'Rex'     },
  { id: 104, palKey: 'teal',    exprKey: 'wink',   accKey: 'headband', shapeKey: 'square',  biteKey: 'none',        cheekKey: 'heart', bgType: 'dark',  hasBorder: false, category: 'special', name: 'Tide'    },
  { id: 105, palKey: 'magenta', exprKey: 'star',   accKey: 'star_acc', shapeKey: 'round',   biteKey: 'topleft',     cheekKey: 'round', bgType: 'block', hasBorder: true,  category: 'special', name: 'Blaze'   },
];

// ── Main SVG component ─────────────────────────────────────────────
interface MascotSVGProps {
  cfg: MascotConfig;
  size?: number;
}

export function MascotSVG({ cfg, size = 120 }: MascotSVGProps) {
  const s = size;
  const pal = PALETTES[cfg.palKey];
  const uid = `m${cfg.id}`;

  const bgFill =
    cfg.bgType === 'block' ? pal[1] + '33' :
    cfg.bgType === 'white' ? '#ffffff' :
    cfg.bgType === 'glass' ? 'rgba(255,255,255,0.08)' :
    '#07060f';

  return (
    <svg viewBox={`0 0 ${s} ${s}`} width={s} height={s} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {cfg.bgType === 'grad' && (
          <radialGradient id={`gbg${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={pal[0] + '44'}/>
            <stop offset="100%" stopColor="#07060f"/>
          </radialGradient>
        )}
        <linearGradient id={`gbody${pal[0].slice(1)}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={pal[0]}/>
          <stop offset="100%" stopColor={pal[1]}/>
        </linearGradient>
        <linearGradient id={`ginner${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={pal[2]} stopOpacity=".3"/>
          <stop offset="100%" stopColor={pal[0]} stopOpacity=".6"/>
        </linearGradient>
      </defs>

      {/* Background */}
      <rect width={s} height={s} rx={s * .22}
        fill={cfg.bgType === 'grad' ? `url(#gbg${uid})` : bgFill}/>
      {cfg.hasBorder && (
        <rect width={s} height={s} rx={s * .22} fill="none"
          stroke={pal[0]} strokeWidth={s * .018} opacity=".6"/>
      )}

      {/* Body */}
      {SHAPES[cfg.shapeKey](s, pal)}

      {/* Inner sheen */}
      {cfg.shapeKey !== 'diamond' && (
        <rect x={s*.22} y={s*.26} width={s*.56} height={s*.42} rx={s*.10}
          fill={`url(#ginner${uid})`}/>
      )}

      {/* Bite mark */}
      {BITES[cfg.biteKey](s, bgFill)}

      {/* Accessory */}
      {ACC[cfg.accKey](pal, s)}

      {/* Cheeks */}
      {CHEEKS[cfg.cheekKey]([pal[2], pal[1], pal[0]], s)}

      {/* Expression */}
      {EXPR[cfg.exprKey](pal, s)}

      {/* Sparkle details */}
      {cfg.id % 4 === 0 && <circle cx={s*.76} cy={s*.26} r={s*.03} fill={pal[2]} opacity=".7"/>}
      {cfg.id % 7 === 0 && <circle cx={s*.14} cy={s*.30} r={s*.025} fill={pal[2]} opacity=".5"/>}
    </svg>
  );
}
