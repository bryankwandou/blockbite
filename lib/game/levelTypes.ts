// lib/game/levelTypes.ts — shared types for the 4,000-level system.
// Kept separate to avoid circular imports between levelGenerator ↔ milestones.

export interface LevelBoard {
  size: number;
  grid: (string | null)[][];
  cellMods: Record<string, string>;
}

export interface TrayPiece {
  shape: number[][];
  color: string;
  mods: string[];
}

export interface LevelGoal {
  type: string;
  target?: number;
  color?: string;
  minSize?: number;
  combine?: string;
}

export interface LevelConstraints {
  maxMoves?: number;
  timeLimitSec?: number;
  surviveTurns?: number;
  shrinkEvery?: number;
  silhouetteOnly?: boolean;
  visibleRadius?: number;
}

export interface LevelConfig {
  id: number;
  act: number;
  actName: string;
  seed: number;
  retry: number;
  name: string;
  mechanics: string[];
  board: LevelBoard;
  tray: TrayPiece[];
  goals: LevelGoal[];
  constraints: LevelConstraints;
  palette: string[];
  isBoss: boolean;
  isMilestone: boolean;
  helpText?: string;
}
