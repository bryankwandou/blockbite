/**
 * BlockBite music albums. Every track is original and built in code on the
 * BlockBite motif ("Block · Block · Bi-te!": a repeated note, a leap up, a step down).
 * Track names are proper nouns, not translated.
 */

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
export const DORIAN = [0, 2, 3, 5, 7, 9, 10];
export const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
export const PENTA = [0, 2, 4, 7, 9, 12, 14]; // major pentatonic stretched to 7 slots

const _ = null;
export type Bar = (number | null)[]; // 16 sixteenth steps, scale degrees

// The BlockBite motif and its answers.
export const MOTIF_A: Bar = [0, _, 0, _, 4, _, 2, _, 3, _, 2, _, 1, _, _, _];
export const MOTIF_B: Bar = [0, _, 0, _, 4, _, 6, _, 7, _, _, _, 4, _, _, _];
export const MOTIF_C: Bar = [5, _, 4, _, 2, _, 4, _, 3, _, 2, _, 0, _, 1, _];
export const MOTIF_D: Bar = [2, _, 1, _, 0, _, -1, _, 0, _, _, _, _, _, _, _];
const REST: Bar = Array(16).fill(null);

/* motif transforms */
export const halfTime = (b: Bar): Bar => b.map((v, i) => (i % 4 === 0 ? b[i / 2] ?? null : null)) as Bar;
export const eighths = (b: Bar): Bar => b.map((v, i) => (v === null && i % 2 === 1 && b[i - 1] !== null ? b[i - 1] : v));
const shift = (b: Bar, n: number): Bar => b.map((v) => (v === null ? null : v + n));
const invert = (b: Bar): Bar => b.map((v) => (v === null ? null : -v + 4));
const sync = (b: Bar): Bar => b.map((v, i) => (i === 0 ? null : b[i - 1] ?? null)); // push everything a 16th late
const hook = (b: Bar): Bar => [...b.slice(0, 8), ...b.slice(0, 8)]; // repeat the "Block-Block-Bite" half

export type Track = {
  name: string;
  bpm: number;
  root: number;          // midi of the tonic for the lead
  scale: number[];
  prog: number[];        // one chord root (scale degree) per bar
  lead: Bar[];           // one bar each, cycles
  leadWave: OscillatorType;
  leadVol: number;
  bassWave: OscillatorType;
  bassPattern: Bar;      // 0 = chord root, 4 = fifth, 7 = octave
  pad?: OscillatorType;
  kick: string;          // 'x' hits over 16 steps
  snare: string;
  hat: string;
  toms?: boolean;
  arp?: boolean;
  bars?: number;         // length before the playlist moves on (default 32)
};

export type Album = {
  id: string;
  name: string;
  mascot: string;        // image under /public/mascots
  mood: 'classic' | 'royal' | 'calm' | 'tense' | 'bright';
  tracks: Record<string, Track>;
};

const FOUR = 'x...x...x...x...';
const BACK = '....x.......x...';
const OFF = '..x...x...x...x.';

