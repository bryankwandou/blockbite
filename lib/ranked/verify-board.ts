/**
 * Checks a published day leaderboard against the best scores replayed from
 * the published runs (scripts/verify-ranked-day.ts). Pure.
 *
 * /api/ranked/day publishes at most `limit` wallets on the board but every
 * run, so a day with `limit` or more scored wallets has a truncated board:
 * then the board must be the top `limit` of the replay (any unlisted wallet
 * scores no more than the last listed one), not the whole set.
 */
export function boardProblems(
  best: Map<string, number>,
  board: { wallet: string; score: number }[],
  limit: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  board.forEach((row, i) => {
    if (seen.has(row.wallet)) out.push(`leaderboard lists ${row.wallet} twice`);
    seen.add(row.wallet);
    if (best.get(row.wallet) !== row.score) out.push(`leaderboard ${row.wallet}: published ${row.score}, replay ${best.get(row.wallet)}`);
    if (i > 0 && row.score > board[i - 1].score) out.push(`leaderboard is not sorted at row ${i}`);
  });
  if (board.length < limit) {
    if (best.size !== board.length) out.push(`leaderboard has ${board.length} wallets, replay has ${best.size}`);
  } else {
    if (best.size < board.length) out.push(`leaderboard has ${board.length} wallets, replay has only ${best.size}`);
    const floor = board[board.length - 1].score;
    for (const [wallet, score] of best) {
      if (!seen.has(wallet) && score > floor) out.push(`${wallet} scored ${score}, above the last listed ${floor}, but is not on the truncated leaderboard`);
    }
  }
  return out;
}
