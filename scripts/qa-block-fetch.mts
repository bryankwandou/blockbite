/**
 * Test-only preload for scripts/qa-api-fuzz.mts: replaces global fetch so nothing
 * can leave the machine (RPC, Supabase, Google...). Load BEFORE pglite-neon-shim,
 * which keeps this function as its "real" fetch for non-database URLs.
 */
const blocked: string[] = ((globalThis as { __blockedFetch?: string[] }).__blockedFetch ??= []);
globalThis.fetch = (async (url: unknown) => {
  blocked.push(String(url));
  throw new TypeError(`fetch blocked by qa harness: ${String(url).slice(0, 80)}`);
}) as typeof fetch;
