/** npx tsx scripts/test-verify-board.ts : the published-leaderboard check of verify-ranked-day.ts. */
import assert from 'node:assert/strict';
import { boardProblems } from '../lib/ranked/verify-board';

const best = (xs: [string, number][]) => new Map(xs);
let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('  ok ', name); };

t('complete board matches', () => assert.deepEqual(boardProblems(best([['a', 9], ['b', 5]]), [{ wallet: 'a', score: 9 }, { wallet: 'b', score: 5 }], 1000), []));
t('wrong score, missing wallet and bad order are reported', () => {
  assert.equal(boardProblems(best([['a', 9], ['b', 5]]), [{ wallet: 'a', score: 8 }, { wallet: 'b', score: 5 }], 1000).length, 1);
  assert.equal(boardProblems(best([['a', 9], ['b', 5]]), [{ wallet: 'a', score: 9 }], 1000).length, 1);
  assert.ok(boardProblems(best([['a', 5], ['b', 9]]), [{ wallet: 'a', score: 5 }, { wallet: 'b', score: 9 }], 1000).some((p) => /not sorted/.test(p)));
});
t('a truncated board (limit reached) is not a false failure', () => {
  const all: [string, number][] = [['a', 9], ['b', 7], ['c', 3], ['d', 1]];
  assert.deepEqual(boardProblems(best(all), [{ wallet: 'a', score: 9 }, { wallet: 'b', score: 7 }], 2), []);
});
t('a truncated board that hides a higher score is caught', () => {
  const all: [string, number][] = [['a', 9], ['b', 7], ['c', 8]];
  assert.equal(boardProblems(best(all), [{ wallet: 'a', score: 9 }, { wallet: 'b', score: 7 }], 2).length, 1);
});
t('below the limit, an unlisted wallet is still a failure', () => {
  assert.equal(boardProblems(best([['a', 9], ['b', 7]]), [{ wallet: 'a', score: 9 }], 1000).length, 1);
});
t('a wallet listed twice is reported', () => {
  assert.ok(boardProblems(best([['a', 9]]), [{ wallet: 'a', score: 9 }, { wallet: 'a', score: 9 }], 1000).some((p) => /twice/.test(p)));
});
console.log(`${n} passed`);
