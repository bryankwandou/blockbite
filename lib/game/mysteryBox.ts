/**
 * Mystery Box System
 *
 * Triggered at every multiple-of-5 level. Player chooses one box from N boxes.
 * Box types:
 *   MULTIPLIER  — apply x2..x10 point multiplier to NEXT placement burst
 *   BOMB        — penalty: score halved + placement count reset   (gets more common later)
 *   BONUS_PTS   — flat +100..+500 points (conservative early, grows later)
 *
 * Probability rules (seeded by level and session pick count):
 *   ─ Early (level ≤ 20):  80% bonus_pts, 15% bomb, 5% multiplier (small, x2 only)
 *   ─ Mid   (level ≤ 500): 50% bonus_pts, 30% bomb, 20% multiplier (x2-x5)
 *   ─ Hard+ (level ≤ 2500):30% bonus_pts, 40% bomb, 30% multiplier (x2-x8)
 *   ─ Nightmare+ :         20% bonus_pts, 45% bomb, 35% multiplier (x2-x10)
 *
 * At 5th consecutive pick (within a session), probabilities shift to higher multipliers
 * and fewer safe bonus_pts — increasing tension and reward ceiling.
 */

export type BoxType = 'MULTIPLIER' | 'BOMB' | 'BONUS_PTS';

export interface MysteryBox {
  id: number;
  type: BoxType;
  /** For MULTIPLIER: the x-factor. For BONUS_PTS: flat point value. For BOMB: 0. */
  value: number;
  /** Display label shown AFTER reveal. */
  label: string;
  /** Emoji icon. */
  icon: string;
}

export interface MysteryBoxEvent {
  level: number;
  boxes: MysteryBox[];
  picksInSession: number;   // how many mystery-box picks the player has done this session
}

export interface BoxResult {
  box: MysteryBox;
  /** Points delta to apply immediately. */
  pointsDelta: number;
  /** Multiplier to apply to next clear burst (1 = no change). */
  nextMultiplier: number;
  /** If true, the engine should halve current score. */
  halvScore: boolean;
  /** Human-readable result message. */
  message: string;
}

// ── Probability tables ─────────────────────────────────────────────

interface BoxPool {
  bombs: number;
  bonusPts: number;
  multiplierMin: number;
  multiplierMax: number;
  multiplierWeight: number;  // weight of multiplier vs bonus_pts slot
}

function getPool(level: number, picksInSession: number): BoxPool {
  const late = picksInSession >= 5;   // 5th pick: shift to higher multipliers
  if (level <= 20) {
    return { bombs: 1, bonusPts: late ? 1 : 2, multiplierMin: 2, multiplierMax: 2,  multiplierWeight: 1 };
  }
  if (level <= 500) {
    return { bombs: 1, bonusPts: late ? 1 : 2, multiplierMin: 2, multiplierMax: 5,  multiplierWeight: late ? 2 : 1 };
  }
  if (level <= 2500) {
    return { bombs: 2, bonusPts: 1,            multiplierMin: 2, multiplierMax: 8,  multiplierWeight: 2 };
  }
  return   { bombs: 2, bonusPts: 1,            multiplierMin: 2, multiplierMax: 10, multiplierWeight: 2 };
}

function bonusPtsValue(level: number): number {
  // Conservative early: 100–300. Grows gently as tiers advance.
  if (level <= 20)   return 100 + Math.floor(Math.random() * 200);    // 100–300
  if (level <= 500)  return 200 + Math.floor(Math.random() * 300);    // 200–500
  if (level <= 2500) return 500 + Math.floor(Math.random() * 500);    // 500–1000
  return               1000 + Math.floor(Math.random() * 2000);        // 1000–3000
}

function randomMultiplier(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Build a shuffled set of boxes for a mystery-box trigger. */
export function generateMysteryBoxes(event: MysteryBoxEvent): MysteryBox[] {
  const { level, boxes: _unusedCount, picksInSession } = event;
  const count = event.boxes.length;  // 3 or 4

  const pool = getPool(level, picksInSession);
  const slots: MysteryBox[] = [];
  let id = 0;

  // Add bombs
  for (let i = 0; i < Math.min(pool.bombs, count - 1); i++) {
    slots.push({ id: id++, type: 'BOMB', value: 0, label: 'BOMB!', icon: 'X' });
  }

  // Add bonus_pts (at least 1 if room allows)
  if (slots.length < count) {
    const bpValue = bonusPtsValue(level);
    slots.push({ id: id++, type: 'BONUS_PTS', value: bpValue, label: `+${bpValue} PTS`, icon: '+' });
  }

  // Fill remaining slots with multiplier or extra bonus_pts
  while (slots.length < count) {
    const useMultiplier = Math.random() < pool.multiplierWeight / (pool.multiplierWeight + 1);
    if (useMultiplier) {
      const mult = randomMultiplier(pool.multiplierMin, pool.multiplierMax);
      slots.push({ id: id++, type: 'MULTIPLIER', value: mult, label: `x${mult} SCORE!`, icon: 'x' });
    } else {
      const bpValue = bonusPtsValue(level);
      slots.push({ id: id++, type: 'BONUS_PTS', value: bpValue, label: `+${bpValue} PTS`, icon: '+' });
    }
  }

  // Shuffle
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  return slots;
}

/** Resolve a chosen box into a concrete result. */
export function resolveMysteryBox(box: MysteryBox, currentScore: number): BoxResult {
  switch (box.type) {
    case 'BOMB':
      return {
        box,
        pointsDelta: -Math.floor(currentScore / 2),
        nextMultiplier: 1,
        halvScore: true,
        message: 'BOOM! Score halved. Stay sharp!',
      };
    case 'BONUS_PTS':
      return {
        box,
        pointsDelta: box.value,
        nextMultiplier: 1,
        halvScore: false,
        message: `Bonus! +${box.value.toLocaleString()} points!`,
      };
    case 'MULTIPLIER':
      return {
        box,
        pointsDelta: 0,
        nextMultiplier: box.value,
        halvScore: false,
        message: `x${box.value} MULTIPLIER on your next clear!`,
      };
  }
}

/** Percentage chance of getting a multiplier (for UI hint display). */
export function getMultiplierChance(level: number, picksInSession: number): number {
  if (level <= 20)   return picksInSession >= 5 ? 15 : 5;
  if (level <= 500)  return picksInSession >= 5 ? 40 : 20;
  if (level <= 2500) return picksInSession >= 5 ? 50 : 30;
  return                picksInSession >= 5 ? 60 : 35;
}
