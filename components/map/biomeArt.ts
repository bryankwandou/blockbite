/**
 * Saga-map scenery as inline SVG (data URIs, no image files).
 *
 * Three parallax layers per biome, drawn for the stage's real width so
 * nothing is stretched (the old tiles were 400 px wide and scaled with
 * preserveAspectRatio="none", which flattened every prop on wide screens):
 *   far   misty mountain ranges that fade into the sky (soft tile seams)
 *   mid   cliffs along both edges with lit faces, biome props on ledges
 *   fore  dark near-camera silhouettes with a rim light, edges only
 * Props stay in the margins the path never reaches (see nodeX amplitude).
 * Every tile is TILE px tall and repeats vertically without a visible seam.
 */
import type { Biome } from '@/lib/game/biomes';

export const TILE = 640;

/* ── colour helpers ───────────────────────────────────────────────── */
function rgb(c: string): [number, number, number] {
  let h = c.replace('#', '');
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Linear mix of two #hex colours, t = 0 → a, 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const f = (n: number) => n.toFixed(1);
export const svgUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/* ── per-biome style ──────────────────────────────────────────────── */
type Ridge = 'jagged' | 'peaks' | 'hills' | 'dunes' | 'volcano' | 'temple';
export type PropKind = 'crystal' | 'pine' | 'snowpine' | 'basalt' | 'coral' | 'cactus' | 'obelisk' | 'pillar';
const STYLE: Record<string, { ridge: Ridge; props: PropKind[] }> = {
  crystal:  { ridge: 'jagged',  props: ['crystal', 'crystal', 'obelisk'] },
  frost:    { ridge: 'peaks',   props: ['snowpine', 'snowpine', 'crystal'] },
  ember:    { ridge: 'volcano', props: ['basalt', 'basalt', 'pillar'] },
  verdant:  { ridge: 'hills',   props: ['pine', 'pine', 'basalt'] },
  tidewave: { ridge: 'hills',   props: ['coral', 'coral', 'basalt'] },
  dunes:    { ridge: 'dunes',   props: ['cactus', 'basalt', 'pillar'] },
  voidline: { ridge: 'jagged',  props: ['obelisk', 'crystal', 'obelisk'] },
  apex:     { ridge: 'temple',  props: ['pillar', 'pillar', 'crystal'] },
};
export const styleFor = (b: Biome) => STYLE[b.id] ?? STYLE.crystal;

/** Palette derived from the biome's four base colours. */
export function palette(b: Biome) {
  return {
    rock: b.rock,
    deep: mix(b.rock, '#000000', 0.35),
    face: mix(b.rock, b.accent, 0.28),
    lit: mix(b.rock, b.accent, 0.55),
    accent: b.accent,
    light: mix(b.accent, '#ffffff', 0.4),
    shade: mix(b.accent, b.rock, 0.45),
    glow: b.glow,
  };
}
type Pal = ReturnType<typeof palette>;

/* ── props (upright, base at (x, base), height ≈ 1.8·s) ───────────── */
export function propArt(kind: PropKind, x: number, base: number, s: number, p: Pal, dark = false): string {
  const L = dark ? p.deep : p.light, R = dark ? mix(p.deep, '#000000', 0.4) : p.shade;
  const rim = dark ? `stroke="${p.accent}" stroke-opacity=".35" stroke-width="1.5"` : '';
  switch (kind) {
    case 'crystal': {
      let out = dark ? '' : `<ellipse cx="${f(x)}" cy="${f(base)}" rx="${f(s * 0.75)}" ry="${f(s * 0.14)}" fill="${p.glow}" opacity=".28"/>`;
      const parts: [number, number, number, number][] = [[-0.38, 1.05, 0.34, -14], [0.36, 1.25, 0.38, 12], [0, 1.85, 0.46, 0]];
      for (const [dx, h, w, rot] of parts) {
        const cx = x + dx * s, hh = h * s, ww = w * s;
        out += `<g transform="rotate(${rot} ${f(cx)} ${f(base)})">`
          + `<path d="M${f(cx - ww / 2)} ${f(base)}V${f(base - hh * 0.78)}L${f(cx)} ${f(base - hh)}V${f(base)}Z" fill="${L}" ${rim}/>`
          + `<path d="M${f(cx)} ${f(base)}V${f(base - hh)}L${f(cx + ww / 2)} ${f(base - hh * 0.78)}V${f(base)}Z" fill="${R}" ${rim}/>`
          + (dark ? '' : `<path d="M${f(cx - ww / 2)} ${f(base - hh * 0.78)}L${f(cx)} ${f(base - hh)}L${f(cx + ww / 2)} ${f(base - hh * 0.78)}" stroke="#fff" stroke-opacity=".55" stroke-width="1.2" fill="none"/>`)
          + '</g>';
      }
      return out;
    }
    case 'pine':
    case 'snowpine': {
      const snow = kind === 'snowpine';
      const green = dark ? p.deep : snow ? mix(p.rock, '#0f766e', 0.45) : mix(p.rock, p.accent, 0.5);
      const greenDark = dark ? mix(p.deep, '#000000', 0.4) : mix(green, '#000000', 0.35);
      let out = `<rect x="${f(x - s * 0.07)}" y="${f(base - s * 0.35)}" width="${f(s * 0.14)}" height="${f(s * 0.35)}" fill="${dark ? p.deep : '#3b2a1a'}"/>`;
      const tiers: [number, number][] = [[0.3, 0.62], [0.82, 0.5], [1.28, 0.38]];
      for (const [y0, w] of tiers) {
        const yb = base - y0 * s, yt = yb - s * 0.62, hw = w * s;
        out += `<path d="M${f(x - hw)} ${f(yb)}L${f(x)} ${f(yt)}V${f(yb)}Z" fill="${green}" ${rim}/>`
          + `<path d="M${f(x)} ${f(yt)}L${f(x + hw)} ${f(yb)}H${f(x)}Z" fill="${greenDark}" ${rim}/>`;
        if (snow && !dark) {
          out += `<path d="M${f(x - hw * 0.45)} ${f(yt + s * 0.28)}L${f(x)} ${f(yt)}L${f(x + hw * 0.45)} ${f(yt + s * 0.28)}L${f(x + hw * 0.15)} ${f(yt + s * 0.2)}L${f(x - hw * 0.1)} ${f(yt + s * 0.3)}Z" fill="#f8fafc" opacity=".92"/>`;
        }
      }
      return out;
    }
    case 'basalt': {
      const body = dark ? p.deep : p.face, top = dark ? p.deep : p.lit;
      let out = `<path d="M${f(x - s * 0.7)} ${f(base)}L${f(x - s * 0.55)} ${f(base - s * 0.75)}L${f(x - s * 0.1)} ${f(base - s * 1.05)}L${f(x + s * 0.45)} ${f(base - s * 0.85)}L${f(x + s * 0.7)} ${f(base)}Z" fill="${body}" ${rim}/>`
        + `<path d="M${f(x - s * 0.55)} ${f(base - s * 0.75)}L${f(x - s * 0.1)} ${f(base - s * 1.05)}L${f(x + s * 0.45)} ${f(base - s * 0.85)}L${f(x - s * 0.05)} ${f(base - s * 0.7)}Z" fill="${top}" opacity=".85"/>`;
      if (!dark) {
        out += `<path d="M${f(x - s * 0.2)} ${f(base - s * 0.62)}l${f(s * 0.12)} ${f(s * 0.22)} ${f(-s * 0.08)} ${f(s * 0.2)} ${f(s * 0.16)} ${f(s * 0.18)}" stroke="${p.glow}" stroke-width="2" fill="none" opacity=".75"/>`;
      }
      return out;
    }
    case 'coral': {
      const c = dark ? p.deep : p.accent, c2 = dark ? p.deep : p.light;
      let out = `<path d="M${f(x)} ${f(base)}V${f(base - s * 1.4)}M${f(x)} ${f(base - s * 0.6)}Q${f(x - s * 0.55)} ${f(base - s * 0.7)} ${f(x - s * 0.5)} ${f(base - s * 1.2)}M${f(x)} ${f(base - s * 0.9)}Q${f(x + s * 0.6)} ${f(base - s)} ${f(x + s * 0.55)} ${f(base - s * 1.55)}" stroke="${c}" stroke-width="${f(s * 0.15)}" stroke-linecap="round" fill="none"/>`
        + `<path d="M${f(x + s * 0.9)} ${f(base)}q${f(-s * 0.3)} ${f(-s * 0.6)} 0 ${f(-s * 1.2)} ${f(s * 0.25)} ${f(-s * 0.5)} ${f(-s * 0.05)} ${f(-s * 0.9)}" stroke="${c2}" stroke-width="${f(s * 0.08)}" stroke-linecap="round" fill="none" opacity=".8"/>`;
      if (!dark) {
        for (const [bx, by, br] of [[0.3, 1.6, 0.07], [0.45, 1.9, 0.05], [0.2, 2.1, 0.04]]) {
          out += `<circle cx="${f(x + bx * s)}" cy="${f(base - by * s)}" r="${f(br * s)}" fill="none" stroke="#e0f2fe" stroke-opacity=".7" stroke-width="1.2"/>`;
        }
      }
      return out;
    }
    case 'cactus': {
      const g = dark ? p.deep : '#4d7c0f', gl = dark ? p.deep : '#84cc16';
      const w = s * 0.24;
      return `<rect x="${f(x - w / 2)}" y="${f(base - s * 1.5)}" width="${f(w)}" height="${f(s * 1.5)}" rx="${f(w / 2)}" fill="${g}" ${rim}/>`
        + `<path d="M${f(x - w / 2)} ${f(base - s * 0.7)}h${f(-s * 0.25)}v${f(-s * 0.4)}" stroke="${g}" stroke-width="${f(w * 0.8)}" stroke-linecap="round" fill="none"/>`
        + `<path d="M${f(x + w / 2)} ${f(base - s * 0.95)}h${f(s * 0.22)}v${f(-s * 0.35)}" stroke="${g}" stroke-width="${f(w * 0.8)}" stroke-linecap="round" fill="none"/>`
        + (dark ? '' : `<rect x="${f(x - w / 2 + 2)}" y="${f(base - s * 1.45)}" width="${f(w * 0.3)}" height="${f(s * 1.35)}" rx="2" fill="${gl}" opacity=".55"/>`);
    }
    case 'obelisk': {
      const y0 = base - s * 0.35;
      let out = dark ? '' : `<ellipse cx="${f(x)}" cy="${f(base)}" rx="${f(s * 0.4)}" ry="${f(s * 0.09)}" fill="#000" opacity=".35"/>`;
      out += `<path d="M${f(x)} ${f(y0)}L${f(x - s * 0.22)} ${f(y0 - s * 0.9)}L${f(x)} ${f(y0 - s * 1.6)}Z" fill="${L}" ${rim}/>`
        + `<path d="M${f(x)} ${f(y0)}L${f(x + s * 0.22)} ${f(y0 - s * 0.9)}L${f(x)} ${f(y0 - s * 1.6)}Z" fill="${R}" ${rim}/>`;
      if (!dark) out += `<path d="M${f(x)} ${f(y0 - s * 0.35)}V${f(y0 - s * 1.2)}" stroke="${p.glow}" stroke-width="2" opacity=".9"/>`;
      return out;
    }
    case 'pillar': {
      const w = s * 0.42, body = dark ? p.deep : mix(p.lit, '#ffffff', 0.15), sh = dark ? p.deep : p.face;
      const gold = dark ? p.deep : '#fbbf24';
      return `<rect x="${f(x - w / 2)}" y="${f(base - s * 1.55)}" width="${f(w)}" height="${f(s * 1.55)}" fill="${body}" ${rim}/>`
        + `<rect x="${f(x)}" y="${f(base - s * 1.55)}" width="${f(w / 2)}" height="${f(s * 1.55)}" fill="${sh}" opacity=".7"/>`
        + `<rect x="${f(x - w * 0.75)}" y="${f(base - s * 1.7)}" width="${f(w * 1.5)}" height="${f(s * 0.16)}" fill="${gold}"/>`
        + `<rect x="${f(x - w * 0.7)}" y="${f(base - s * 0.1)}" width="${f(w * 1.4)}" height="${f(s * 0.1)}" fill="${gold}" opacity=".8"/>`;
    }
  }
}

/* ── far: mountain ranges fading into the sky ─────────────────────── */
function ridgeLayer(style: Ridge, W: number, yb: number, r: () => number, p: Pal, b: Biome, id: string): string {
  const pts: [number, number][] = [];
  const steps = style === 'jagged' ? 16 : style === 'peaks' ? 9 : style === 'dunes' ? 4 : 7;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const high = style === 'jagged' || style === 'peaks' ? i % 2 === 1 : true;
    const h = high ? 110 + r() * 120 : 30 + r() * 50;
    pts.push([x + (i > 0 && i < steps ? (r() - 0.5) * (W / steps) * 0.4 : 0), yb - h]);
  }
  const sharp = style === 'jagged' || style === 'peaks';
  let d = `M0 ${yb}L${f(pts[0][0])} ${f(pts[0][1])}`;
  if (sharp) {
    for (let i = 1; i < pts.length; i++) d += `L${f(pts[i][0])} ${f(pts[i][1])}`;
  } else {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      d += `C${f(mx)} ${f(y0)} ${f(mx)} ${f(y1)} ${f(x1)} ${f(y1)}`;
    }
  }
  d += `L${W} ${yb}Z`;
  let out = `<path d="${d}" fill="url(#${id})"/>`;
  // Rim light along the ridge.
  out += `<path d="${d.replace(/L\d+(\.\d+)? \d+(\.\d+)?Z$/, '').replace(/^M0 [\d.]+L/, 'M')}" fill="none" stroke="${b.glow}" stroke-opacity=".3" stroke-width="1.5"/>`;
  if (style === 'peaks') {
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [px, py] = pts[i], [lx, ly] = pts[i - 1], [rx, ry] = pts[i + 1];
      const a = [px + (lx - px) * 0.3, py + (ly - py) * 0.3], c = [px + (rx - px) * 0.3, py + (ry - py) * 0.3];
      out += `<path d="M${f(a[0])} ${f(a[1])}L${f(px)} ${f(py)}L${f(c[0])} ${f(c[1])}L${f((px + c[0]) / 2)} ${f(c[1] - 6)}L${f((px + a[0]) / 2)} ${f(a[1] + 4)}Z" fill="#f1f5f9" opacity=".75"/>`;
    }
  }
  if (style === 'volcano') {
    const cx = W * (0.3 + r() * 0.4), top = yb - 230;
    out += `<path d="M${f(cx - 150)} ${yb}L${f(cx - 26)} ${f(top)}H${f(cx + 26)}L${f(cx + 150)} ${yb}Z" fill="url(#${id})"/>`
      + `<ellipse cx="${f(cx)}" cy="${f(top)}" rx="30" ry="7" fill="${b.glow}" opacity=".85"/>`
      + `<ellipse cx="${f(cx)}" cy="${f(top - 20)}" rx="70" ry="40" fill="${b.accent}" opacity=".18"/>`
      + `<path d="M${f(cx - 18)} ${f(top + 2)}q-22 40 -64 96" stroke="${b.glow}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".5"/>`
      + `<path d="M${f(cx + 14)} ${f(top + 2)}q20 30 46 70" stroke="${b.glow}" stroke-width="4" stroke-linecap="round" fill="none" opacity=".4"/>`;
  }
  if (style === 'temple') {
    const cx = W * (0.25 + r() * 0.5), base = yb - 60;
    for (let k = 0; k < 4; k++) {
      const w = 150 - k * 34, h = 22;
      out += `<rect x="${f(cx - w / 2)}" y="${f(base - (k + 1) * h)}" width="${f(w)}" height="${h}" fill="${p.face}" opacity=".9"/>`;
    }
    out += `<rect x="${f(cx - 8)}" y="${f(base - 118)}" width="16" height="30" fill="${b.glow}" opacity=".6"/>`;
  }
  return out;
}

