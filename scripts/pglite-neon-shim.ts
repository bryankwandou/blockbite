/**
 * Test-only: lets the Neon HTTP driver talk to an in-process PGlite (real
 * Postgres compiled to WASM) so the ranked suites run with no external DB.
 * Import this FIRST (before any lib/* module). It touches no production code
 * path: it only replaces the driver's fetch function, and refuses to run if a
 * real database URL looks like Neon.
 */
import { createServer, request as httpRequest } from 'node:http';
import { neonConfig } from '@neondatabase/serverless';
import { PGlite } from '../qa2pg/node_modules/@electric-sql/pglite/dist/index.js';



// A spawned child (post-results) inherits QA2_PG_PORT and forwards its queries
// to the parent's PGlite over loopback instead of starting an empty one.
const remote = process.env.QA2_PG_PORT;
const db = remote ? (null as unknown as PGlite) : new PGlite();
const realFetchEarly = globalThis.fetch;
const OIDS = [16, 17, 18, 19, 20, 21, 23, 25, 26, 114, 700, 701, 1042, 1043, 1082, 1114, 1184, 1700, 2950, 3802, 1007, 1009, 1016, 1115, 1185];
const parsers: Record<number, (v: string) => string> = {};
for (const o of OIDS) parsers[o] = (v) => v;

async function run(q: { query: string; params?: unknown[] }) {
  const r = await db.query(q.query, (q.params ?? []) as never[], { rowMode: 'array', parsers } as never);
  return {
    command: q.query.trim().split(/\s+/)[0].toUpperCase(),
    rowCount: r.affectedRows ?? r.rows.length,
    rows: r.rows,
    fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowAsArray: true,
  };
}

// Serialise: PGlite is single connection; HTTP calls arrive concurrently.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => (chain = chain.then(fn, fn)) as Promise<T>;

const shimFetch = async (_url: string, init: { body: string; headers: Record<string, string> }) => {
  if (/neon\.tech/i.test(init.headers['Neon-Connection-String'] ?? '')) throw new Error('shim refuses a Neon URL');
  if (remote) {
    // node:http with agent:false (no keep-alive socket): undici's pooled sockets trip a libuv assertion
    // on Windows when the child calls process.exit().
    return new Promise<Response>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: Number(remote), method: 'POST', agent: false }, (res) => {
        let b = ''; res.on('data', (c) => (b += c));
        res.on('end', () => resolve(new Response(b, { status: res.statusCode })));
      });
      req.on('error', reject); req.end(init.body);
    });
  }
  const body = JSON.parse(init.body);
  try {
    const out = await serial(async () => {
      if (body.queries) {
        await db.query('BEGIN');
        try {
          const results = [];
          for (const q of body.queries) results.push(await run(q));
          await db.query('COMMIT');
          return { results };
        } catch (e) { await db.query('ROLLBACK'); throw e; }
      }
      return run(body);
    });
    return new Response(JSON.stringify(out), { status: 200 });
  } catch (e) {
    const err = e as { message: string; code?: string };
    return new Response(JSON.stringify({ message: err.message, code: err.code }), { status: 400 });
  }
};
export { db };

if (!remote) {
  const PORT = 41000 + Math.floor(Math.random() * 20000);
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const r = await shimFetch('', { body: b, headers: {} });
      res.writeHead(r.status); res.end(await r.text());
    });
  }).listen(PORT, '127.0.0.1');
  srv.unref();
  process.env.QA2_PG_PORT = String(PORT);
}
neonConfig.fetchFunction = shimFetch;
// Other copies of the driver (CJS vs ESM) have their own neonConfig; catch them via fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: unknown, init?: { headers?: Record<string, string> }) =>
  init?.headers?.['Neon-Connection-String'] ? shimFetch(String(url), init as never) : realFetch(url as never, init as never)) as typeof fetch;
