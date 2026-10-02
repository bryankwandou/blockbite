// Run: npx tsx lib/game/modes.check.ts
// Asserts the three modes differ in rules and match the ranked server config.
import { MODES, type ModeId } from './modes';
import { MAX_ATTEMPTS_PER_DAY, MONTHLY_BEST_DAYS } from '../ranked/config';

const fails: string[] = [];
const ids = Object.keys(MODES) as ModeId[];
const rule = (id: ModeId) => {
  const m = MODES[id];
  return JSON.stringify({ timer: m.timer, hints: m.hints, undo: m.undo, seed: m.seed, attempts: m.attempts, sum: m.sumBestDays });
};

for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  if (rule(ids[i]) === rule(ids[j])) fails.push(`${ids[i]} and ${ids[j]} have identical rules`);
  if (MODES[ids[i]].theme.accent === MODES[ids[j]].theme.accent) fails.push(`${ids[i]} and ${ids[j]} share a theme colour`);
}

const { free, daily, monthly } = MODES;
if (free.timer || !free.hints || free.prizeText || free.seed !== 'level' || free.goal !== 'level') fails.push('free: expected no timer, hints on, no prize text, per-level seed, level goal');
if (!daily.timer || daily.hints || daily.undo || daily.seed !== 'utc-day') fails.push('daily: expected timer, no hints, no undo, UTC-day seed');
if (daily.attempts !== MAX_ATTEMPTS_PER_DAY) fails.push(`daily attempts ${daily.attempts} != server ${MAX_ATTEMPTS_PER_DAY}`);
if (monthly.sumBestDays !== MONTHLY_BEST_DAYS) fails.push(`monthly best days ${monthly.sumBestDays} != server ${MONTHLY_BEST_DAYS}`);
if (monthly.plays !== 'daily') fails.push('monthly must play the daily board');
if (free.hints === daily.hints) fails.push('free and daily must differ on hints');
if (free.timer === daily.timer) fails.push('free and daily must differ on timer');
if (free.seed === daily.seed) fails.push('free and daily must differ on seed');

for (const id of ids) console.log(`${id.padEnd(8)} ${MODES[id].theme.accent} ${rule(id)}`);
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS');
