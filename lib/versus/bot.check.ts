/**
 * Bot check: on fixed seeds the bot must clear lines and never make an illegal move.
 *   npx -y tsx lib/versus/bot.check.ts
 */
import { BOT_LEVELS, botRng, chooseMove } from './bot';
import { dealFor, newRun, play, replay, type LogMove } from './deal';

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m); } };

// Same seed → same trays.
ok(JSON.stringify(dealFor('fixedseed1', 7)) === JSON.stringify(dealFor('fixedseed1', 7)), 'deal deterministic');

for (const level of BOT_LEVELS) {
  let moves = 0, lines = 0, games = 0, best = 0;
  const t0 = Date.now();
  for (let g = 0; moves < 500; g++) {
    const seed = `fixedseed${g}`;
    const rng = botRng(seed, level);
    let run = newRun(seed);
    const log: LogMove[] = [];
    games++;
    while (!run.over && moves < 500) {
      const m = chooseMove(seed, run, level, rng);
      if (!m) { ok(false, `${level}: no move on a live run`); break; }
      try {
        const res = play(seed, run, m); // throws RulesError on an illegal move
        lines += res.rows.length + res.cols.length;
        run = res.state;
        log.push([m.slot, m.row, m.col]);
        moves++;
      } catch (e) {
        ok(false, `${level}: illegal move ${JSON.stringify(m)} (${(e as Error).message})`);
        break;
      }
    }
    const r = replay(seed, log);
    ok(r !== null && r.run.score === run.score, `${level}: replay matches`);
    best = Math.max(best, run.score);
  }
  ok(lines > 0, `${level}: cleared lines`);
  console.log(`${level.padEnd(7)} moves=${moves} games=${games} lines=${lines} bestScore=${best} avgMoveMs=${((Date.now() - t0) / moves).toFixed(2)}`);
}
console.log(fail ? `FAIL (${fail})` : 'PASS — 500 legal moves per level, lines cleared, replays match');
process.exit(fail ? 1 : 0);
