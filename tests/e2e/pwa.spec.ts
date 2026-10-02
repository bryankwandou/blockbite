import { test, expect } from './fixtures';

test('PWA: manifest is valid with installable icons', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m.name || m.short_name).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(m.display);
  const sizes = (m.icons as { sizes: string; src: string }[]).flatMap((i) => i.sizes.split(' '));
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  expect((await request.get('/sw.js')).status()).toBe(200);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  // iOS "Add to Home Screen" reads these instead of the manifest.
  await expect(page.locator('link[rel="apple-touch-icon"]')).not.toHaveCount(0);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]')).not.toHaveCount(0);
});

// Chrome's own install check: the same one behind "Install app" on Android,
// Windows and macOS. Chromium only; the service worker registers in production builds.
test('PWA: Chrome reports the site as installable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'installability API is Chromium-only');
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.getRegistration()), null, { timeout: 30_000 });
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});
