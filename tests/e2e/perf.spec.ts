import { test } from './fixtures';

// Budget is reported, never enforced (warn, not fail).
const FCP_BUDGET_MS = 2500;
const LONG_TASK_BUDGET_MS = 600; // total blocking time-ish: sum(longtask - 50ms)

test('perf budget /game (low-end only, warn)', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'android-lowend' || browserName !== 'chromium', 'low-end project only');
  await page.addInitScript(() => {
    (window as any).__lt = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window as any).__lt.push(e.duration)))
        .observe({ type: 'longtask', buffered: true });
    } catch { /* unsupported */ }
  });
  await page.goto('/game', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1;
    const lt: number[] = (window as any).__lt || [];
    return { fcp: Math.round(fcp), longTasks: lt.length, tbt: Math.round(lt.reduce((a, d) => a + Math.max(0, d - 50), 0)), worst: Math.round(Math.max(0, ...lt)) };
  });
  const line = `FCP=${r.fcp}ms (budget ${FCP_BUDGET_MS}) longTasks=${r.longTasks} TBT~${r.tbt}ms (budget ${LONG_TASK_BUDGET_MS}) worst=${r.worst}ms [CPU 4x]`;
  console.log(`[perf] ${line}`);
  info.annotations.push({ type: r.fcp > FCP_BUDGET_MS || r.tbt > LONG_TASK_BUDGET_MS ? 'warning' : 'perf', description: line });
});
