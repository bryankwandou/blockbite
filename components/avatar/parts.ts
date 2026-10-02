/**
 * Modular BlockBite avatars.
 *
 * An avatar is a short code, e.g. "m1-b03-p11-e07-m04-a15-g02":
 *   m1  format version
 *   b   body shape        p palette       e eyes
 *   m   mouth             a headgear      g background
 * The database keeps only this code (≤ 32 chars, fits ^[a-z0-9-]{1,40}$).
 * Rendering is one inline SVG string built from flat shapes, no images.
 */

type Pal = { name: string; main: string; dark: string; light: string; ink: string };

export const PALETTES: Pal[] = [
  { name: 'Grape',   main: '#9945FF', dark: '#5B1FB0', light: '#D7B8FF', ink: '#1A0B33' },
  { name: 'Aqua',    main: '#14F1D9', dark: '#0A9E8E', light: '#B9FFF6', ink: '#05302B' },
  { name: 'Lava',    main: '#FF5A1F', dark: '#B32C00', light: '#FFC2A6', ink: '#3A0F00' },
  { name: 'Lime',    main: '#7CFF4F', dark: '#3AA51E', light: '#D9FFC9', ink: '#123A06' },
  { name: 'Sun',     main: '#FFD23F', dark: '#C79100', light: '#FFF1B8', ink: '#3D2C00' },
  { name: 'Rose',    main: '#FF4F9A', dark: '#B01A5E', light: '#FFC4DD', ink: '#3A0620' },
  { name: 'Sky',     main: '#3FA7FF', dark: '#155FB8', light: '#C2E2FF', ink: '#061E3D' },
  { name: 'Mint',    main: '#5BE3A0', dark: '#1F8F5A', light: '#CCF7E2', ink: '#06301C' },
  { name: 'Coal',    main: '#3A3F55', dark: '#1D2030', light: '#8E94B0', ink: '#F2F3FA' },
  { name: 'Snow',    main: '#EDEFF7', dark: '#A9AFC7', light: '#FFFFFF', ink: '#20243A' },
  { name: 'Cherry',  main: '#E11D48', dark: '#8A0A26', light: '#FDA4B8', ink: '#2B020B' },
  { name: 'Ocean',   main: '#2546F0', dark: '#132690', light: '#AFBDFF', ink: '#F0F3FF' },
  { name: 'Peach',   main: '#FF9E7A', dark: '#C9603A', light: '#FFE0D3', ink: '#3A160A' },
  { name: 'Olive',   main: '#A3A82A', dark: '#626512', light: '#E4E7A4', ink: '#22230A' },
  { name: 'Violet',  main: '#C026D3', dark: '#7A0E87', light: '#F2B8FA', ink: '#2A0230' },
  { name: 'Copper',  main: '#C27C3E', dark: '#7C4719', light: '#EBC7A5', ink: '#2B1606' },
];

type Body = { name: string; draw: (p: Pal) => string; top: number; cy: number };

