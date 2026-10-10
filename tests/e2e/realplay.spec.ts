import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';

/**
 * Real play: a greedy bot plays through the real UI (canvas taps/clicks, DOM
 * buttons), not through the engine. It reads the board from the read-only
 * snapshot GameCanvas exposes when localStorage 'bb:e2e' is '1'.
 */

type Snap = {
  free: boolean[][];
  tray: (number[][] | null)[];
  score: number; level: number; placements: number;
  isGameOver: boolean; pendingMysteryBox: boolean;
  geometry: { originX: number; originY: number; cell: number; trayY: number; canvasW: number };
};

const snap = (page: Page) => page.evaluate(() => (window as unknown as { __bbGame?: Snap }).__bbGame ?? null);

/** Best move by: lines cleared, then cells touching filled cells or walls (keeps the board tidy). */
function bestMove(s: Snap): { slot: number; row: number; col: number } | null {
  let best: { slot: number; row: number; col: number; v: number } | null = null;
  s.tray.forEach((shape, slot) => {
    if (!shape) return;
    const h = shape.length, w = shape[0].length;
    for (let r = 0; r + h <= 8; r++) for (let c = 0; c + w <= 8; c++) {
      let ok = true;
      const occ = s.free.map((row) => row.map((f) => !f));
      for (let i = 0; i < h && ok; i++) for (let j = 0; j < w; j++) {
        if (!shape[i][j]) continue;
        if (!s.free[r + i][c + j]) { ok = false; break; }
        occ[r + i][c + j] = true;
      }
      if (!ok) continue;
      let lines = 0;
      for (let i = 0; i < 8; i++) {
        if (occ[i].every(Boolean)) lines++;
        if (occ.every((row) => row[i])) lines++;
      }
      let touch = 0;
      for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
        if (!shape[i][j]) continue;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + i + dr, cc = c + j + dc;
          if (rr < 0 || rr > 7 || cc < 0 || cc > 7 || (!s.free[rr][cc])) touch++;
        }
      }
      const v = lines * 100 + touch;
      if (!best || v > best.v) best = { slot, row: r, col: c, v };
    }
  });
  return best;
}

async function tapCanvas(page: Page, canvas: Locator, x: number, y: number, touch: boolean) {
  const box = (await canvas.boundingBox())!;
  const { w, h } = await canvas.evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
  const px = box.x + (x * box.width) / w, py = box.y + (y * box.height) / h;
  if (touch) await page.touchscreen.tap(px, py); else await page.mouse.click(px, py);
}

test('real play: free Adventure bot clears levels through the canvas', async ({ page, pageErrors }, info) => {
  test.setTimeout(info.project.name === 'macos-webkit' ? 600_000 : 300_000);
  const touch = !!info.project.use.hasTouch;
  await page.addInitScript(() => { try { localStorage.setItem('bb:e2e', '1'); } catch { /* blocked */ } });
  await page.goto('/play/1', { waitUntil: 'load' });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(() => snap(page), { timeout: 20_000 }).not.toBeNull();

  const start = (await snap(page))!;
  let moves = 0, stuck = 0;
  while (moves < 120) {
    const s = (await snap(page))!;
    if (s.isGameOver) break;
    if (s.pendingMysteryBox) {
      await page.locator('[role="dialog"] button').first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
      continue;
    }
    if (s.level >= start.level + 3) break;
    const m = bestMove(s);
    if (!m) break;
    const g = s.geometry;
    await tapCanvas(page, canvas, (g.canvasW / 3) * m.slot + g.canvasW / 6, g.trayY + 45, touch);
    await tapCanvas(page, canvas, g.originX + m.col * g.cell + g.cell / 2, g.originY + m.row * g.cell + g.cell / 2, touch);
    const before = s.placements;
    const moved = await expect.poll(async () => (await snap(page))!.placements, { timeout: 3_000 }).toBeGreaterThan(before).then(() => true, () => false);
    if (moved) { moves++; stuck = 0; } else if (++stuck > 3) break;
  }
  const end = (await snap(page))!;
  info.annotations.push({ type: 'realplay', description: `moves=${moves} score ${start.score}->${end.score} level ${start.level}->${end.level} over=${end.isGameOver}` });
  expect(moves, 'the bot should be able to play through the UI').toBeGreaterThan(10);
  expect(end.score).toBeGreaterThan(start.score);
  expect(end.level, 'level 1 goal should be reachable by a greedy player').toBeGreaterThan(start.level);
  expect(pageErrors).toEqual([]);
});

