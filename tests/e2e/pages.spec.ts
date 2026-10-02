import { test, expect, horizontalOverflow } from './fixtures';

// Pages that exist today: hard assertions.
const CORE = ['/', '/game', '/map', '/play/1', '/ranked', '/shop', '/leaderboard', '/how-to-play', '/profile', '/settings'];
// Pages other agents may still be building: a 404 skips instead of failing.
const SOFT = ['/achievements', '/account', '/themes', '/versus', '/challenge/test-id', '/admin', '/partner'];

import { existsSync } from 'fs';
import { join } from 'path';
/** Route dir under app/ for a path; dynamic segments map to [param] dirs. */
function routeExists(path: string): boolean {
  const app = join(__dirname, '..', '..', 'app');
  if (path === '/') return true;
  const segs = path.split('/').filter(Boolean);
  if (segs[0] === 'challenge') return existsSync(join(app, 'challenge'));
  return existsSync(join(app, ...segs)) || existsSync(join(app, segs[0]));
}

for (const path of [...CORE, ...SOFT]) {
  const soft = SOFT.includes(path);
  // Pages another agent hasn't created yet: fixme (reported, not failed).
  if (soft && !routeExists(path)) {
    test.fixme(`page ${path} loads clean (not built yet: no app${path.replace(/\/test-id$/, '/[id]')} route)`, async () => {});
    continue;
  }
  test(`page ${path} loads clean${soft ? ' (soft)' : ''}`, async ({ page, pageErrors }) => {
    const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
    const status = res?.status() ?? 0;
    if (soft && status === 404) test.skip(true, `${path} not built yet (404)`);
    expect(status, `HTTP status for ${path}`).toBeLessThan(400);
    await page.waitForLoadState('load');
    await page.waitForTimeout(800); // let hydration + client effects run
    await expect(page.locator('body')).toBeVisible();
    expect(pageErrors, `uncaught page errors on ${path}`).toEqual([]);
    expect(await horizontalOverflow(page), `horizontal overflow (px) on ${path}`).toBe(0);
  });
}

test('RTL: lang=ar sets dir=rtl without overflow', async ({ page, pageErrors }) => {
  await page.goto('/?lang=ar', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  expect(pageErrors).toEqual([]);
  expect(await horizontalOverflow(page)).toBe(0);
});

// The green hero button must keep its idle bob + sheen unless the player chose
// Low graphics or reduced motion. A misjudged auto-graphics probe used to turn it off.
test('hero: the green Play button is animating', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('bb:gfx', 'high'); } catch { /* blocked */ } });
  await page.goto('/', { waitUntil: 'load' });
  const btn = page.locator('a[href="/game"][class*="btnPrimary"]').first();
  await expect(btn).toBeVisible();
  await page.waitForTimeout(4000); // past the auto-graphics probe
  const running = await btn.evaluate((el) => [
    ...el.getAnimations(),
    ...el.getAnimations({ subtree: true }),
  ].filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName));
  expect(running.some((n) => n.includes('hbCtaBob'))).toBe(true);
  expect(running.some((n) => n.includes('hbCtaSheen'))).toBe(true);
});
