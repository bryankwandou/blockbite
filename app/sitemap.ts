import type { MetadataRoute } from 'next';

const BASE = 'https://blockbite.vercel.app';

// Static public pages only. Dynamic (/play/[level], /challenge/[id], /r/[code])
// and private (/admin, /partner, /account, /profile, /settings) routes are left out.
const PAGES: Array<[string, number]> = [
  ['', 1],
  ['/game', 0.9],
  ['/ranked', 0.9],
  ['/leaderboard', 0.8],
  ['/leaderboard/day', 0.6],
  ['/map', 0.7],
  ['/quests', 0.6],
  ['/achievements', 0.5],
  ['/shop', 0.5],
  ['/themes', 0.4],
  ['/mascots', 0.4],
  ['/versus', 0.5],
  ['/how-to-play', 0.7],
  ['/partnership', 0.5],
  ['/waitlist', 0.6],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PAGES.map(([path, priority]) => ({ url: `${BASE}${path}`, lastModified, priority }));
}