export const ALBUMS: Album[] = [
  {
    id: 'classic', name: 'BlockBite Originals', mascot: '/logo.png', mood: 'classic',
    tracks: {
      menu: {
        name: 'Block Block Bite', bpm: 116, root: 72, scale: MAJOR, prog: [0, 4, 5, 3],
        lead: [MOTIF_A, MOTIF_B, MOTIF_C, MOTIF_D],
        leadWave: 'square', leadVol: 0.11, bassWave: 'triangle',
        bassPattern: [0, _, _, 0, _, _, 4, _, 0, _, _, 0, _, _, 7, _],
        kick: FOUR, snare: BACK, hat: OFF, arp: true,
      },
      adventure: {
        name: 'Open Board', bpm: 92, root: 72, scale: MAJOR, prog: [0, 3, 5, 4],
        lead: [halfTime(MOTIF_A), MOTIF_D, halfTime(MOTIF_B), REST],
        leadWave: 'triangle', leadVol: 0.13, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, 4, _, _, _, _, _, 7, _, _, _],
        pad: 'sine', kick: 'x.......x.......', snare: '................', hat: '....x.......x...', arp: true,
      },
      ranked: {
        name: 'Daily Clock', bpm: 148, root: 69, scale: MINOR, prog: [0, 5, 3, 4],
        lead: [eighths(MOTIF_A), MOTIF_B, eighths(MOTIF_A), MOTIF_D],
        leadWave: 'square', leadVol: 0.09, bassWave: 'sawtooth',
        bassPattern: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 4, _, 7, _],
        kick: FOUR, snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx',
      },
      monthly: {
        name: 'Month Crown', bpm: 124, root: 74, scale: HARMONIC, prog: [0, 5, 3, 4],
        lead: [MOTIF_A, MOTIF_B, MOTIF_C, [7, _, _, _, 6, _, _, _, 4, _, _, _, 4, _, _, _]],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, _, 0, 0, _, _, 0, 0, _, _, 0, 4, _, 7, _],
        pad: 'sawtooth', kick: 'x..x..x.x..x..x.', snare: BACK, hat: OFF, toms: true,
      },
      lobby: {
        name: 'Lobby Lights', bpm: 108, root: 71, scale: LYDIAN, prog: [0, 1, 4, 0],
        lead: [sync(MOTIF_A), MOTIF_C, hook(MOTIF_B), halfTime(MOTIF_D)],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'sine',
        bassPattern: [0, _, _, _, 0, _, _, _, 4, _, _, _, 7, _, _, _],
        pad: 'triangle', kick: 'x.......x.......', snare: BACK, hat: OFF, arp: true,
      },
      stackup: {
        name: 'Stack It Up', bpm: 134, root: 67, scale: DORIAN, prog: [0, 3, 6, 4],
        lead: [eighths(MOTIF_A), shift(MOTIF_B, 2), eighths(invert(MOTIF_A)), MOTIF_D],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, 0, _, _, 0, _, _, 4, _, 4, _, _, 4, _, 7],
        kick: 'x..x..x...x...x.', snare: BACK, hat: 'x.xxx.xxx.xxx.xx', toms: true,
      },
      lineclear: {
        name: 'Line Clear Jingle', bpm: 142, root: 76, scale: PENTA, prog: [0, 4, 5, 3],
        lead: [hook(MOTIF_A), shift(MOTIF_B, -2), hook(shift(MOTIF_A, 2)), [7, _, 7, _, 9, _, 7, _, 4, _, _, _, 0, _, _, _]],
        leadWave: 'square', leadVol: 0.1, bassWave: 'triangle',
        bassPattern: [0, _, _, 0, _, _, 0, _, 4, _, _, 4, _, _, 7, _],
        kick: FOUR, snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', arp: true,
      },
      lastbite: {
        name: 'Last Bite Lullaby', bpm: 72, root: 69, scale: MINOR, prog: [0, 5, 3, 0],
        lead: [halfTime(MOTIF_A), REST, halfTime(MOTIF_D), REST],
        leadWave: 'sine', leadVol: 0.15, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, _, _, _, _, _, _, 4, _, _, _],
        pad: 'sine', kick: '................', snare: '................', hat: '................', arp: true,
      },
    },
  },
  {
    id: 'rex', name: "Rex's Royal Court", mascot: '/mascots/mascot-brawler.png', mood: 'royal',
    tracks: {
      throne: {
        name: 'Throne of Blocks', bpm: 104, root: 74, scale: HARMONIC, prog: [0, 3, 4, 0],
        lead: [halfTime(MOTIF_A), MOTIF_B, MOTIF_C, halfTime(MOTIF_D)],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, _, _, 0, _, _, _, 4, _, _, _, 7, _, _, _],
        pad: 'sawtooth', kick: 'x.......x.......', snare: BACK, hat: '................', toms: true,
      },
      crown: {
        name: 'Crown Parade', bpm: 120, root: 72, scale: MAJOR, prog: [0, 4, 3, 4],
        lead: [MOTIF_A, hook(MOTIF_B), shift(MOTIF_A, 2), MOTIF_D],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'triangle',
        bassPattern: [0, _, 0, _, 4, _, 4, _, 0, _, 0, _, 7, _, 4, _],
        pad: 'square', kick: FOUR, snare: '....x.......xx..', hat: OFF, toms: true,
      },
      banner: {
        name: 'Banner Hall', bpm: 96, root: 70, scale: DORIAN, prog: [0, 6, 5, 4],
        lead: [halfTime(MOTIF_C), halfTime(MOTIF_A), MOTIF_D, REST],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, _, _, 4, _, _, _, _, _, _, _],
        pad: 'sawtooth', kick: 'x.........x.....', snare: '................', hat: '........x.......',
      },
      decree: {
        name: 'Royal Decree', bpm: 132, root: 74, scale: HARMONIC, prog: [0, 5, 6, 4],
        lead: [eighths(MOTIF_A), MOTIF_B, eighths(shift(MOTIF_A, 3)), [7, _, 6, _, 4, _, 4, _, 7, _, _, _, 7, _, _, _]],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, _, 0, 0, _, _, 0, 0, _, _, 0, 4, _, 7, _],
        pad: 'sawtooth', kick: 'x..x..x.x..x..x.', snare: BACK, hat: OFF, toms: true,
      },
      coronation: {
        name: 'Coronation Bite', bpm: 112, root: 72, scale: MAJOR, prog: [3, 4, 0, 0],
        lead: [MOTIF_C, MOTIF_B, MOTIF_A, [7, _, _, _, _, _, _, _, 7, _, 4, _, 7, _, _, _]],
        leadWave: 'square', leadVol: 0.09, bassWave: 'triangle',
        bassPattern: [0, _, _, 0, _, _, 4, _, 0, _, _, 0, _, _, 7, _],
        pad: 'sawtooth', kick: FOUR, snare: BACK, hat: OFF, toms: true, arp: true,
      },
      guard: {
        name: 'Guard of Honor', bpm: 100, root: 70, scale: MINOR, prog: [0, 6, 5, 6],
        lead: [halfTime(MOTIF_B), halfTime(MOTIF_A), halfTime(MOTIF_C), MOTIF_D],
        leadWave: 'square', leadVol: 0.09, bassWave: 'sawtooth',
        bassPattern: [0, _, _, _, 0, _, _, _, 0, _, _, _, 4, _, 7, _],
        pad: 'square', kick: 'x.......x...x...', snare: BACK, hat: '................', toms: true,
      },
      feast: {
        name: 'Feast of Cubes', bpm: 126, root: 72, scale: DORIAN, prog: [0, 3, 0, 4],
        lead: [sync(MOTIF_A), hook(MOTIF_C), sync(shift(MOTIF_A, 2)), MOTIF_B],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'square',
        bassPattern: [0, _, 0, _, _, _, 4, _, 0, _, 0, _, _, _, 7, _],
        pad: 'sawtooth', kick: 'x..x....x..x....', snare: '....x.......x...', hat: OFF, arp: true,
      },
      jester: {
        name: 'Jester Gambit', bpm: 138, root: 75, scale: HARMONIC, prog: [0, 1, 0, 4],
        lead: [eighths(invert(MOTIF_A)), sync(MOTIF_B), eighths(MOTIF_C), shift(MOTIF_D, 3)],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'triangle',
        bassPattern: [0, _, 0, 0, _, _, 0, _, 0, _, 0, 0, _, _, 7, _],
        kick: OFF, snare: BACK, hat: 'x.xxx.xxx.xxx.xx', toms: true,
      },
    },
  },
  {
    id: 'tide', name: 'Tide Pool Tapes', mascot: '/mascots/mascot-sunny.png', mood: 'calm',
    tracks: {
      shallows: {
        name: 'Shallows', bpm: 84, root: 69, scale: PENTA, prog: [0, 3, 4, 3],
        lead: [halfTime(MOTIF_A), REST, halfTime(MOTIF_C), REST],
        leadWave: 'sine', leadVol: 0.16, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, _, _, 4, _, _, _, _, _, _, _],
        pad: 'sine', kick: 'x...............', snare: '................', hat: '........x.......', arp: true,
      },
      driftwood: {
        name: 'Driftwood', bpm: 90, root: 67, scale: MAJOR, prog: [0, 5, 3, 4],
        lead: [halfTime(MOTIF_B), MOTIF_D, halfTime(invert(MOTIF_A)), REST],
        leadWave: 'triangle', leadVol: 0.13, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, 4, _, _, _, _, _, 7, _, _, _],
        pad: 'sine', kick: 'x.......x.......', snare: '................', hat: '....x.......x...', arp: true,
      },
      lowtide: {
        name: 'Low Tide Glow', bpm: 78, root: 72, scale: LYDIAN, prog: [0, 1, 0, 4],
        lead: [halfTime(MOTIF_A), halfTime(MOTIF_D), REST, halfTime(shift(MOTIF_A, 2))],
        leadWave: 'sine', leadVol: 0.15, bassWave: 'triangle',
        bassPattern: [0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
        pad: 'triangle', kick: '................', snare: '................', hat: '................', arp: true,
      },
      seaglass: {
        name: 'Sea Glass', bpm: 96, root: 74, scale: PENTA, prog: [0, 4, 3, 0],
        lead: [sync(MOTIF_A), MOTIF_C, sync(MOTIF_B), MOTIF_D],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'sine',
        bassPattern: [0, _, _, 0, _, _, 4, _, _, _, _, _, 7, _, _, _],
        pad: 'sine', kick: 'x.......x.......', snare: '............x...', hat: OFF,
      },
      kelp: {
        name: 'Kelp Forest', bpm: 88, root: 66, scale: DORIAN, prog: [0, 3, 6, 3],
        lead: [halfTime(MOTIF_C), halfTime(sync(MOTIF_A)), REST, halfTime(MOTIF_D)],
        leadWave: 'triangle', leadVol: 0.13, bassWave: 'triangle',
        bassPattern: [0, _, _, _, _, _, 4, _, 0, _, _, _, _, _, 7, _],
        pad: 'sine', kick: 'x.......x.......', snare: '................', hat: '..x...x...x...x.', arp: true,
      },
      moonpool: {
        name: 'Moon Pool', bpm: 70, root: 71, scale: MINOR, prog: [0, 5, 6, 4],
        lead: [halfTime(invert(MOTIF_A)), REST, halfTime(MOTIF_B), REST],
        leadWave: 'sine', leadVol: 0.15, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
        pad: 'triangle', kick: '................', snare: '................', hat: '................', arp: true,
      },
      coral: {
        name: 'Coral Bloom', bpm: 104, root: 73, scale: MAJOR, prog: [0, 2, 3, 4],
        lead: [MOTIF_A, sync(MOTIF_C), shift(MOTIF_A, 2), halfTime(MOTIF_D)],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'sine',
        bassPattern: [0, _, _, 0, _, _, 4, _, 0, _, _, 0, _, _, 7, _],
        pad: 'sine', kick: 'x.......x.......', snare: '....x...........', hat: OFF, arp: true,
      },
      undertow: {
        name: 'Undertow Hush', bpm: 92, root: 68, scale: HARMONIC, prog: [0, 3, 5, 4],
        lead: [sync(halfTime(MOTIF_B)), halfTime(shift(MOTIF_A, 2)), REST, halfTime(MOTIF_C)],
        leadWave: 'triangle', leadVol: 0.13, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, 0, _, 4, _, _, _, _, _, 7, _],
        pad: 'sine', kick: 'x.........x.....', snare: '................', hat: '....x.......x...', arp: true,
      },
    },
  },
  {
    id: 'brawler', name: 'Brawler Arena Mix', mascot: '/mascots/mascot-rex.png', mood: 'tense',
    tracks: {
      bell: {
        name: 'First Bell', bpm: 150, root: 69, scale: MINOR, prog: [0, 5, 3, 4],
        lead: [eighths(MOTIF_A), hook(MOTIF_A), eighths(MOTIF_B), MOTIF_D],
        leadWave: 'square', leadVol: 0.09, bassWave: 'sawtooth',
        bassPattern: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 4, _, 7, _],
        kick: FOUR, snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx',
      },
      knockout: {
        name: 'Knockout Line', bpm: 160, root: 67, scale: HARMONIC, prog: [0, 0, 5, 4],
        lead: [MOTIF_A, sync(MOTIF_A), MOTIF_B, shift(MOTIF_D, 2)],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, 0, _, 0, 0, _, 0, _, 0, 0, _, 0, 4, _, 7, _],
        kick: 'x..x..x.x..x..x.', snare: BACK, hat: 'x.xxx.xxx.xxx.xx', toms: true,
      },
      clinch: {
        name: 'Clinch', bpm: 140, root: 70, scale: DORIAN, prog: [0, 3, 0, 4],
        lead: [eighths(MOTIF_C), MOTIF_A, eighths(MOTIF_C), REST],
        leadWave: 'square', leadVol: 0.09, bassWave: 'sawtooth',
        bassPattern: [0, _, _, 0, _, _, 0, _, 4, _, _, 4, _, _, 7, _],
        kick: FOUR, snare: '....x..x....x...', hat: 'x.x.x.x.x.x.x.x.',
      },
      countdown: {
        name: 'Countdown Combo', bpm: 168, root: 69, scale: MINOR, prog: [0, 6, 5, 4],
        lead: [hook(eighths(MOTIF_A)), MOTIF_B, hook(eighths(shift(MOTIF_A, -2))), MOTIF_D],
        leadWave: 'square', leadVol: 0.085, bassWave: 'sawtooth',
        bassPattern: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 7, _],
        kick: FOUR, snare: '....x.......x.xx', hat: 'xxxxxxxxxxxxxxxx', toms: true,
      },
      rematch: {
        name: 'Rematch', bpm: 144, root: 72, scale: HARMONIC, prog: [0, 5, 4, 0],
        lead: [MOTIF_B, eighths(MOTIF_A), invert(MOTIF_A), MOTIF_D],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, 0, _, 4, _, 0, _, 0, _, 0, _, 7, _, 4, _],
        pad: 'sawtooth', kick: 'x..x..x.x..x..x.', snare: BACK, hat: 'x.xxx.xxx.xxx.xx',
      },
      weighin: {
        name: 'Weigh-In', bpm: 126, root: 66, scale: MINOR, prog: [0, 0, 3, 4],
        lead: [halfTime(MOTIF_B), MOTIF_A, halfTime(MOTIF_A), shift(MOTIF_D, 2)],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, _, 0, _, _, 0, _, _, 0, _, _, 4, _, 7, _],
        pad: 'sawtooth', kick: 'x..x..x.x..x..x.', snare: BACK, hat: '................', toms: true,
      },
      cornerman: {
        name: 'Cornerman', bpm: 154, root: 71, scale: DORIAN, prog: [0, 6, 3, 4],
        lead: [sync(eighths(MOTIF_A)), hook(MOTIF_C), invert(MOTIF_B), MOTIF_D],
        leadWave: 'square', leadVol: 0.085, bassWave: 'sawtooth',
        bassPattern: [0, 0, _, 0, _, 0, _, 0, 0, 0, _, 0, _, 4, _, 7],
        kick: FOUR, snare: '....x..x....x.x.', hat: 'x.x.x.x.x.x.x.xx',
      },
      ironjaw: {
        name: 'Iron Jaw', bpm: 172, root: 64, scale: HARMONIC, prog: [0, 5, 0, 4],
        lead: [hook(eighths(MOTIF_B)), eighths(shift(MOTIF_A, -3)), hook(sync(MOTIF_A)), MOTIF_D],
        leadWave: 'sawtooth', leadVol: 0.07, bassWave: 'square',
        bassPattern: [0, _, 0, 0, _, 0, 0, _, 0, _, 0, 0, 4, _, 7, 7],
        kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x.xx', hat: 'xxxxxxxxxxxxxxxx', toms: true,
      },
    },
  },
  {
    id: 'sunny', name: 'Sunny Side Up', mascot: '/mascots/mascot-tide.png', mood: 'bright',
    tracks: {
      breakfast: {
        name: 'Breakfast Blocks', bpm: 122, root: 72, scale: MAJOR, prog: [0, 5, 3, 4],
        lead: [MOTIF_A, MOTIF_B, MOTIF_C, MOTIF_D],
        leadWave: 'square', leadVol: 0.1, bassWave: 'triangle',
        bassPattern: [0, _, 0, _, 4, _, _, _, 0, _, 0, _, 7, _, _, _],
        kick: FOUR, snare: BACK, hat: 'x.x.x.x.x.x.x.x.', arp: true,
      },
      popcube: {
        name: 'Pop Cube', bpm: 128, root: 74, scale: MAJOR, prog: [0, 4, 5, 3],
        lead: [sync(MOTIF_A), hook(MOTIF_B), sync(MOTIF_C), MOTIF_D],
        leadWave: 'square', leadVol: 0.1, bassWave: 'square',
        bassPattern: [0, _, _, 0, _, _, 0, _, 4, _, _, 4, _, _, 7, _],
        kick: FOUR, snare: '....x.......x...', hat: OFF, arp: true,
      },
      daydream: {
        name: 'Daydream Grid', bpm: 108, root: 71, scale: LYDIAN, prog: [0, 1, 4, 0],
        lead: [halfTime(MOTIF_A), MOTIF_C, halfTime(MOTIF_B), REST],
        leadWave: 'triangle', leadVol: 0.13, bassWave: 'triangle',
        bassPattern: [0, _, _, _, 4, _, _, _, 0, _, _, _, 7, _, _, _],
        pad: 'triangle', kick: 'x.......x.......', snare: '....x.......x...', hat: OFF, arp: true,
      },
      highscore: {
        name: 'High Score Sun', bpm: 136, root: 72, scale: MAJOR, prog: [3, 4, 0, 5],
        lead: [eighths(MOTIF_A), MOTIF_B, eighths(shift(MOTIF_A, 4)), [7, _, 7, _, 4, _, 7, _, 9, _, _, _, 7, _, _, _]],
        leadWave: 'square', leadVol: 0.1, bassWave: 'triangle',
        bassPattern: [0, _, 0, _, 0, _, 0, _, 4, _, 4, _, 7, _, 7, _],
        kick: FOUR, snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx', arp: true,
      },
      goldenhour: {
        name: 'Golden Hour', bpm: 100, root: 69, scale: PENTA, prog: [0, 4, 3, 4],
        lead: [MOTIF_A, REST, invert(MOTIF_C), MOTIF_D],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'sine',
        bassPattern: [0, _, _, _, _, _, 4, _, _, _, _, _, 7, _, _, _],
        pad: 'sine', kick: 'x.......x.......', snare: '............x...', hat: OFF, arp: true,
      },
      pancake: {
        name: 'Pancake Stack', bpm: 116, root: 70, scale: DORIAN, prog: [0, 3, 0, 4],
        lead: [MOTIF_A, sync(MOTIF_B), shift(invert(MOTIF_A), 3), halfTime(MOTIF_C)],
        leadWave: 'triangle', leadVol: 0.12, bassWave: 'triangle',
        bassPattern: [0, _, 0, _, _, 0, _, _, 4, _, 4, _, _, 4, _, 7],
        pad: 'triangle', kick: 'x..x....x...x...', snare: BACK, hat: 'x.x.x.x.x.x.x.x.',
      },
      lemonade: {
        name: 'Lemonade Lane', bpm: 132, root: 76, scale: PENTA, prog: [0, 3, 4, 5],
        lead: [hook(MOTIF_A), eighths(MOTIF_C), hook(sync(MOTIF_B)), MOTIF_D],
        leadWave: 'square', leadVol: 0.1, bassWave: 'square',
        bassPattern: [0, _, _, 0, _, 0, _, _, 4, _, _, 4, _, 4, _, 7],
        kick: FOUR, snare: '....x.......x...', hat: OFF, arp: true,
      },
      kiteday: {
        name: 'Kite Day', bpm: 112, root: 73, scale: LYDIAN, prog: [0, 4, 1, 3],
        lead: [shift(MOTIF_A, 2), sync(MOTIF_C), halfTime(MOTIF_B), MOTIF_D],
        leadWave: 'sine', leadVol: 0.14, bassWave: 'sine',
        bassPattern: [0, _, _, _, 4, _, _, _, 0, _, _, _, 7, _, 4, _],
        pad: 'sine', kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', arp: true,
      },
    },
  },
];

export const ALBUM_BY_ID: Record<string, Album> = Object.fromEntries(ALBUMS.map((a) => [a.id, a]));

/** Global key "album/track" → track. */
export function getTrackDef(key: string): Track | null {
  const [a, t] = key.split('/');
  return ALBUM_BY_ID[a]?.tracks[t] ?? null;
}

export function albumTrackKeys(albumId: string): string[] {
  const a = ALBUM_BY_ID[albumId];
  return a ? Object.keys(a.tracks).map((t) => `${albumId}/${t}`) : [];
}
