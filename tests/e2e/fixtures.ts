import { test as base, expect, type Page } from '@playwright/test';

/** Collects uncaught page errors; applies CPU throttle on projects that ask for it. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(errors);
  },
  page: async ({ page, browserName }, use, testInfo) => {
    const rate = (testInfo.project.metadata as { cpuThrottle?: number })?.cpuThrottle;
    if (rate && browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    }
    await use(page);
  },
});
export { expect };

/** Horizontal overflow in CSS px (0 = none). Allows 1px rounding. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(0, Math.max(d.scrollWidth, document.body?.scrollWidth ?? 0) - d.clientWidth - 1);
  });
}

/**
 * Minimal Phantom provider so the wallet-gated game renders without a real
 * extension. Never signs anything; publicKey is a fixed throwaway.
 */
export async function mockPhantom(page: Page) {
  await page.addInitScript(() => {
    const bytes = new Uint8Array(32).fill(7);
    const pk = {
      toBytes: () => bytes,
      toBuffer: () => bytes,
      toString: () => 'TestPubkey1111111111111111111111111111111111',
      toBase58: () => 'TestPubkey1111111111111111111111111111111111',
    };
    const listeners: Record<string, Function[]> = {};
    const provider: any = {
      isPhantom: true,
      isConnected: false,
      publicKey: null,
      connect: async () => { provider.isConnected = true; provider.publicKey = pk; (listeners.connect || []).forEach((f) => f(pk)); return { publicKey: pk }; },
      disconnect: async () => { provider.isConnected = false; },
      on: (ev: string, f: Function) => { (listeners[ev] ||= []).push(f); },
      off: () => {}, removeListener: () => {},
      signMessage: async () => { throw new Error('test wallet: signing disabled'); },
      signTransaction: async () => { throw new Error('test wallet: signing disabled'); },
      signAllTransactions: async () => { throw new Error('test wallet: signing disabled'); },
    };
    (window as any).phantom = { solana: provider };
    (window as any).solana = provider;
  });
}