/* ── mid: cliffs along both edges ─────────────────────────────────── */
/** Inner edge x of the left cliff at height y; periodic in TILE so tiles join. */
function edgeX(y: number, width: number, phase: number): number {
  const t = (y / TILE) * Math.PI * 2;
  return width * (0.78 + 0.14 * Math.sin(t * 2 + phase) + 0.08 * Math.sin(t * 3 + phase * 2));
}

function cliff(side: 'L' | 'R', W: number, width: number, phase: number, p: Pal): string {
  const X = (x: number) => (side === 'L' ? x : W - x);
  const ys: number[] = [];
  for (let y = 0; y <= TILE; y += 20) ys.push(y);
  const edge = ys.map((y) => [edgeX(y, width, phase), y] as const);
  const body = `M${X(0)} 0` + edge.map(([x, y]) => `L${f(X(x))} ${y}`).join('') + `L${X(0)} ${TILE}Z`;
  const face = `M${f(X(edge[0][0]))} 0` + edge.map(([x, y]) => `L${f(X(x))} ${y}`).join('')
    + [...edge].reverse().map(([x, y]) => `L${f(X(x - 16))} ${y}`).join('') + 'Z';
  const rimLine = `M${f(X(edge[0][0]))} 0` + edge.map(([x, y]) => `L${f(X(x))} ${y}`).join('');
  return `<path d="${body}" fill="url(#cliff${side})"/>`
    + `<path d="${face}" fill="${p.face}" opacity=".9"/>`
    + `<path d="${rimLine}" fill="none" stroke="${p.lit}" stroke-width="3" opacity=".85"/>`;
}

