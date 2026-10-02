// lib/game/mechanics.ts — 40 mechanic primitives for the 500,000-level system.

import { curve, actNumberOf, themeOfAct } from './difficulty';

export type MechanicCat = 'cell' | 'piece' | 'goal' | 'global';

export interface MechanicDef {
  id: string;
  cat: MechanicCat;
  weight: number;
  label: string;
  icon?: string;
  tier: number;
}

export const MECHANICS: Record<string, MechanicDef> = {
  // CELL MODIFIERS
  locked:    { id: 'locked',    cat: 'cell', weight: 8, label: 'Locked cells', icon: '[X]', tier: 1 },
  ice:       { id: 'ice',       cat: 'cell', weight: 7, label: 'Ice cells',    tier: 2 },
  stone:     { id: 'stone',     cat: 'cell', weight: 6, label: 'Stone cells',  tier: 2 },
  steel:     { id: 'steel',     cat: 'cell', weight: 4, label: 'Steel cells',  tier: 4 },
  fog:       { id: 'fog',       cat: 'cell', weight: 5, label: 'Fog cells',    tier: 3 },
  regrow:    { id: 'regrow',    cat: 'cell', weight: 5, label: 'Regrow cells', tier: 3 },
  mirror:    { id: 'mirror',    cat: 'cell', weight: 4, label: 'Mirror cells', tier: 4 },
  portal:    { id: 'portal',    cat: 'cell', weight: 3, label: 'Portal pairs', tier: 5 },
  void:      { id: 'void',      cat: 'cell', weight: 3, label: 'Void cells',   tier: 6 },
  prism:     { id: 'prism',     cat: 'cell', weight: 4, label: 'Prism cells',  tier: 5 },

  // PIECE MODIFIERS
  bomb_piece:    { id: 'bomb_piece',    cat: 'piece', weight: 6, label: 'Bomb piece',     tier: 2 },
  line_piece:    { id: 'line_piece',    cat: 'piece', weight: 5, label: 'Line piece',     tier: 2 },
  column_piece:  { id: 'column_piece',  cat: 'piece', weight: 5, label: 'Column piece',   tier: 2 },
  rainbow_piece: { id: 'rainbow_piece', cat: 'piece', weight: 4, label: 'Rainbow piece',  tier: 3 },
  timed_piece:   { id: 'timed_piece',   cat: 'piece', weight: 4, label: 'Timed piece',    tier: 4 },
  giant_piece:   { id: 'giant_piece',   cat: 'piece', weight: 3, label: 'Giant piece',    tier: 5 },
  fragile_piece: { id: 'fragile_piece', cat: 'piece', weight: 3, label: 'Fragile piece',  tier: 5 },
  heavy_piece:   { id: 'heavy_piece',   cat: 'piece', weight: 4, label: 'Heavy piece',    tier: 4 },

  // GOAL MODIFIERS
  lines_n:          { id: 'lines_n',          cat: 'goal', weight: 10, label: 'Clear lines',     tier: 1 },
  score_n:          { id: 'score_n',          cat: 'goal', weight: 10, label: 'Reach score',     tier: 1 },
  combo_n:          { id: 'combo_n',          cat: 'goal', weight:  6, label: 'Hit combo',       tier: 3 },
  collect_color:    { id: 'collect_color',    cat: 'goal', weight:  7, label: 'Collect color',   tier: 2 },
  collect_gems:     { id: 'collect_gems',     cat: 'goal', weight:  6, label: 'Collect gems',    tier: 3 },
  boss_pattern:     { id: 'boss_pattern',     cat: 'goal', weight:  2, label: 'Match pattern',   tier: 6 },
  survive_turns:    { id: 'survive_turns',    cat: 'goal', weight:  4, label: 'Survive turns',   tier: 4 },
  chain_n:          { id: 'chain_n',          cat: 'goal', weight:  4, label: 'Chain reaction',  tier: 5 },
  no_clears_under_x:{ id: 'no_clears_under_x',cat: 'goal', weight:  3, label: 'No small clears', tier: 5 },
  multi_goal:       { id: 'multi_goal',       cat: 'goal', weight:  3, label: 'Combined goals',  tier: 6 },

  // GLOBAL MODIFIERS
  gravity_normal:      { id: 'gravity_normal',      cat: 'global', weight: 0, label: 'Normal gravity',       tier: 0 },
  gravity_flip:        { id: 'gravity_flip',        cat: 'global', weight: 4, label: 'Inverted gravity',     tier: 4 },
  gravity_sideways:    { id: 'gravity_sideways',    cat: 'global', weight: 3, label: 'Sideways gravity',     tier: 5 },
  gravity_alternating: { id: 'gravity_alternating', cat: 'global', weight: 2, label: 'Alternating gravity',  tier: 6 },
  time_limit:          { id: 'time_limit',          cat: 'global', weight: 5, label: 'Time limit',           tier: 3 },
  move_limit:          { id: 'move_limit',          cat: 'global', weight: 6, label: 'Move limit',           tier: 2 },
  fog_of_war:          { id: 'fog_of_war',          cat: 'global', weight: 3, label: 'Fog of war',           tier: 5 },
  darkness:            { id: 'darkness',            cat: 'global', weight: 3, label: 'Darkness',             tier: 5 },
  double_speed:        { id: 'double_speed',        cat: 'global', weight: 2, label: 'Double speed',         tier: 4 },
  anti_gravity_zones:  { id: 'anti_gravity_zones',  cat: 'global', weight: 3, label: 'Anti-grav zones',      tier: 5 },
  shrinking_board:     { id: 'shrinking_board',     cat: 'global', weight: 2, label: 'Shrinking board',      tier: 6 },
  multi_board:         { id: 'multi_board',         cat: 'global', weight: 2, label: 'Twin boards',          tier: 6 },
};

