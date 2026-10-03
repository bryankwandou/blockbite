/**
 * Every default BlockBite avatar, in one list.
 *
 * The id is a stable slug. It is what we store (localStorage and the
 * profile DB column), so never rename or reorder an existing id; add new
 * ones at the end of their group.
 *
 *   crew      4  hand-drawn mascot PNGs (public/mascots)
 *   brand     1  Blaze, the fifth named mascot (SVG)
 *   bite    100  generated block mascots (components/Mascot generateMascots)
 *   gem      12  gradient gem badges (pure CSS)
 *   pilot     9  portraits cut from public/assets/avatars/all.png (3x3 sheet)
 *
 * Plus modular block avatars: any valid code "m1-b03-p11-e07-m04-a15-g02" (m2-...-pXXX for palettes >= 100)
 * (components/avatar/parts.ts) is an avatar id too, over a million of them.
 */
import { BRAND_MASCOTS, generateMascots, type MascotConfig } from '@/components/Mascot';
import { avatarName, parseCode, type AvatarParts } from '@/components/avatar/parts';

export { AVATAR_COMBOS, formatCode, isAvatarCode, parseCode, partsFromSeed, randomParts } from '@/components/avatar/parts';

export interface GemConfig {
  id: number;
  name: string;
  bg: string;
  symbol: string;
  symbolColor: string;
  glowColor: string;
}

export const GEM_CONFIGS: GemConfig[] = [
  { id: 0,  name: 'Phantom', bg: 'linear-gradient(135deg, #9945FF, #5500AA)', symbol: '◈',   symbolColor: '#E8CCFF', glowColor: '#9945FF' },
  { id: 1,  name: 'Nova',    bg: 'linear-gradient(135deg, #00F5FF, #0088FF)', symbol: '◆',   symbolColor: '#CCFFFF', glowColor: '#00F5FF' },
  { id: 2,  name: 'Magma',   bg: 'linear-gradient(135deg, #FF6B00, #FF0040)', symbol: '▲',   symbolColor: '#FFE8CC', glowColor: '#FF6B00' },
  { id: 3,  name: 'Jade',    bg: 'linear-gradient(135deg, #00FF88, #00AA44)', symbol: '⬡',   symbolColor: '#CCFFE8', glowColor: '#00FF88' },
  { id: 4,  name: 'Volt',    bg: 'linear-gradient(135deg, #FFD700, #FF8C00)', symbol: '///', symbolColor: '#FFFFCC', glowColor: '#FFD700' },
  { id: 5,  name: 'Void',    bg: 'linear-gradient(135deg, #1A1A2E, #333355)', symbol: '◆',   symbolColor: '#8888BB', glowColor: '#AA00FF' },
  { id: 6,  name: 'Crystal', bg: 'linear-gradient(135deg, #FF00FF, #AA0066)', symbol: '◇',   symbolColor: '#FFE0FF', glowColor: '#FF00FF' },
  { id: 7,  name: 'Glacier', bg: 'linear-gradient(135deg, #00C3FF, #0040FF)', symbol: '///', symbolColor: '#E0F8FF', glowColor: '#00C3FF' },
  { id: 8,  name: 'Ember',   bg: 'linear-gradient(135deg, #FF4444, #990000)', symbol: '▲',   symbolColor: '#FFD0D0', glowColor: '#FF4444' },
  { id: 9,  name: 'Prism',   bg: 'linear-gradient(135deg, #00F5FF, #FF00FF)', symbol: '◉',   symbolColor: '#FFFFFF', glowColor: '#00F5FF' },
  { id: 10, name: 'Nebula',  bg: 'linear-gradient(135deg, #7700FF, #FF00AA)', symbol: '◈',   symbolColor: '#EED0FF', glowColor: '#7700FF' },
  { id: 11, name: 'Stealth', bg: 'linear-gradient(135deg, #333344, #111122)', symbol: '⬟',   symbolColor: '#6666AA', glowColor: '#4444AA' },
];

export type AvatarGroup = 'crew' | 'bite' | 'gem' | 'pilot';

export type Avatar =
  | { id: string; name: string; group: AvatarGroup; kind: 'img'; src: string }
  | { id: string; name: string; group: AvatarGroup; kind: 'sprite'; src: string; col: number; row: number }
  | { id: string; name: string; group: AvatarGroup; kind: 'gem'; gem: GemConfig }
  | { id: string; name: string; group: AvatarGroup; kind: 'mascot'; mascot: MascotConfig }
  | { id: string; name: string; group: AvatarGroup; kind: 'block'; parts: AvatarParts };

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).replace(/_acc$/, '');

