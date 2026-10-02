/**
 * Independently verifies one finished Ranked day.
 *
 *   npx tsx scripts/verify-ranked-day.ts 2026-10-01 [https://blockbite.vercel.app]
 *
 * 1. sha256(revealed seed) must equal the commitment published before the day.
 * 2. Every run is replayed from its move log with the public rules; its score
 *    must match the published score.
 * 3. The leaderboard (best run per wallet) must match the published one.
 */
import { replayRun } from '../lib/ranked/replay';
import { commitment } from '../lib/ranked/seed';

async function main() {
  const [day, base = 'https://blockbite.vercel.app'] = process.argv.slice(2);
  if (!day) throw new Error('usage: verify-ranked-day.ts YYYY-MM-DD [base-url]');
  const res = await fetch(`${base}/api/ranked/day?d=${day}`);
  const pub = await res.json();
  if (!pub.final) throw new Error(`${day} is not finished yet`);

  let bad = 0;
  if (commitment(pub.seed) !== pub.commitment) {
    console.log('FAIL seed does not match its commitment');
    bad++;
  }
  const best = new Map<string, number>();
  for (const run of pub.runs) {
    let score: number;
    try {
      score = replayRun(pub.seed, run.log).score;
    } catch (e) {
      console.log(`FAIL run ${run.id}: replay rejected a move (${(e as Error).message})`);
      bad++;
      continue;
    }
    if (score !== run.score) {
      console.log(`FAIL run ${run.id}: published ${run.score}, replay ${score}`);
      bad++;
    }
    if (score > 0) best.set(run.wallet, Math.max(best.get(run.wallet) ?? 0, score));
  }
  for (const row of pub.leaderboard) {
    if (best.get(row.wallet) !== row.score) {
      console.log(`FAIL leaderboard ${row.wallet}: published ${row.score}, replay ${best.get(row.wallet)}`);
      bad++;
    }
  }
  if (best.size !== pub.leaderboard.length) {
    console.log(`FAIL leaderboard has ${pub.leaderboard.length} wallets, replay has ${best.size}`);
    bad++;
  }
  const flagged = pub.runs.filter((r: { flags: number }) => r.flags > 0).length;
  console.log(`${day}: ${pub.runs.length} runs, ${best.size} wallets, ${flagged} runs flagged for speed review`);
  console.log(bad === 0 ? 'OK — every score and the leaderboard verify' : `${bad} problem(s) found`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
