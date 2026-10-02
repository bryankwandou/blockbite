/**
 * Challenge API round trip against a running server (default http://localhost:3100).
 *   npx -y tsx lib/versus/api.check.ts [base]
 */
import { botRng, chooseMove } from './bot';
import { newRun, play, type LogMove } from './deal';

const base = process.argv[2] ?? 'http://localhost:3100';
function runLog(seed: string, level: 'rookie' | 'legend', cap: number): { log: LogMove[]; score: number } {
  const rng = botRng(seed, level);
  let run = newRun(seed);
  const log: LogMove[] = [];
  while (!run.over && log.length < cap) {
    const m = chooseMove(seed, run, level, rng)!;
    run = play(seed, run, m).state;
    log.push([m.slot, m.row, m.col]);
  }
  return { log, score: run.score };
}

(async () => {
const seed = 'apicheck' + Date.now().toString(36);
const a = runLog(seed, 'legend', 60);
const post = await fetch(`${base}/api/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed, name: 'Alice', log: a.log }) });
const pj = await post.json();
console.log('create', post.status, pj, 'expected score', a.score);
const b = runLog(seed, 'rookie', 60);
const rep = await fetch(`${base}/api/challenge/${pj.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bob', log: b.log }) });
console.log('reply', rep.status, await rep.json(), 'expected score', b.score);
const bad = await fetch(`${base}/api/challenge/${pj.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Eve', log: [[0, 7, 7], [0, 7, 7]] }) });
console.log('illegal log', bad.status, await bad.json());
const g = await (await fetch(`${base}/api/challenge/${pj.id}`)).json();
console.log('get', g.found, g.challenge?.name, g.challenge?.score, g.challenge?.replies.map((r: { name: string; score: number }) => `${r.name}:${r.score}`));
console.log('missing', await (await fetch(`${base}/api/challenge/test`)).json());
})();
