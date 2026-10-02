import { test, expect, mockPhantom } from './fixtures';
import type { Page, Locator } from '@playwright/test';

/** Tap on touch projects, click on desktop. Coordinates in canvas pixel space. */
async function press(page: Page, canvas: Locator, x: number, y: number, touch: boolean) {
  const box = (await canvas.boundingBox())!;
  const { w, h } = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
  const px = box.x + (x * box.width) / w;
  const py = box.y + (y * box.height) / h;
  if (touch) await page.touchscreen.tap(px, py);
  else await page.mouse.click(px, py);
}

async function connectTestWallet(page: Page) {
  // Wallet-gated: open the picker from the game overlay and choose Phantom (our mock).
  const connect = page.locator('main, body').getByRole('button', { name: /connect|wallet/i }).first();
  await connect.click();
  const phantom = page.locator('.wallet-adapter-modal').getByRole('button', { name: /phantom/i }).first();
  await phantom.click({ timeout: 10_000 });
}

test('free game: pick a piece and place it on the board', async ({ page, pageErrors }, info) => {
  const touch = !!info.project.use.hasTouch;
  await mockPhantom(page);
  await page.goto('/game', { waitUntil: 'load' });

  const canvas = page.locator('canvas').first();
  if (!(await canvas.isVisible().catch(() => false))) {
    await connectTestWallet(page).catch((e) => info.annotations.push({ type: 'wallet', description: String(e) }));
  }
  await expect(canvas, 'game canvas should render after wallet connect').toBeVisible({ timeout: 20_000 });
  await canvas.scrollIntoViewIfNeeded();

  // Score is the first HUD value next to the canvas.
  const hudValues = page.locator('canvas').first().locator('xpath=preceding-sibling::div[1]//span[contains(@class,"hudValue")]');
  const scoreBefore = (await hudValues.first().textContent())?.trim();
  const { w, h } = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
  const trayY = h - 130 + 30; // tray band center (TRAY_Y = H - 130)
  const cell = 63, origin = 12;

  let placed = false;
  outer: for (let slot = 0; slot < 3; slot++) {
    for (let r = 0; r < 8 && !placed; r += 2) {
      for (let c = 0; c < 8; c += 2) {
        await press(page, canvas, (w / 3) * slot + w / 6, trayY, touch); // pick
        await press(page, canvas, origin + c * cell + cell / 2, origin + r * cell + cell / 2, touch); // place
        await page.waitForTimeout(150);
        const now = (await hudValues.first().textContent())?.trim();
        if (now !== scoreBefore) { placed = true; break outer; }
      }
    }
  }
  expect(placed, `score should change after placing a piece (was ${scoreBefore})`).toBe(true);
  expect(pageErrors).toEqual([]);
});