test('real play: a full 1 vs Bot match ends with a result', async ({ page, pageErrors }, info) => {
  test.setTimeout(info.project.name === 'macos-webkit' ? 600_000 : 300_000);
  await page.goto('/versus', { waitUntil: 'load' });
  await page.getByRole('radio').nth(1).click(); // Pro
  await page.locator('main button').filter({ hasText: /./ }).last().scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /start|mulai/i }).first().click();
  const grid = page.getByRole('grid').first();
  await expect(grid).toBeVisible({ timeout: 20_000 });

  // Each turn: try every piece on every empty cell until one fits (the board
  // ignores taps that do not fit). Clicks run in the page for speed but go
  // through the real React handlers.
  let moves = 0;
  for (let turn = 0; turn < 200; turn++) {
    const r = await page.evaluate(async () => {
      const tick = () => new Promise((res) => setTimeout(res, 0));
      const grid = document.querySelector('[role="grid"]');
      if (!grid || !grid.parentElement) return 'over'; // match finished: the live board is gone
      const cells = [...grid.querySelectorAll('button')] as HTMLButtonElement[];
      const tray = [...(grid.parentElement!.querySelectorAll('button[aria-pressed]'))] as HTMLButtonElement[];
      if (!cells.length || !tray.length) return 'over';
      const filled = () => grid.querySelectorAll('[class*="filled"]').length;
      const slots = () => grid.parentElement?.querySelectorAll('button[aria-pressed]').length ?? 0;
      for (let si = 0; si < tray.length; si++) {
        if (!grid.isConnected) return 'over';
        const slot = (grid.parentElement?.querySelectorAll('button[aria-pressed]')[si] ?? tray[si]) as HTMLButtonElement;
        for (const cell of cells) {
          if (!grid.isConnected) return 'over';
          if (cell.className.includes('filled')) continue;
          const f0 = filled(), s0 = slots();
          if (slot.getAttribute('aria-pressed') !== 'true') { slot.click(); await tick(); }
          cell.click();
          await tick();
          if (filled() !== f0 || slots() !== s0) return 'moved';
        }
      }
      return 'stuck';
    });
    if (r === 'moved') { moves++; await page.waitForTimeout(60); continue; }
    break;
  }
  await expect(page.locator('[aria-live="polite"] h2')).toBeVisible({ timeout: 200_000 });
  expect(moves).toBeGreaterThan(5);
  expect(pageErrors).toEqual([]);
});

test('real play: game over offers Play again, which starts a fresh board', async ({ page, pageErrors }, info) => {
  test.setTimeout(info.project.name === 'macos-webkit' ? 600_000 : 300_000);
  const touch = !!info.project.use.hasTouch;
  await page.addInitScript(() => { try { localStorage.setItem('bb:e2e', '1'); } catch { /* blocked */ } });
  await page.goto('/play/1', { waitUntil: 'load' });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  await expect.poll(() => snap(page), { timeout: 20_000 }).not.toBeNull();

  // Play badly on purpose (first legal spot, no line logic) until the board locks up.
  for (let i = 0; i < 400; i++) {
    const s = (await snap(page))!;
    if (s.isGameOver) break;
    if (s.pendingMysteryBox) {
      await page.locator('[role="dialog"] button').first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    // Play to lose: never complete a line, and scatter pieces (fewest
    // neighbours) so the board locks up in a few dozen moves.
    let m: { slot: number; row: number; col: number } | null = null;
    let bestV = Infinity;
    s.tray.forEach((shape, slot) => {
      if (!shape) return;
      for (let r = 0; r + shape.length <= 8; r++) for (let c = 0; c + shape[0].length <= 8; c++) {
        if (!shape.every((row, a) => row.every((v, b) => !v || s.free[r + a][c + b]))) continue;
        const occ = s.free.map((row) => row.map((f) => !f));
        shape.forEach((row, a) => row.forEach((v, b) => { if (v) occ[r + a][c + b] = true; }));
        let lines = 0;
        for (let i = 0; i < 8; i++) { if (occ[i].every(Boolean)) lines++; if (occ.every((x) => x[i])) lines++; }
        let touch = 0;
        shape.forEach((row, a) => row.forEach((v, b) => {
          if (!v) return;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = r + a + dr, cc = c + b + dc;
            if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && !s.free[rr][cc]) touch++;
          }
        }));
        const v = lines * 1000 + touch;
        if (v < bestV) { bestV = v; m = { slot, row: r, col: c }; }
      }
    });
    if (!m) break;
    const g = s.geometry, mm = m as { slot: number; row: number; col: number };
    await tapCanvas(page, canvas, (g.canvasW / 3) * mm.slot + g.canvasW / 6, g.trayY + 45, touch);
    await tapCanvas(page, canvas, g.originX + mm.col * g.cell + g.cell / 2, g.originY + mm.row * g.cell + g.cell / 2, touch);
    await expect.poll(async () => (await snap(page))!.placements, { timeout: 3_000 }).toBeGreaterThan(s.placements).catch(() => {});
  }
  await expect.poll(async () => (await snap(page))!.isGameOver, { timeout: 10_000 }).toBe(true);
  await page.getByRole('button').filter({ hasText: /play again|main lagi|again/i }).first().click();
  await expect.poll(async () => { const s = (await snap(page))!; return !s.isGameOver && s.placements === 0; }, { timeout: 10_000 }).toBe(true);
  expect(pageErrors).toEqual([]);
});
