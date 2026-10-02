import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * Cross-platform E2E matrix. Emulation covers viewport, DPR, touch, UA and the
 * real browser engine (Blink / WebKit / Gecko). See docs/TESTING.md for what
 * still needs a physical device.
 *
 * Env:
 *   BASE_URL            target (default http://localhost:3100). When set, no server is started.
 *   PW_EDGE=1           add the msedge channel project (Windows CI / machines with Edge).
 *   BROWSERSTACK_WS     a CDP/Playwright wss endpoint (BrowserStack / LambdaTest) â€” when set,
 *                       a "real-device" project connects to it instead of a local browser.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const startServer = !process.env.BASE_URL && !!process.env.CI;

const projects: Project[] = [
  // ---- Android ----
  { name: 'android-pixel7', use: { ...devices['Pixel 7'] } },
  {
    name: 'android-lowend',
    use: {
      ...devices['Galaxy S8'],
      viewport: { width: 360, height: 740 },
      // CPU throttle is applied per-test via CDP (see tests/fixtures.ts).
    },
    metadata: { cpuThrottle: 4 },
  },
  // ---- iOS / iPadOS (WebKit = Safari engine) ----
  { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
  { name: 'iphone-se', use: { ...devices['iPhone SE'] } },
  { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
  // ---- Desktop ----
  { name: 'windows-chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'macos-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
];

if (process.env.PW_EDGE) {
  projects.push({ name: 'windows-edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } });
}

if (process.env.BROWSERSTACK_WS) {
  // Paid real-device hook. BROWSERSTACK_WS is the full wss:// URL with caps encoded
  // (see docs/TESTING.md). Only chromium-protocol devices connect this way.
  projects.push({
    name: 'real-device',
    use: { connectOptions: { wsEndpoint: process.env.BROWSERSTACK_WS } },
  });
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 120_000,
  },
  projects,
  webServer: startServer
    ? { command: 'npm run start -- -p 3100', url: 'http://localhost:3100', timeout: 180_000, reuseExistingServer: true }
    : undefined,
});