/** Margin (px) on each side that the path never enters, for a stage w px wide. */
export function freeMargin(w: number): number {
  const half = w / 2;
  const amp = Math.max(40, Math.min(half - 52, 260));
  return Math.max(24, half - amp - 30);
}

/** Far, mid and fore layers for one biome at stage width w. */
export function biomeLayers(b: Biome, w: number): { far: string; mid: string; fore: string } {
  const W = Math.max(320, Math.round(w));
  const r = rng(hash(b.id));
  const p = palette(b);
  const st = styleFor(b);
  const margin = freeMargin(W);

  const wrap = (defs: string, body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${TILE}" preserveAspectRatio="none"><defs>${defs}</defs>${body}</svg>`;

  // far
  // Atmospheric perspective: the farther range is lighter and hazier.
  const farDefs = ['A', 'B'].map((k, i) => {
    const top = i ? mix(p.face, b.glow, 0.16) : mix(p.face, b.glow, 0.3);
    return `<linearGradient id="r${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}" stop-opacity="${i ? 0.95 : 0.7}"/><stop offset=".65" stop-color="${p.face}" stop-opacity="${i ? 0.55 : 0.35}"/><stop offset="1" stop-color="${p.rock}" stop-opacity="0"/></linearGradient>`;
  }).join('');
  let far = `<ellipse cx="${W / 2}" cy="${TILE * 0.42}" rx="${W * 0.6}" ry="120" fill="${b.glow}" opacity=".06"/>`;
  far += ridgeLayer(st.ridge, W, 330, r, p, b, 'rA');
  far += ridgeLayer(st.ridge, W, TILE, r, p, b, 'rB');

  // mid
  const cliffW = Math.min(margin + 26, W * 0.24);
  const midDefs = ['L', 'R'].map((s) =>
    `<linearGradient id="cliff${s}" x1="${s === 'L' ? 0 : 1}" y1="0" x2="${s === 'L' ? 1 : 0}" y2="0"><stop offset="0" stop-color="${p.deep}"/><stop offset="1" stop-color="${p.rock}"/></linearGradient>`).join('');
  let mid = '';
  const phases = [r() * 6, r() * 6];
  (['L', 'R'] as const).forEach((side, si) => {
    mid += cliff(side, W, cliffW, phases[si], p);
    // Props standing on the cliff top, three per tile per side.
    for (let k = 0; k < 3; k++) {
      const y = 150 + k * 190 + r() * 40;
      const ex = edgeX(y, cliffW, phases[si]);
      const s = Math.max(14, Math.min(42, cliffW * 0.32));
      const x = side === 'L' ? ex * (0.35 + r() * 0.35) : W - ex * (0.35 + r() * 0.35);
      const kind = st.props[Math.floor(r() * st.props.length)];
      mid += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 0.9)}" ry="${f(s * 0.18)}" fill="#000" opacity=".3"/>`;
      mid += propArt(kind, x, y, s, p);
    }
  });
  mid += `<rect x="0" y="${TILE * 0.45}" width="${W}" height="60" fill="${p.glow}" opacity=".035"/>`;

  // fore: big dark silhouettes, extreme edges only
  let fore = '';
  for (let i = 0; i < 4; i++) {
    const left = i % 2 === 0;
    const s = Math.max(26, Math.min(80, margin * 0.55)) * (0.85 + r() * 0.4);
    const x = left ? s * 0.25 + r() * 6 : W - s * 0.25 - r() * 6;
    const base = s * 2 + 20 + i * ((TILE - s * 2 - 40) / 4);
    fore += propArt(st.props[i % st.props.length], x, base, s, p, true);
  }

  return { far: svgUri(wrap(farDefs, far)), mid: svgUri(wrap(midDefs, mid)), fore: svgUri(wrap('', fore)) };
}

/** Small decoration beside a path node, as an image URI (48×56 box). */
export function decoUri(b: Biome, level: number): string {
  const p = palette(b);
  const kinds = styleFor(b).props;
  const kind = kinds[level % kinds.length];
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56"><ellipse cx="24" cy="52" rx="16" ry="3.5" fill="#000" opacity=".35"/>${propArt(kind, 24, 52, 24, p)}</svg>`);
}