const r = (x: number, y: number, w: number, h: number, fill: string, rx = 0, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${extra}/>`;
/** A block with a darker base strip and a light top edge: the BlockBite bevel. */
const block = (x: number, y: number, w: number, h: number, p: Pal, rx = 6) =>
  r(x, y, w, h, p.dark, rx) + r(x, y, w, h - 5, p.main, rx) + r(x + 4, y + 3, w - 8, 4, p.light, 2, ' opacity=".55"');

export const BODIES: Body[] = [
  { name: 'Cube', top: 26, cy: 52, draw: (p) => block(22, 26, 56, 56, p) },
  { name: 'Tower', top: 18, cy: 48, draw: (p) => block(28, 18, 44, 70, p) },
  { name: 'Slab', top: 34, cy: 56, draw: (p) => block(14, 34, 72, 46, p) },
  { name: 'Ell', top: 24, cy: 46, draw: (p) => block(20, 24, 44, 44, p) + block(20, 66, 64, 20, p, 4) },
  { name: 'Tee', top: 22, cy: 44, draw: (p) => block(20, 22, 60, 44, p) + block(36, 64, 28, 22, p, 4) },
  { name: 'Round', top: 24, cy: 52, draw: (p) => block(20, 24, 60, 60, p, 18) },
  {
    name: 'Iso', top: 24, cy: 58, draw: (p) =>
      `<path d="M50 16 L82 32 L50 48 L18 32Z" fill="${p.light}"/>` +
      `<path d="M18 32 L50 48 L50 88 L18 72Z" fill="${p.main}"/>` +
      `<path d="M82 32 L50 48 L50 88 L82 72Z" fill="${p.dark}"/>`,
  },
  { name: 'Stack', top: 20, cy: 40, draw: (p) => block(26, 20, 48, 40, p) + block(18, 58, 64, 28, p, 4) },
  { name: 'Gem', top: 18, cy: 54, draw: (p) => `<path d="M50 14 L86 52 L50 90 L14 52Z" fill="${p.dark}"/><path d="M50 18 L82 52 L50 84 L18 52Z" fill="${p.main}"/><path d="M50 18 L66 35 L34 35Z" fill="${p.light}" opacity=".5"/>` },
  { name: 'Duo', top: 26, cy: 52, draw: (p) => block(14, 26, 36, 56, p, 5) + block(50, 26, 36, 56, p, 5) + r(48, 30, 4, 46, p.dark) },
];

type Part = { name: string; draw: (p: Pal, cy: number) => string };

const c = (x: number, y: number, rr: number, fill: string, extra = '') => `<circle cx="${x}" cy="${y}" r="${rr}" fill="${fill}"${extra}/>`;
const line = (d: string, stroke: string, w = 3) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const EYES: Part[] = [
  { name: 'Dots', draw: (p, y) => c(40, y - 6, 3.5, p.ink) + c(60, y - 6, 3.5, p.ink) },
  { name: 'Big', draw: (p, y) => c(39, y - 7, 7, '#fff') + c(61, y - 7, 7, '#fff') + c(41, y - 6, 3.5, '#111') + c(63, y - 6, 3.5, '#111') + c(42, y - 8, 1.2, '#fff') + c(64, y - 8, 1.2, '#fff') },
  { name: 'Sleepy', draw: (p, y) => line(`M33 ${y - 6} q6 4 12 0 M55 ${y - 6} q6 4 12 0`, p.ink) },
  { name: 'Angry', draw: (p, y) => line(`M32 ${y - 12} l12 4 M68 ${y - 12} l-12 4`, p.ink) + c(40, y - 4, 3, p.ink) + c(60, y - 4, 3, p.ink) },
  { name: 'Stars', draw: (p, y) => [40, 60].map((x) => `<path d="M${x} ${y - 13} l2 5 5 0 -4 3 2 5 -5 -3 -5 3 2 -5 -4 -3 5 0Z" fill="${p.light}" stroke="${p.ink}" stroke-width="1"/>`).join('') },
  { name: 'Ex', draw: (p, y) => line(`M35 ${y - 11} l9 9 M44 ${y - 11} l-9 9 M56 ${y - 11} l9 9 M65 ${y - 11} l-9 9`, p.ink) },
  { name: 'Visor', draw: (p, y) => r(28, y - 13, 44, 11, '#0b0b16', 5) + r(32, y - 11, 14, 3, '#5ef', 1.5) },
  { name: 'Cyclops', draw: (p, y) => c(50, y - 7, 9, '#fff') + c(50, y - 6, 4.5, '#111') + c(52, y - 9, 1.5, '#fff') },
  { name: 'Pixel', draw: (p, y) => r(35, y - 11, 8, 8, p.ink) + r(57, y - 11, 8, 8, p.ink) + r(37, y - 10, 3, 3, '#fff') + r(59, y - 10, 3, 3, '#fff') },
  { name: 'Wink', draw: (p, y) => c(40, y - 6, 4, p.ink) + line(`M55 ${y - 6} h11`, p.ink) },
  { name: 'Specs', draw: (p, y) => `<circle cx="40" cy="${y - 6}" r="7" fill="none" stroke="${p.ink}" stroke-width="2.5"/><circle cx="60" cy="${y - 6}" r="7" fill="none" stroke="${p.ink}" stroke-width="2.5"/>` + line(`M47 ${y - 6} h6`, p.ink, 2.5) + c(40, y - 6, 2, p.ink) + c(60, y - 6, 2, p.ink) },
  { name: 'Hearts', draw: (_p, y) => [40, 60].map((x) => `<path d="M${x} ${y - 1} l-6 -6 a3.4 3.4 0 0 1 6 -4 a3.4 3.4 0 0 1 6 4Z" fill="#ff3b6b"/>`).join('') },
];

export const MOUTHS: Part[] = [
  { name: 'Smile', draw: (p, y) => line(`M41 ${y + 6} q9 8 18 0`, p.ink) },
  { name: 'Grin', draw: (p, y) => `<path d="M38 ${y + 4} h24 q0 12 -12 12 q-12 0 -12 -12Z" fill="${p.ink}"/>` + r(42, y + 4, 16, 3, '#fff') },
  { name: 'Flat', draw: (p, y) => line(`M42 ${y + 8} h16`, p.ink) },
  { name: 'Oh', draw: (p, y) => c(50, y + 9, 4.5, p.ink) },
  { name: 'Fangs', draw: (p, y) => line(`M40 ${y + 5} q10 7 20 0`, p.ink) + `<path d="M44 ${y + 7} l2 5 2 -4Z M52 ${y + 8} l2 4 2 -5Z" fill="#fff"/>` },
  { name: 'Tongue', draw: (p, y) => line(`M41 ${y + 5} q9 7 18 0`, p.ink) + `<path d="M47 ${y + 8} h7 v4 a3.5 3.5 0 0 1 -7 0Z" fill="#ff5d8f"/>` },
  { name: 'Zigzag', draw: (p, y) => line(`M38 ${y + 8} l4 -3 4 3 4 -3 4 3 4 -3 4 3`, p.ink, 2.5) },
  { name: 'Chomp', draw: (p, y) => `<path d="M36 ${y + 2} h28 v6 a14 10 0 0 1 -28 0Z" fill="${p.ink}"/>` + `<path d="M38 ${y + 2} l3 4 3 -4 3 4 3 -4 3 4 3 -4 3 4 3 -4 3 4 1 -4Z" fill="#fff"/>` },
  { name: 'Smirk', draw: (p, y) => line(`M42 ${y + 8} q10 2 16 -4`, p.ink) },
  { name: 'Teeth', draw: (p, y) => r(39, y + 3, 22, 9, '#fff', 2, ` stroke="${p.ink}" stroke-width="2"`) + line(`M46 ${y + 3} v9 M54 ${y + 3} v9 M39 ${y + 7.5} h22`, p.ink, 1.2) },
  { name: 'Cat', draw: (p, y) => line(`M40 ${y + 5} q5 6 10 0 q5 6 10 0`, p.ink) },
  { name: 'Frown', draw: (p, y) => line(`M41 ${y + 11} q9 -8 18 0`, p.ink) },
];

type Gear = { name: string; draw: (p: Pal, top: number) => string };

export const GEAR: Gear[] = [
  { name: 'None', draw: () => '' },
  { name: 'Crown', draw: (_p, t) => `<path d="M34 ${t + 2} l0 -14 8 7 8 -11 8 11 8 -7 0 14Z" fill="#FFC83D" stroke="#B07D00" stroke-width="1.5"/>` + c(50, t - 6, 2, '#ff3b6b') },
  { name: 'Cap', draw: (p, t) => `<path d="M30 ${t + 2} q0 -16 20 -16 q20 0 20 16Z" fill="${p.dark}"/>` + r(60, t - 2, 22, 5, p.dark, 2) + c(50, t - 13, 2.5, p.light) },
  { name: 'Horns', draw: (_p, t) => `<path d="M30 ${t + 1} q-8 -10 -4 -18 q4 10 12 14Z M70 ${t + 1} q8 -10 4 -18 q-4 10 -12 14Z" fill="#F4E9D8" stroke="#9c8a6c" stroke-width="1.2"/>` },
  { name: 'Antenna', draw: (p, t) => line(`M50 ${t} v-14`, p.ink, 2.5) + c(50, t - 16, 4, '#ff3b6b') },
  { name: 'Band', draw: (_p, t) => r(20, t + 3, 60, 7, '#ff3b6b', 2) + `<path d="M80 ${t + 6} l8 -4 -2 8Z M80 ${t + 7} l9 4 -6 4Z" fill="#ff3b6b"/>` },
  { name: 'Halo', draw: (_p, t) => `<ellipse cx="50" cy="${t - 8}" rx="16" ry="4.5" fill="none" stroke="#FFE066" stroke-width="3.5"/>` },
  { name: 'Bow', draw: (_p, t) => `<path d="M50 ${t} l-14 -8 v16Z M50 ${t} l14 -8 v16Z" fill="#ff5da2"/>` + c(50, t, 3.5, '#d43f84') },
  { name: 'Mohawk', draw: (p, t) => `<path d="M38 ${t + 1} l3 -14 4 9 5 -13 5 13 4 -9 3 14Z" fill="${p.light}" stroke="${p.dark}" stroke-width="1.2"/>` },
  { name: 'TopHat', draw: () => '', },
  { name: 'Phones', draw: (_p, t) => `<path d="M24 ${t + 18} q0 -26 26 -26 q26 0 26 26" fill="none" stroke="#222" stroke-width="4"/>` + r(17, t + 12, 9, 16, '#222', 3) + r(74, t + 12, 9, 16, '#222', 3) },
  { name: 'Sprout', draw: (_p, t) => line(`M50 ${t} v-10`, '#2f8f2f', 2.5) + `<path d="M50 ${t - 9} q-12 -2 -12 -10 q10 0 12 10Z M50 ${t - 9} q12 -2 12 -10 q-10 0 -12 10Z" fill="#4cd964"/>` },
  { name: 'Flame', draw: (_p, t) => `<path d="M50 ${t - 22} q12 10 8 18 q-2 5 -8 6 q-8 -1 -9 -7 q-1 -7 4 -10 q0 6 3 6 q-2 -8 2 -13Z" fill="#FF7A1A"/><path d="M50 ${t - 8} q5 3 3 7 q-3 3 -6 0 q-1 -4 3 -7Z" fill="#FFD23F"/>` },
  { name: 'Ears', draw: (p, t) => `<path d="M24 ${t + 4} l4 -16 12 12Z M76 ${t + 4} l-4 -16 -12 12Z" fill="${p.dark}"/><path d="M27 ${t + 1} l2 -8 6 6Z M73 ${t + 1} l-2 -8 -6 6Z" fill="#ffb3c7"/>` },
  { name: 'Prop', draw: (p, t) => r(46, t - 6, 8, 7, p.ink, 2) + `<ellipse cx="38" cy="${t - 8}" rx="11" ry="3" fill="#ff3b6b"/><ellipse cx="62" cy="${t - 8}" rx="11" ry="3" fill="#3FA7FF"/>` + c(50, t - 8, 3, '#FFD23F') },
  { name: 'Block', draw: (_p, t) => r(40, t - 16, 10, 10, '#FFD23F', 2) + r(50, t - 16, 10, 10, '#FF5A1F', 2) + r(45, t - 26, 10, 10, '#14F1D9', 2) },
];
// Top hat is drawn here so it can use the palette ink colour.
GEAR[9].draw = (p, t) => r(36, t - 2, 28, 5, p.ink, 2) + r(40, t - 22, 20, 21, p.ink, 2) + r(40, t - 8, 20, 4, '#ff3b6b');

type Bg = { name: string; draw: (p: Pal) => string };
const frame = (fill: string) => r(0, 0, 100, 100, fill, 22);

export const BACKGROUNDS: Bg[] = [
  { name: 'Night', draw: () => frame('#0E0B1F') },
  { name: 'Grid', draw: (p) => frame('#0E0B1F') + `<path d="M0 20H100M0 40H100M0 60H100M0 80H100M20 0V100M40 0V100M60 0V100M80 0V100" stroke="${p.main}" stroke-opacity=".18" stroke-width="1"/>` },
  { name: 'Dots', draw: (p) => frame(p.ink) + Array.from({ length: 16 }, (_, i) => c(12 + (i % 4) * 25, 12 + Math.floor(i / 4) * 25, 2.2, p.light, ' opacity=".35"')).join('') },
  { name: 'Stripes', draw: (p) => frame(p.dark) + `<path d="M-10 30 L30 -10 M-10 60 L60 -10 M-10 90 L90 -10 M10 110 L110 10 M40 110 L110 40 M70 110 L110 70" stroke="${p.light}" stroke-opacity=".22" stroke-width="7"/>` },
  { name: 'Burst', draw: (p) => frame(p.light) + Array.from({ length: 12 }, (_, i) => `<path d="M50 50 L${50 + 80 * Math.cos(i * Math.PI / 6)} ${50 + 80 * Math.sin(i * Math.PI / 6)} L${50 + 80 * Math.cos((i + .5) * Math.PI / 6)} ${50 + 80 * Math.sin((i + .5) * Math.PI / 6)}Z" fill="${p.main}" opacity=".25"/>`).join('').replace(/(\d+\.\d{2})\d+/g, '$1') },
  { name: 'Pieces', draw: () => frame('#140F2B') + r(6, 8, 8, 8, '#FFD23F', 1.5) + r(14, 8, 8, 8, '#FFD23F', 1.5) + r(82, 70, 8, 8, '#14F1D9', 1.5) + r(82, 78, 8, 8, '#14F1D9', 1.5) + r(74, 78, 8, 8, '#14F1D9', 1.5) + r(8, 84, 8, 8, '#FF4F9A', 1.5) + r(84, 10, 8, 8, '#7CFF4F', 1.5) },
  { name: 'Split', draw: (p) => frame(p.dark) + `<path d="M0 100 L100 0 V78 Q100 100 78 100Z" fill="${p.ink}" opacity=".5"/>` },
  { name: 'Rings', draw: (p) => frame('#0E0B1F') + [44, 34, 24].map((rr) => `<circle cx="50" cy="54" r="${rr}" fill="none" stroke="${p.main}" stroke-opacity=".2" stroke-width="5"/>`).join('') },
  { name: 'Checker', draw: (p) => frame(p.ink) + Array.from({ length: 25 }, (_, i) => ((i + Math.floor(i / 5)) % 2 ? r((i % 5) * 20, Math.floor(i / 5) * 20, 20, 20, p.main, 0, ' opacity=".14"') : '')).join('') },
  { name: 'Day', draw: () => frame('#DDE7FF') + `<ellipse cx="22" cy="20" rx="12" ry="5" fill="#fff"/><ellipse cx="78" cy="14" rx="10" ry="4" fill="#fff"/>` },
];

export const AVATAR_PARTS = { b: BODIES, p: PALETTES, e: EYES, m: MOUTHS, a: GEAR, g: BACKGROUNDS } as const;
export type PartKey = keyof typeof AVATAR_PARTS;
export const PART_KEYS: PartKey[] = ['b', 'p', 'e', 'm', 'a', 'g'];

export type AvatarParts = Record<PartKey, number>;

export const AVATAR_COMBOS = PART_KEYS.reduce((n, k) => n * AVATAR_PARTS[k].length, 1);

export const CODE_RE = /^m1-b(\d{2})-p(\d{2})-e(\d{2})-m(\d{2})-a(\d{2})-g(\d{2})$/;

/** Parses a code; null when it is malformed or names a part that does not exist. */
export function parseCode(code: unknown): AvatarParts | null {
  if (typeof code !== 'string') return null;
  const m = CODE_RE.exec(code);
  if (!m) return null;
  const out = {} as AvatarParts;
  for (let i = 0; i < PART_KEYS.length; i++) {
    const k = PART_KEYS[i];
    const v = Number(m[i + 1]);
    if (v >= AVATAR_PARTS[k].length) return null;
    out[k] = v;
  }
  return out;
}

export function formatCode(p: AvatarParts): string {
  return 'm1-' + PART_KEYS.map((k) => k + String(p[k]).padStart(2, '0')).join('-');
}

export const isAvatarCode = (code: unknown): code is string => parseCode(code) !== null;

/** Deterministic parts from any integer seed (used for the featured grid). */
export function partsFromSeed(seed: number): AvatarParts {
  let x = (seed * 2654435761) >>> 0;
  const out = {} as AvatarParts;
  for (const k of PART_KEYS) {
    x = (x ^ (x >>> 13)) * 1103515245 + 12345 >>> 0;
    out[k] = (x >>> 8) % AVATAR_PARTS[k].length;
  }
  return out;
}

export function randomParts(): AvatarParts {
  return partsFromSeed(Math.floor(Math.random() * 2 ** 31));
}

export function avatarName(p: AvatarParts): string {
  return `${PALETTES[p.p].name} ${BODIES[p.b].name}`;
}

/** Full SVG markup for a code's parts (viewBox 0 0 100 100). */
export function avatarSvg(p: AvatarParts, size = 100): string {
  const pal = PALETTES[p.p];
  const body = BODIES[p.b];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">`
    + BACKGROUNDS[p.g].draw(pal)
    + body.draw(pal)
    + EYES[p.e].draw(pal, body.cy)
    + MOUTHS[p.m].draw(pal, body.cy)
    + GEAR[p.a].draw(pal, body.top)
    + '</svg>';
}