export const MECHANIC_IDS = Object.keys(MECHANICS);

export const ACT_POOL: Record<number, string[]> = {
  1: ['lines_n', 'score_n', 'locked', 'move_limit'],
  2: ['lines_n', 'score_n', 'locked', 'move_limit', 'ice', 'stone', 'collect_color', 'heavy_piece'],
  3: ['lines_n', 'score_n', 'locked', 'move_limit', 'ice', 'stone', 'collect_color', 'heavy_piece',
      'bomb_piece', 'line_piece', 'column_piece', 'chain_n', 'time_limit'],
  4: ['lines_n', 'score_n', 'locked', 'move_limit', 'ice', 'stone', 'collect_color', 'heavy_piece',
      'bomb_piece', 'line_piece', 'column_piece', 'chain_n', 'time_limit',
      'timed_piece', 'combo_n', 'gravity_flip', 'double_speed'],
  5: ['lines_n', 'score_n', 'locked', 'move_limit', 'ice', 'stone', 'collect_color', 'heavy_piece',
      'bomb_piece', 'line_piece', 'column_piece', 'chain_n', 'time_limit',
      'timed_piece', 'combo_n', 'gravity_flip', 'double_speed',
      'regrow', 'survive_turns', 'rainbow_piece', 'collect_gems'],
  6: ['lines_n', 'score_n', 'locked', 'move_limit', 'ice', 'stone', 'collect_color', 'heavy_piece',
      'bomb_piece', 'line_piece', 'column_piece', 'chain_n', 'time_limit',
      'timed_piece', 'combo_n', 'gravity_flip', 'double_speed',
      'regrow', 'survive_turns', 'rainbow_piece', 'collect_gems',
      'fog', 'mirror', 'darkness', 'fog_of_war', 'fragile_piece'],
  7: ['lines_n', 'score_n', 'locked', 'move_limit', 'ice', 'stone', 'collect_color', 'heavy_piece',
      'bomb_piece', 'line_piece', 'column_piece', 'chain_n', 'time_limit',
      'timed_piece', 'combo_n', 'gravity_flip', 'double_speed',
      'regrow', 'survive_turns', 'rainbow_piece', 'collect_gems',
      'fog', 'mirror', 'darkness', 'fog_of_war', 'fragile_piece',
      'prism', 'portal', 'no_clears_under_x', 'gravity_sideways', 'steel', 'giant_piece'],
  8: MECHANIC_IDS,
};

export const ACT_PALETTE: Record<number, string[]> = {
  1: ['cyan', 'magenta', 'gold'],
  2: ['ice', 'cyan', 'crystal'],
  3: ['fire', 'gold', 'magenta'],
  4: ['thunder', 'cyan', 'gold'],
  5: ['nature', 'crystal', 'gold'],
  6: ['shadow', 'magenta', 'void'],
  7: ['crystal', 'cyan', 'magenta', 'gold'],
  8: ['fire', 'ice', 'nature', 'thunder', 'shadow', 'crystal', 'void'],
};

export const ACT_NAME: Record<number, string> = {
  1: 'Awakening', 2: 'Frostfall',   3: 'Inferno',     4: 'Stormlands',
  5: 'Verdant',   6: 'Nightfall',   7: 'Crystalline',  8: 'Voidbreak',
};

/** Visual theme (1..8) of level N. Repeats every 8 acts of 500 levels. */
export function actOf(N: number): number {
  return themeOfAct(actNumberOf(N));
}

/** Mechanic pool tier (1..8) — rises with difficulty, never cycles. */
export function poolTierOf(N: number): number {
  return curve(N).mechanicTier;
}

export function mechanicCount(N: number): number {
  return curve(N).mechanicCount;
}

export function density(N: number): number {
  return curve(N).prefill;
}