// PNG filenames pre-date the final art; each file is paired with the character it shows.
const CREW: Avatar[] = [
  { id: 'rex',     name: 'Rex',     group: 'crew', kind: 'img', src: '/mascots/mascot-brawler.png' },
  { id: 'tide',    name: 'Tide',    group: 'crew', kind: 'img', src: '/mascots/mascot-sunny.png' },
  { id: 'brawler', name: 'Brawler', group: 'crew', kind: 'img', src: '/mascots/mascot-rex.png' },
  { id: 'sunny',   name: 'Sunny',   group: 'crew', kind: 'img', src: '/mascots/mascot-tide.png' },
  ...BRAND_MASCOTS.filter((m) => m.name === 'Blaze').map<Avatar>((m) => ({
    id: 'blaze', name: 'Blaze', group: 'crew', kind: 'mascot', mascot: m,
  })),
];

const BITES: Avatar[] = generateMascots(100).map((m) => ({
  id: `bite-${m.palKey}-${m.exprKey}-${String(m.id).padStart(3, '0')}`,
  name: `${cap(m.palKey)} ${cap(m.exprKey)} ${m.id}`,
  group: 'bite',
  kind: 'mascot',
  mascot: m,
}));

const GEMS: Avatar[] = GEM_CONFIGS.map((g) => ({
  id: `gem-${g.name.toLowerCase()}`, name: g.name, group: 'gem', kind: 'gem', gem: g,
}));

const PILOT_NAMES = [
  ['cyber-a01', 'Cyber A01'], ['neon-hack', 'Neon Hack'], ['zenith-9', 'Zenith 9'],
  ['void-walk', 'Void Walk'], ['core-mind', 'Core Mind'], ['blade-run', 'Blade Run'],
  ['grid-ops', 'Grid Ops'], ['sky-eye', 'Sky Eye'], ['shadow-bit', 'Shadow Bit'],
] as const;

const PILOTS: Avatar[] = PILOT_NAMES.map(([slug, name], i) => ({
  id: `pilot-${slug}`, name, group: 'pilot', kind: 'sprite',
  src: '/assets/avatars/all.png', col: i % 3, row: Math.floor(i / 3),
}));

export const AVATARS: Avatar[] = [...CREW, ...BITES, ...GEMS, ...PILOTS];

export const DEFAULT_AVATAR_ID = 'rex';

const BY_ID = new Map(AVATARS.map((a) => [a.id, a]));

export function isAvatarId(id: unknown): id is string {
  return typeof id === 'string' && (BY_ID.has(id) || parseCode(id) !== null);
}

/** Look up an avatar. Old numeric values (index into the gem list) still resolve. */
export function getAvatar(id?: string | null): Avatar {
  if (id && BY_ID.has(id)) return BY_ID.get(id)!;
  const parts = parseCode(id);
  if (parts && id) return { id, name: avatarName(parts), group: 'bite', kind: 'block', parts };
  if (id && /^\d+$/.test(id)) {
    const g = GEMS[Number(id)];
    if (g) return g;
  }
  return BY_ID.get(DEFAULT_AVATAR_ID)!;
}

/* ── Current player's choice ─────────────────────────────────────────
 * localStorage 'bb:avatar' keeps the slug so the choice works with no
 * wallet. With a wallet, the server copy (/api/profile/avatar) wins.  */

export const AVATAR_KEY = 'bb:avatar';
export const AVATAR_EVENT = 'bb:avatar';
export const AVATARS_SEEN_KEY = 'bb:avatars_seen';

export function readLocalAvatar(): string {
  try {
    const v = localStorage.getItem(AVATAR_KEY) ?? localStorage.getItem('bb_avatar');
    return getAvatar(v).id;
  } catch {
    return DEFAULT_AVATAR_ID;
  }
}

export function writeLocalAvatar(id: string) {
  try {
    localStorage.setItem(AVATAR_KEY, id);
    // Distinct avatars this browser has worn, for the avatar collection achievements.
    const seen = new Set<string>(JSON.parse(localStorage.getItem(AVATARS_SEEN_KEY) ?? '[]'));
    if (!seen.has(id) && seen.size < 100_000) {
      seen.add(id);
      localStorage.setItem(AVATARS_SEEN_KEY, JSON.stringify([...seen]));
    }
  } catch { /* storage blocked */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: id }));
}

/** Saves locally, then to the server when a wallet is connected. Resolves true if the server accepted it. */
export async function saveAvatar(id: string, wallet?: string | null): Promise<boolean> {
  if (!isAvatarId(id)) return false;
  writeLocalAvatar(id);
  if (!wallet) return false;
  try {
    const r = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet, avatarId: id }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Server copy for a wallet, or null when there is none or the endpoint is unavailable. */
export async function fetchAvatar(wallet: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/profile/avatar?wallet=${encodeURIComponent(wallet)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { avatarId?: unknown };
    return isAvatarId(j.avatarId) ? j.avatarId : null;
  } catch {
    return null;
  }
}
