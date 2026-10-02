/**
 * Copies the OFF-CHAIN profile from an old wallet to a new one (server only).
 * Moves: display name, avatar, adventure level and progress counters, quest
 * completions, achievement unlocks (unlock time becomes the move time). Never moves tickets, claimed totals, referrals or anything
 * on-chain; those stay with the original wallet.
 */

import { getUser, setUser } from '@/lib/store';
import { getAvatar, setAvatar } from '@/lib/ranked/db';
import { listCompletionsForWallet, submitCompletion } from '@/lib/quests/store';
import { addUnlocks, unlocksOf } from '@/lib/achievements/db';

export async function copyProfile(from: string, to: string): Promise<string[]> {
  const moved: string[] = [];
  try {
    const u = await getUser(from);
    await setUser(to, {
      displayName: u.displayName, avatarId: u.avatarId, currentLevel: u.currentLevel,
      actsDone: u.actsDone, streak: u.streak, language: u.language, theme: u.theme,
    });
    moved.push('profile');
  } catch { /* KV unavailable */ }
  try {
    const avatar = await getAvatar(from);
    if (avatar) {
      await setAvatar(to, avatar);
      moved.push('avatar');
    }
  } catch { /* ranked tables unavailable */ }
  try {
    const done = await listCompletionsForWallet(from);
    for (const c of done) await submitCompletion({ ...c, wallet: to });
    if (done.length) moved.push('quests');
  } catch { /* KV unavailable */ }
  try {
    const ids = (await unlocksOf(from)).map((u) => u.id);
    if ((await addUnlocks(to, ids)).length || ids.length) moved.push('achievements');
  } catch { /* achievements table unavailable */ }
  return moved;
}
