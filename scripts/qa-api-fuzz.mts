/**
 * QA lane 10b: drives every app/api route handler in-process against PGlite.
 *
 *   npx tsx --import ./scripts/qa-block-fetch.mts --import ./scripts/pglite-neon-shim.ts scripts/qa-api-fuzz.mts
 *
 * No network (fetch is replaced), no real database (dummy URL + PGlite shim).
 * Writes scratchpad-style JSON rows to QA_OUT (default qa-api-fuzz-results.json).
 */
import { createHmac, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import bs58 from 'bs58';

const SECRET = randomBytes(32).toString('hex');
const admin = mkWallet();
Object.assign(process.env, {
  blockbite_DATABASE_URL: 'postgresql://u:p@localhost.test/db',
  RANKED_SECRET: SECRET,
  ADMIN_WALLETS: admin.addr,
  ADMIN_TOKEN: 'admin-token-0123456789abcdef',
  ADMIN_SECRET: 'admin-secret-0123456789abcdef',
  CRON_SECRET: 'cron-secret-0123456789abcdef',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  NODE_ENV: 'production',
});
for (const k of Object.keys(process.env)) if (/^KV_|UPSTASH|^SUPABASE|^GOOGLE_|^DATABASE_URL$|^RANKED_DATABASE_URL$/.test(k)) delete process.env[k];

function mkWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { addr: bs58.encode(raw), sign: (m: string) => bs58.encode(edSign(null, Buffer.from(m), privateKey)) };
}
type Wallet = ReturnType<typeof mkWallet>;

const { challenge: rChallenge, signIn: rSignIn } = await import('@/lib/ranked/auth');
const adminSession = await import('@/lib/admin/session');
const core = await import('@/lib/auth/core');
const acctHttp = await import('@/lib/auth/http');
const rules = await import('@/lib/ranked/rules');
const rdb = await import('@/lib/ranked/db');
const rev = await import('@/lib/ranked/revocation');

// ── result log ──────────────────────────────────────────────────────
type Expect = number | number[] | '2xx' | '4xx' | 'lt500';
interface Row { route: string; method: string; name: string; expected: string; actual: string; pass: boolean; note?: string }
const rows: Row[] = [];
const LEAK = /node_modules|\.tsx?:\d+|\bat (async )?[\w.<>]+ \(|ECONNREFUSED|PGlite|pg_|syntax error at|relation ".*" does not exist|SELECT .* FROM|stack/i;
const mods = new Map<string, Record<string, (req: Request, ctx?: unknown) => Promise<Response>>>();
let ipn = 0;
const ip = () => `10.${(ipn >> 16) & 255}.${(ipn >> 8) & 255}.${++ipn & 255}`;

interface Opts { headers?: Record<string, string>; body?: unknown; raw?: string; bearer?: string; cookie?: string; ip?: string; query?: string }
function R(method: string, path: string, o: Opts = {}): Request {
  const headers: Record<string, string> = { 'x-real-ip': o.ip ?? ip(), ...(o.headers ?? {}) };
  if (o.bearer !== undefined) headers.authorization = o.bearer;
  if (o.cookie) headers.cookie = o.cookie;
  let body: string | undefined;
  if (o.raw !== undefined) body = o.raw;
  else if (o.body !== undefined) body = JSON.stringify(o.body);
  if (body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  const { NextRequest } = requireNext;
  return new NextRequest(`https://blockbite.test${path}${o.query ?? ''}`, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
}
const requireNext = await import('next/server');

function matches(e: Expect, s: number): boolean {
  if (typeof e === 'number') return s === e;
  if (Array.isArray(e)) return e.includes(s);
  if (e === '2xx') return s >= 200 && s < 300;
  if (e === '4xx') return s >= 400 && s < 500;
  return s < 500;
}

let FUZZ_PARAMS: Record<string, string> | undefined;
async function t(route: string, method: string, name: string, mk: () => Request | Promise<Request>, expect: Expect, params?: Record<string, string>): Promise<{ status: number; text: string; json: any; res?: Response }> {
  let status = -1, text = '', note: string | undefined, res: Response | undefined;
  try {
    let m = mods.get(route);
    if (!m) { m = (await import(`@/app/api/${route}/route`)) as never; mods.set(route, m!); }
    const h = m![method];
    if (!h) { status = 405; text = '(no handler exported: Next answers 405)'; }
    else {
      res = await h(await mk(), { params: Promise.resolve(params ?? FUZZ_PARAMS ?? {}) });
      status = res.status;
      text = await res.clone().text().catch(() => '');
    }
  } catch (e) {
    const em = String((e as Error)?.message ?? e);
    if (/invalid header value|ByteString/i.test(em)) { // the client refuses to send it: it never reaches a server
      rows.push({ route, method, name, expected: 'unsendable', actual: 'Headers rejected it', pass: true, note: em.slice(0, 80) });
      return { status: 0, text: '', json: null };
    }
    status = 599; text = String((e as Error)?.stack ?? e).slice(0, 500); note = 'handler THREW: ' + text.replace(/\s+/g, ' ').slice(0, 300);
  }
  let pass = matches(expect, status);
  if (!pass && (status === 502 || status === 503) && /could not reach Solana|not configured on this server/.test(text) && matches('lt500', 499) && expect !== 502) { pass = true; note = 'upstream (RPC) blocked by harness, answered a clean 502/503'; }
  if (LEAK.test(text) && status !== 599 && !text.startsWith('(no handler')) { note = `body looks like an internal leak: ${text.slice(0, 120)}`; pass = false; }
  if (status >= 500 && !matches(expect, status)) note ??= text.slice(0, 160);
  rows.push({ route, method, name, expected: String(Array.isArray(expect) ? expect.join('|') : expect), actual: String(status), pass, note });
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status, text, json, res };
}

// ── auth helpers ────────────────────────────────────────────────────
const sessionMac = (data: string) => createHmac('sha256', createHmac('sha256', SECRET).update('blockbite:ranked:session').digest()).update(data).digest('base64url');
const SESSION_TTL = 12 * 3600_000;
function session(w: Wallet): string {
  const m = rChallenge(w.addr);
  return rSignIn(w.addr, m, w.sign(m))!;
}
function craft(w: string, exp: number, sid = randomBytes(12).toString('base64url')) {
  return `${w}.${exp}.${sid}.${sessionMac(`${w}.${exp}.${sid}`)}`;
}
const consoleMac = (label: string, data: string) => createHmac('sha256', createHmac('sha256', SECRET).update(`blockbite:console:${label}`).digest()).update(data).digest('base64url');
function consoleCookie(role: 'admin' | 'partner', w: string, expMs: number, macOverride?: string) {
  const name = adminSession.COOKIE[role];
  return `${name}=${encodeURIComponent(`${w}.${expMs}.${macOverride ?? consoleMac(`session:${role}`, `${w}.${expMs}`)}`)}`;
}
function cookieOf(res: Response | undefined, name: string): string {
  for (const c of res?.headers.getSetCookie() ?? []) if (c.startsWith(`${name}=`)) return c.split(';')[0];
  return '';
}
async function consoleLogin(role: 'admin' | 'partner', w: Wallet): Promise<string> {
  const route = `${role}/auth`;
  const a = await t(route, 'POST', 'setup: challenge', () => R('POST', `/api/${route}`, { body: { wallet: w.addr } }), 200);
  const b = await t(route, 'POST', 'setup: sign in', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: a.json.message, signature: w.sign(a.json.message) } }), 200);
  return cookieOf(b.res, adminSession.COOKIE[role]);
}
const acctWalletCookie = (w: string, e = Date.now() + 60_000, label = 'wallet') => `${acctHttp.COOKIE.wallet}=${encodeURIComponent(core.seal(label, { w, e }))}`;
const acctRecoverCookie = (w: string, p = 'password', e = Date.now() + 60_000) => `${acctHttp.COOKIE.recover}=${encodeURIComponent(core.seal('recover', { w, p, s: 'x@y.zz', m: 'x@y.zz', e }))}`;

// ── mutation engine ─────────────────────────────────────────────────
type Kind = 'string' | 'number' | 'boolean' | 'object' | 'any';
const WRONG: Record<Kind, [string, unknown][]> = {
  string: [['null', null], ['number', 7], ['bool', true], ['array', ['a']], ['object', { a: 1 }]],
  number: [['null', null], ['string', 'x'], ['numeric string', '5'], ['bool', true], ['array', [1]], ['object', { a: 1 }]],
  boolean: [['null', null], ['string', 'true'], ['number', 1], ['array', []], ['object', {}]],
  object: [['null', null], ['string', 'x'], ['number', 1], ['array', []]],
  any: [],
};
const EDGE: Record<Kind, [string, unknown][]> = {
  string: [['empty', ''], ['70KB string', 'A'.repeat(70_000)], ['unicode/control/lone surrogate', '\u{1D54F}‮\u0000\ud800é'], ['whitespace only', '   ']],
  number: [['negative', -1], ['-0', -0], ['1e308', 1e308], ['2^53+1', 9007199254740993], ['float', 1.5], ['zero', 0]],
  boolean: [],
  object: [['empty obj', {}], ['deep nest', JSON.parse('{"a":'.repeat(50) + '1' + '}'.repeat(50))]],
  any: [['70KB string', 'A'.repeat(70_000)], ['huge number', 1e308]],
};

interface FuzzSpec {
  route: string; method?: string; path?: string; params?: Record<string, string>;
  valid: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  fields: Record<string, Kind>;
  required: string[];
  send: (b: Opts) => Request;
  okStatus?: number[];
}
/** Valid body, each field missing / wrong type (4xx expected when required) / edge value (no 5xx), plus whole-body junk. */
async function fuzz(s: FuzzSpec) {
  FUZZ_PARAMS = s.params;
  try { await fuzz2(s); } finally { FUZZ_PARAMS = undefined; }
}
async function fuzz2(s: FuzzSpec) {
  const m = s.method ?? 'POST';
  const send = (o: Opts) => s.send(o);
  const jsonOf = (b: unknown) => ({ body: b });
  for (const [k, kind] of Object.entries(s.fields)) {
    const req = s.required.includes(k);
    await t(s.route, m, `field ${k} missing`, async () => { const b = { ...(await s.valid()) }; delete b[k]; return send(jsonOf(b)); }, req ? '4xx' : 'lt500');
    for (const [label, v] of WRONG[kind]) {
      await t(s.route, m, `field ${k} = ${label}`, async () => send(jsonOf({ ...(await s.valid()), [k]: v })), req ? '4xx' : 'lt500');
    }
    for (const [label, v] of EDGE[kind]) {
      await t(s.route, m, `field ${k} = ${label}`, async () => send(jsonOf({ ...(await s.valid()), [k]: v })), 'lt500');
    }
  }
  const whole: [string, Opts, Expect][] = [
    ['body: empty', { raw: '' }, '4xx'],
    ['body: invalid JSON', { raw: '{"a":' }, '4xx'],
    ['body: JSON null', { raw: 'null' }, '4xx'],
    ['body: JSON array', { raw: '[]' }, '4xx'],
    ['body: JSON string', { raw: '"x"' }, '4xx'],
    ['body: JSON number', { raw: '123' }, '4xx'],
    ['body: {} ', { raw: '{}' }, '4xx'],
    ['body: 300KB JSON object', { raw: JSON.stringify({ pad: 'A'.repeat(300_000) }) }, '4xx'],
    ['body: lone surrogate escape', { raw: '{"x":"\\ud800"}' }, '4xx'],
    ['body: __proto__ key', { raw: '{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}' }, '4xx'],
  ];
  for (const [n, o, e] of whole) await t(s.route, m, n, () => send(o), e);
  await t(s.route, m, 'valid body + __proto__ key', async () => send({ raw: JSON.stringify({ ...(await s.valid()), __proto__x: 1 }).replace('"__proto__x"', '"__proto__"') }), 'lt500');
  await t(s.route, m, 'valid body as text/plain (cross-site form shape)', async () => send({ raw: JSON.stringify(await s.valid()), headers: { 'content-type': 'text/plain' } }), 'lt500');
}

/** Standard bearer-session negative cases against one authed route. */
async function bearerMatrix(route: string, method: string, mk: (bearer: string | undefined, extra?: Opts) => Request, params?: Record<string, string>) {
  const w = mkWallet(), other = mkWallet();
  const good = session(w);
  const [wa, exp, sid, mac] = good.split('.');
  const rows401: [string, string | undefined][] = [
    ['no Authorization header', undefined],
    ['empty "Bearer "', 'Bearer '],
    ['"Bearer garbage"', 'Bearer garbage'],
    ['Basic scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['lowercase bearer scheme', `bearer ${good}`],
    ['5000-char token', `Bearer ${'A'.repeat(5000)}`],
    ['v1 forged (wallet.exp.mac)', `Bearer ${wa}.${Date.now() + 3600_000}.${'A'.repeat(43)}`],
    ['v2 forged (right shape, wrong mac)', `Bearer ${wa}.${exp}.${sid}.${'A'.repeat(43)}`],
    ['v2 expiry extended, mac kept', `Bearer ${wa}.${Number(exp) + 3600_000}.${sid}.${mac}`],
    ['v2 sid swapped, mac kept', `Bearer ${wa}.${exp}.${randomBytes(12).toString('base64url')}.${mac}`],
    ['v2 wallet swapped to another wallet, mac kept', `Bearer ${other.addr}.${exp}.${sid}.${mac}`],
    ['v2 validly MACed but expired 1s ago', `Bearer ${craft(w.addr, Date.now() - 1000)}`],
    ['v2 validly MACed, exp = 0', `Bearer ${craft(w.addr, 0)}`],
    ['v2 validly MACed, exp not a number', `Bearer ${wa}.NaN.${sid}.${sessionMac(`${wa}.NaN.${sid}`)}`],
    ['v2 validly MACed, 5 parts', `Bearer ${good}.x`],
    ['v2 validly MACed, wallet not on 32 bytes', `Bearer ${craft('1111', Date.now() + 1e6)}`],
    ['token with NUL byte', `Bearer ${good}\u0000`],
  ];
  for (const [n, v] of rows401) await t(route, method, `auth: ${n}`, () => mk(v), 401, params);
  // revoked
  const rv = mkWallet(); const rvTok = session(rv); const p = rvTok.split('.');
  await rev.revokeSession(p[2], Number(p[1]));
  await t(route, method, 'auth: revoked sid (after logout)', () => mk(`Bearer ${rvTok}`), 401, params);
  const la = mkWallet(); const laTok = session(la);
  await new Promise((r) => setTimeout(r, 5));
  await rev.revokeAll(la.addr);
  await t(route, method, 'auth: issued before logout-all', () => mk(`Bearer ${laTok}`), 401, params);
}

// ── fixtures ────────────────────────────────────────────────────────
const P = mkWallet(), P2 = mkWallet();
const tokP = session(P), tokP2 = session(P2);
const bearer = (t: string) => `Bearer ${t}`;
const B58_SIG = '5'.repeat(88);
const D = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// ═══════════ ranked/* ═══════════
console.log('ranked ...');
// auth
{
  const route = 'ranked/auth';
  const w = mkWallet();
  const c1 = await t(route, 'POST', 'valid step 1: wallet -> message', () => R('POST', '/api/ranked/auth', { body: { wallet: w.addr } }), 200);
  const msg = c1.json?.message as string;
  const sig = w.sign(msg);
  await t(route, 'POST', 'valid step 2 -> token', () => R('POST', '/api/ranked/auth', { body: { wallet: w.addr, message: msg, signature: sig } }), 200);
  await t(route, 'POST', 'REPLAY of a used message+signature', () => R('POST', '/api/ranked/auth', { body: { wallet: w.addr, message: msg, signature: sig } }), 401);
  await t(route, 'POST', 'replay again (2nd)', () => R('POST', '/api/ranked/auth', { body: { wallet: w.addr, message: msg, signature: sig } }), 401);
  const now = Date.now();
  const mk = (issued: number, signer = w, wallet = w.addr) => { const m = rChallenge(wallet, issued); return { wallet, message: m, signature: signer.sign(m) }; };
  await t(route, 'POST', 'challenge issued 11 min ago (validly signed)', () => R('POST', '/api/ranked/auth', { body: mk(now - 11 * 60_000) }), 401);
  await t(route, 'POST', 'challenge issued 2 min in the future', () => R('POST', '/api/ranked/auth', { body: mk(now + 120_000) }), 401);
  await t(route, 'POST', 'challenge for wallet A signed by wallet B', () => R('POST', '/api/ranked/auth', { body: mk(now, mkWallet()) }), 401);
  await t(route, 'POST', 'message for wallet A submitted as wallet B', () => R('POST', '/api/ranked/auth', { body: { ...mk(now), wallet: mkWallet().addr } }), 401);
  await t(route, 'POST', 'message with trailing newline', () => { const b = mk(now); return R('POST', '/api/ranked/auth', { body: { ...b, message: b.message + '\n' } }); }, 401);
  await t(route, 'POST', 'Issued: line duplicated', () => { const b = mk(now); return R('POST', '/api/ranked/auth', { body: { ...b, message: b.message + `\nIssued: ${now - 9e9}` } }); }, 401);
  await t(route, 'POST', 'signature 63 bytes', () => R('POST', '/api/ranked/auth', { body: { ...mk(now), signature: bs58.encode(Buffer.alloc(63, 1)) } }), 401);
  await t(route, 'POST', 'signature not base58 (0OIl)', () => R('POST', '/api/ranked/auth', { body: { ...mk(now), signature: '0OIl' } }), 401);
  for (let i = 0; i < 6; i++) { // ~half of random 32-byte values are not ed25519 points
    const raw = randomBytes(32); const addr = bs58.encode(raw);
    await t(route, 'POST', `random (maybe off-curve) wallet #${i}, junk signature`, () => R('POST', '/api/ranked/auth', { body: { wallet: addr, message: rChallenge(addr), signature: bs58.encode(randomBytes(64)) } }), 401);
  }
  await t(route, 'POST', 'wallet = all-zero pubkey (32 x "1")', () => R('POST', '/api/ranked/auth', { body: { wallet: '1'.repeat(32), message: rChallenge('1'.repeat(32)), signature: bs58.encode(Buffer.alloc(64)) } }), 401);
  await fuzz({
    route, send: (o) => R('POST', '/api/ranked/auth', o),
    valid: () => { const x = mkWallet(); const m = rChallenge(x.addr); return { wallet: x.addr, message: m, signature: x.sign(m) }; },
    fields: { wallet: 'string', message: 'string', signature: 'string' }, required: ['wallet'],
  });
  await t(route, 'GET', 'GET not allowed', () => R('GET', '/api/ranked/auth'), 405);
  await t(route, 'DELETE', 'DELETE not allowed', () => R('DELETE', '/api/ranked/auth'), 405);
}

// me / referrer / run (GET + bearer)
for (const route of ['ranked/me', 'ranked/referrer']) {
  await t(route, 'GET', 'valid session', () => R('GET', `/api/${route}`, { bearer: bearer(tokP) }), 200);
  await bearerMatrix(route, 'GET', (b) => R('GET', `/api/${route}`, { bearer: b }));
  await t(route, 'POST', 'POST not allowed', () => R('POST', `/api/${route}`, { bearer: bearer(tokP), body: {} }), 405);
}
{
  const route = 'ranked/run';
  await bearerMatrix(route, 'GET', (b) => R('GET', '/api/ranked/run', { bearer: b, query: '?id=00000000-0000-4000-8000-000000000000' }));
  for (const [n, id] of [['no id', null], ['unknown uuid', '00000000-0000-4000-8000-000000000000'], ['not a uuid', 'abc'], ['SQL-ish', "x' OR '1'='1"], ['70KB id', 'A'.repeat(70_000)], ['unicode id', '\u{1D54F}\u0000'], ['empty', '']] as [string, string | null][]) {
    await t(route, 'GET', `id: ${n}`, () => R('GET', '/api/ranked/run', { bearer: bearer(tokP), query: id === null ? '' : `?id=${encodeURIComponent(id)}` }), n === 'no id' || n === 'unknown uuid' ? 404 : '4xx');
  }
}
// credit
{
  const route = 'ranked/credit';
  await bearerMatrix(route, 'POST', (b, x) => R('POST', '/api/ranked/credit', { bearer: b, body: { signature: B58_SIG }, ...x }));
  await t(route, 'POST', 'valid-shaped signature (RPC blocked) -> 502', () => R('POST', '/api/ranked/credit', { bearer: bearer(tokP), body: { signature: B58_SIG } }), 502);
  await fuzz({ route, send: (o) => R('POST', '/api/ranked/credit', { bearer: bearer(tokP), ...o }), valid: () => ({ signature: B58_SIG }), fields: { signature: 'string' }, required: ['signature'] });
  for (const [n, s] of [['63 chars', '5'.repeat(63)], ['91 chars', '5'.repeat(91)], ['contains 0', '0'.repeat(88)], ['contains l', 'l'.repeat(88)]] as const) {
    await t(route, 'POST', `signature ${n}`, () => R('POST', '/api/ranked/credit', { bearer: bearer(tokP), body: { signature: s } }), 400);
  }
  // per-wallet rate limit (120 / 10 min)
  const rw = mkWallet(), rt = session(rw);
  let last = 0;
  for (let i = 0; i < 125; i++) last = (await t(route, 'POST', `rate-limit probe ${i}`, () => R('POST', '/api/ranked/credit', { bearer: bearer(rt), body: { signature: B58_SIG }, ip: '203.0.113.9' }), 'lt500')).status;
  rows.push({ route, method: 'POST', name: 'per-wallet limit kicks in by call 125', expected: '429', actual: String(last), pass: last === 429 });
}
// start + play
{
  const route = 'ranked/start';
  await bearerMatrix(route, 'POST', (b) => R('POST', '/api/ranked/start', { bearer: b, body: {} }));
  const w = mkWallet(), tk = session(w);
  await t(route, 'POST', 'no tickets -> 402', () => R('POST', '/api/ranked/start', { bearer: bearer(tk), body: {} }), 402);
  await rdb.creditPurchase({ sig: 'S' + randomBytes(30).toString('hex'), wallet: w.addr, tickets: 5, vaultAmount: 1n, referralAccount: null, blockTimeMs: Date.now() });
  const s1 = await t(route, 'POST', 'valid start with ticket -> 200', () => R('POST', '/api/ranked/start', { bearer: bearer(tk), body: {} }), 200);
  await t(route, 'POST', 'start with junk body still starts (body ignored)', () => R('POST', '/api/ranked/start', { bearer: bearer(tk), raw: 'not json' }), 'lt500');
  await t(route, 'POST', 'start with 5MB-ish body', () => R('POST', '/api/ranked/start', { bearer: bearer(tk), raw: JSON.stringify({ p: 'A'.repeat(1_000_000) }) }), 'lt500');
  await t(route, 'POST', '4th attempt in a day -> 429', () => R('POST', '/api/ranked/start', { bearer: bearer(tk), body: {} }), 429);
  const credits = await rdb.getCredits(w.addr);
  rows.push({ route, method: 'POST', name: 'credits spent exactly once per started run (5 -> 2 after 3 starts + 1 refused)', expected: '2', actual: String(credits), pass: credits === 2 });
  // concurrent starts
  const cw = mkWallet(), ct = session(cw);
  await rdb.creditPurchase({ sig: 'C' + randomBytes(30).toString('hex'), wallet: cw.addr, tickets: 1, vaultAmount: 1n, referralAccount: null, blockTimeMs: Date.now() });
  const par = await Promise.all(Array.from({ length: 6 }, () => mods.get(route)!.POST(R('POST', '/api/ranked/start', { bearer: bearer(ct), body: {} }))));
  const okN = par.filter((r) => r.status === 200).length;
  rows.push({ route, method: 'POST', name: '6 parallel starts with 1 ticket: exactly one 200', expected: '1x200', actual: `${okN}x200 [${par.map((r) => r.status).join(',')}]`, pass: okN === 1 && par.every((r) => r.status < 500) });

  // play
  const pr = 'ranked/play';
  await bearerMatrix(pr, 'POST', (b) => R('POST', '/api/ranked/play', { bearer: b, body: { runId: s1.json.runId, fromMoves: 0, moves: [{ slot: 0, row: 0, col: 0 }] } }));
  const state0 = s1.json.state as ReturnType<typeof rules.initialState>;
  let first: { slot: number; row: number; col: number } | null = null;
  outer: for (const slot of [0, 1, 2]) for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    try { rules.applyMove(state0, { slot: slot as 0, row, col }); first = { slot, row, col }; break outer; } catch { /* illegal */ }
  }
  const fp: FuzzSpec = {
    route: pr, send: (o) => R('POST', '/api/ranked/play', { bearer: bearer(tk), ...o }),
    valid: () => ({ runId: s1.json.runId, fromMoves: 0, moves: [first] }),
    fields: { runId: 'string', fromMoves: 'number', moves: 'any' }, required: ['runId', 'fromMoves', 'moves'],
  };
  // fuzz first (all invalid or edge; none may mutate state), then the valid move
  await fuzz(fp);
  for (const [n, mv] of [
    ['4 moves', [first, first, first, first]], ['0 moves', []], ['slot 3', [{ ...first, slot: 3 }]], ['slot "0" string', [{ ...first, slot: '0' }]], ['slot -1', [{ ...first, slot: -1 }]],
    ['row 1.5', [{ ...first, row: 1.5 }]], ['row "1"', [{ ...first, row: '1' }]], ['row 1e308', [{ ...first, row: 1e308 }]], ['row null', [{ ...first, row: null }]],
    ['row -1', [{ ...first, row: -1 }]], ['col 8', [{ ...first, col: 8 }]], ['col 2^53+1', [{ ...first, col: 9007199254740993 }]], ['move is null', [null]], ['move is array', [[0, 0, 0]]], ['move is string', ['x']],
  ] as [string, unknown][]) {
    await t(pr, 'POST', `moves: ${n}`, () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: s1.json.runId, fromMoves: 0, moves: mv } }), '4xx');
  }
  for (const [n, id] of [['non-uuid runId', 'abc'], ['SQL-ish runId', "x'; DROP TABLE rk_runs;--"], ['unknown uuid', '00000000-0000-4000-8000-000000000000'], ['70KB runId', 'A'.repeat(70_000)]] as const) {
    await t(pr, 'POST', n, () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: id, fromMoves: 0, moves: [first] } }), '4xx');
  }
  await t(pr, 'POST', "another wallet's runId -> 404", () => R('POST', '/api/ranked/play', { bearer: bearer(tokP), body: { runId: s1.json.runId, fromMoves: 0, moves: [first] } }), 404);
  await t(pr, 'POST', 'fromMoves ahead of server -> 409', () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: s1.json.runId, fromMoves: 5, moves: [first] } }), 409);
  await t(pr, 'POST', 'fromMoves negative -> 409', () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: s1.json.runId, fromMoves: -1, moves: [first] } }), 409);
  const okMove = await t(pr, 'POST', 'valid move -> 200', () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: s1.json.runId, fromMoves: 0, moves: [first] } }), [200, 409]);
  await t(pr, 'POST', 'REPLAY of the same move body -> 409 (out of sync)', () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: s1.json.runId, fromMoves: 0, moves: [first] } }), 409);
  await t(pr, 'POST', 'illegal move (same cell again) -> 422', () => R('POST', '/api/ranked/play', { bearer: bearer(tk), body: { runId: s1.json.runId, fromMoves: 1, moves: [first] } }), 422);
  const got = await t('ranked/run', 'GET', 'resume: state matches after play', () => R('GET', '/api/ranked/run', { bearer: bearer(tk), query: `?id=${s1.json.runId}` }), 200);
  rows.push({ route: 'ranked/run', method: 'GET', name: 'moves counter = 1 after exactly one accepted move', expected: '1', actual: String(got.json?.state?.moves), pass: got.json?.state?.moves === 1 && okMove.json?.state?.moves === 1 });
  // parallel identical moves
  const pw = mkWallet(), pt = session(pw);
  await rdb.creditPurchase({ sig: 'P' + randomBytes(30).toString('hex'), wallet: pw.addr, tickets: 1, vaultAmount: 1n, referralAccount: null, blockTimeMs: Date.now() });
  const ps = await t(route, 'POST', 'setup: second wallet run', () => R('POST', '/api/ranked/start', { bearer: bearer(pt), body: {} }), 200);
  const pres = await Promise.all(Array.from({ length: 6 }, () => mods.get(pr)!.POST(R('POST', '/api/ranked/play', { bearer: bearer(pt), body: { runId: ps.json.runId, fromMoves: 0, moves: [first] } }))));
  const ok2 = pres.filter((r) => r.status === 200).length;
  rows.push({ route: pr, method: 'POST', name: '6 parallel identical moves: exactly one 200', expected: '1x200', actual: `${ok2}x200 [${pres.map((r) => r.status).join(',')}]`, pass: ok2 === 1 && pres.every((r) => r.status < 500) });
}
// logout / logout-all
{
  const w = mkWallet(), tk = session(w);
  await t('ranked/logout', 'POST', 'no token -> 401', () => R('POST', '/api/ranked/logout'), 401);
  await t('ranked/logout', 'POST', 'forged token -> 401', () => R('POST', '/api/ranked/logout', { bearer: bearer(`${w.addr}.${Date.now() + 1e6}.${'a'.repeat(16)}.${'A'.repeat(43)}`) }), 401);
  await t('ranked/logout', 'POST', 'valid -> 200', () => R('POST', '/api/ranked/logout', { bearer: bearer(tk) }), 200);
  await t('ranked/logout', 'POST', 'second logout of same token -> 200 idempotent', () => R('POST', '/api/ranked/logout', { bearer: bearer(tk) }), 200);
  await t('ranked/me', 'GET', 'token dead after logout', () => R('GET', '/api/ranked/me', { bearer: bearer(tk) }), 401);
  await t('ranked/logout', 'POST', 'expired token -> 401', () => R('POST', '/api/ranked/logout', { bearer: bearer(craft(w.addr, Date.now() - 5)) }), 401);
  const w2 = mkWallet(), a = session(w2); await new Promise((r) => setTimeout(r, 5));
  await t('ranked/logout-all', 'POST', 'no token -> 401', () => R('POST', '/api/ranked/logout-all'), 401);
  await t('ranked/logout-all', 'POST', 'valid -> 200', () => R('POST', '/api/ranked/logout-all', { bearer: bearer(a) }), 200);
  await t('ranked/me', 'GET', 'old token dead after logout-all', () => R('GET', '/api/ranked/me', { bearer: bearer(a) }), 401);
  await new Promise((r) => setTimeout(r, 5));
  const fresh = session(w2);
  await t('ranked/me', 'GET', 'token issued AFTER logout-all works', () => R('GET', '/api/ranked/me', { bearer: bearer(fresh) }), 200);
  await t('ranked/logout', 'GET', 'GET not allowed', () => R('GET', '/api/ranked/logout'), 405);
}
// public ranked reads
{
  for (const [n, q, e] of [
    ['today', '', 200], ['valid past day', `?d=${D(-3)}`, 200], ['7d ahead', `?d=${D(7)}`, 200], ['8d ahead', `?d=${D(9)}`, 404], ['2999', '?d=2999-01-01', 404],
    ['bad format', '?d=2026-1-1', 400], ['invalid date 02-30', '?d=2026-02-30', 400], ['month 13', '?d=2026-13-01', 400], ['empty', '?d=', 400], ['SQL-ish', "?d=2026-01-01'--", 400],
    ['70KB', `?d=${'1'.repeat(70000)}`, 400], ['array syntax (d[] is another key -> today)', '?d[]=x', 200], ['d=0000-00-00', '?d=0000-00-00', 400],
  ] as [string, string, number][]) await t('ranked/day', 'GET', `d: ${n}`, () => R('GET', '/api/ranked/day', { query: q }), e);
  for (const [n, q, e] of [
    ['default', '', 200], ['day', `?period=day&d=${D(-1)}`, 200], ['month', '?period=month&m=2026-10', 200], ['bad month 2026-13', '?period=month&m=2026-13', 400], ['bad month 2026-00', '?period=month&m=2026-00', 400],
    ['bad month 70KB', `?period=month&m=${'9'.repeat(70000)}`, 400], ['bad day', '?d=nope', 400], ['unknown period', '?period=year', 200], ['SQL-ish month', "?period=month&m=2026-01'--", 400],
  ] as [string, string, number][]) await t('ranked/leaderboard', 'GET', n, () => R('GET', '/api/ranked/leaderboard', { query: q }), e);
  const pw = P.addr;
  for (const [n, q, e] of [
    ['valid wallet', `?wallet=${pw}`, 200], ['missing wallet', '', 400], ['bad wallet', '?wallet=abc', 400], ['round numeric', `?wallet=${pw}&round=5`, 200], ['round 20 digits', `?wallet=${pw}&round=${'9'.repeat(20)}`, 400],
    ['round negative', `?wallet=${pw}&round=-1`, 400], ['round SQL-ish', `?wallet=${pw}&round=1'--`, 400], ['round empty', `?wallet=${pw}&round=`, 400], ['wallet 70KB', `?wallet=${'1'.repeat(70000)}`, 400],
  ] as [string, string, number][]) await t('ranked/proof', 'GET', n, () => R('GET', '/api/ranked/proof', { query: q }), e);
  for (const r of ['ranked/day', 'ranked/leaderboard', 'ranked/proof']) await t(r, 'POST', 'POST not allowed', () => R('POST', `/api/${r}`, { body: {} }), 405);
}

// ═══════════ other bearer-authed player routes ═══════════
console.log('profile/avatar/quests/referrals/achievements/score ...');
{
  // profile
  const route = 'profile';
  const pw = mkWallet(), pt = session(pw);
  await t(route, 'GET', 'GET ?addr valid', () => R('GET', '/api/profile', { query: `?addr=${pw.addr}` }), 200);
  for (const [n, q] of [['missing addr', ''], ['bad addr', '?addr=abc'], ['70KB addr', `?addr=${'1'.repeat(70000)}`], ['injection', "?addr=1'--"]] as const) await t(route, 'GET', `GET ${n}`, () => R('GET', '/api/profile', { query: q }), 400);
  await bearerMatrix(route, 'POST', (b) => R('POST', '/api/profile', { bearer: b, body: { patch: { theme: 'dark' } } }));
  await t(route, 'POST', 'valid patch', () => R('POST', '/api/profile', { bearer: bearer(pt), body: { patch: { displayName: 'Ana', theme: 'dark', language: 'en' } } }), 200);
  await fuzz({ route, send: (o) => R('POST', '/api/profile', { bearer: bearer(pt), ...o }), valid: () => ({ patch: { displayName: 'Ana' }, addr: pw.addr }), fields: { patch: 'object', addr: 'string' }, required: ['patch'] });
  for (const [k, vals] of Object.entries({
    displayName: [null, 7, '', ' ', 'a'.repeat(25), '\u0000x', 'x‮y', '<script>', '😀'.repeat(24), '😀'.repeat(25), ['a'], { a: 1 }],
    avatarId: [null, 7, '', "x'", '../../etc', 'a'.repeat(70000)], language: [null, 7, 'xx', '', 'en\u0000'], theme: [null, 7, 'blue', '', ['dark']],
  } as Record<string, unknown[]>)) for (const v of vals) await t(route, 'POST', `patch.${k} = ${JSON.stringify(v)?.slice(0, 30)}`, () => R('POST', '/api/profile', { bearer: bearer(pt), body: { patch: { [k]: v } } }), k === 'displayName' && (v === '😀'.repeat(24) || v === '<script>') ? 'lt500' : '4xx');
  await t(route, 'POST', 'patch with unknown keys only (__proto__, admin) -> ignored', () => R('POST', '/api/profile', { bearer: bearer(pt), raw: '{"patch":{"__proto__":{"admin":true},"currentLevel":9999,"tickets":99}}' }), 'lt500');
  await t(route, 'POST', 'addr of another wallet in body -> 403', () => R('POST', '/api/profile', { bearer: bearer(pt), body: { addr: P.addr, patch: { theme: 'dark' } } }), 403);
  await t(route, 'POST', '5KB body -> 413', () => R('POST', '/api/profile', { bearer: bearer(pt), body: { patch: { theme: 'dark' }, pad: 'A'.repeat(5000) } }), 413);
  const afterU = await t(route, 'GET', 'GET shows no escalated currentLevel/tickets from the patch', () => R('GET', '/api/profile', { query: `?addr=${pw.addr}` }), 200);
  rows.push({ route, method: 'GET', name: 'currentLevel not writable via patch', expected: 'no 9999', actual: JSON.stringify(afterU.json).slice(0, 80), pass: !String(afterU.text).includes('9999') });
}
{
  const route = 'profile/avatar';
  const aw = mkWallet(), at = session(aw);
  await t(route, 'GET', 'GET public wallet', () => R('GET', '/api/profile/avatar', { query: `?wallet=${aw.addr}` }), 200);
  await t(route, 'GET', 'GET forged bearer -> 401', () => R('GET', '/api/profile/avatar', { bearer: 'Bearer forged', query: `?wallet=${aw.addr}` }), 401);
  await t(route, 'GET', 'GET own via session', () => R('GET', '/api/profile/avatar', { bearer: bearer(at) }), 200);
  for (const q of ['', '?wallet=abc', `?wallet=${'1'.repeat(70000)}`]) await t(route, 'GET', `GET wallet ${q.slice(0, 20) || '(none)'} no auth -> 400`, () => R('GET', '/api/profile/avatar', { query: q }), 400);
  await bearerMatrix(route, 'POST', (b) => R('POST', '/api/profile/avatar', { bearer: b, body: { wallet: aw.addr, avatarId: null } }));
  await t(route, 'POST', 'valid clear (null)', () => R('POST', '/api/profile/avatar', { bearer: bearer(at), body: { wallet: aw.addr, avatarId: null } }), 200);
  await fuzz({ route, send: (o) => R('POST', '/api/profile/avatar', { bearer: bearer(at), ...o }), valid: () => ({ wallet: aw.addr, avatarId: null }), fields: { wallet: 'string', avatarId: 'string' }, required: ['wallet'] });
  await t(route, 'POST', 'avatarId missing entirely -> 400', () => R('POST', '/api/profile/avatar', { bearer: bearer(at), body: { wallet: aw.addr } }), 400);
  await t(route, 'POST', "other wallet's avatar -> 403", () => R('POST', '/api/profile/avatar', { bearer: bearer(at), body: { wallet: P.addr, avatarId: null } }), 403);
  for (const id of ['Robot', 'bad id', "x'--", '../x', 'a'.repeat(41), 'm1-b99-p99-e99-m99-a99-g99']) await t(route, 'POST', `avatarId ${id.slice(0, 20)}`, () => R('POST', '/api/profile/avatar', { bearer: bearer(at), body: { wallet: aw.addr, avatarId: id } }), 400);
}
{
  const route = 'achievements/sync';
  const w = mkWallet(), tk = session(w);
  await bearerMatrix(route, 'POST', (b) => R('POST', '/api/achievements/sync', { bearer: b, body: { wallet: w.addr, stats: {} } }));
  await t(route, 'POST', 'valid', () => R('POST', '/api/achievements/sync', { bearer: bearer(tk), body: { wallet: w.addr, stats: { lines: 5 } } }), 200);
  await fuzz({ route, send: (o) => R('POST', '/api/achievements/sync', { bearer: bearer(tk), ...o }), valid: () => ({ wallet: w.addr, stats: { lines: 5 } }), fields: { wallet: 'string', stats: 'object' }, required: ['wallet'] });
  await t(route, 'POST', "another wallet's address -> 403", () => R('POST', '/api/achievements/sync', { bearer: bearer(tk), body: { wallet: P.addr, stats: {} } }), 403);
  for (const [n, st] of [['stats huge numbers', { lines: 1e308, combos: -5, perfect: 1.9 }], ['stats NaN-like strings', { lines: 'NaN', combos: '1e9' }], ['stats array', [1, 2]], ['stats proto', JSON.parse('{"__proto__":{"x":1},"lines":3}')], ['stats 10k keys', Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`k${i}`, i]))]] as const)
    await t(route, 'POST', n, () => R('POST', '/api/achievements/sync', { bearer: bearer(tk), body: { wallet: w.addr, stats: st } }), 'lt500');
  await t(route, 'GET', 'GET not allowed', () => R('GET', '/api/achievements/sync'), 405);
  for (const [n, q, e] of [['valid', `?wallet=${w.addr}`, 200], ['missing', '', 400], ['bad', '?wallet=x', 400], ['70KB', `?wallet=${'1'.repeat(70000)}`, 400]] as [string, string, number][]) await t('achievements', 'GET', n, () => R('GET', '/api/achievements', { query: q }), e);
}
{
  const w = mkWallet(), tk = session(w);
  const route = 'referrals/claim';
  await bearerMatrix(route, 'POST', (b) => R('POST', '/api/referrals/claim', { bearer: b, body: { referrer: P.addr } }));
  await t(route, 'POST', 'valid -> recorded', () => R('POST', '/api/referrals/claim', { bearer: bearer(tk), body: { referrer: P.addr } }), 200);
  await t(route, 'POST', 'second claim -> duplicate (200)', () => R('POST', '/api/referrals/claim', { bearer: bearer(tk), body: { referrer: P2.addr } }), 200);
  await fuzz({ route, send: (o) => R('POST', '/api/referrals/claim', { bearer: bearer(session(mkWallet())), ...o }), valid: () => ({ referrer: P.addr }), fields: { referrer: 'string' }, required: ['referrer'] });
  await t(route, 'POST', 'self referral', () => R('POST', '/api/referrals/claim', { bearer: bearer(session(P2)), body: { referrer: P2.addr } }), 200);
  const r = await t(route, 'POST', 'rate limit (10/h/IP)', () => R('POST', '/api/referrals/claim', { bearer: bearer(session(mkWallet())), body: { referrer: P.addr }, ip: '198.51.100.7' }), 'lt500');
  let lim = 0; for (let i = 0; i < 12; i++) lim = (await t(route, 'POST', `rate-limit probe ${i}`, () => R('POST', '/api/referrals/claim', { bearer: bearer(session(mkWallet())), body: { referrer: P.addr }, ip: '198.51.100.8' }), 'lt500')).status;
  rows.push({ route, method: 'POST', name: '12th claim from one IP limited', expected: '429', actual: String(lim), pass: lim === 429 && r.status < 500 });
  for (const [n, q, e] of [['valid', `?wallet=${P.addr}`, 200], ['missing', '', 400], ['bad', '?wallet=zz', 400]] as [string, string, number][]) await t('referrals', 'GET', n, () => R('GET', '/api/referrals', { query: q }), e);
  await t('referrals/stats', 'GET', 'anonymous', () => R('GET', '/api/referrals/stats'), 200);
  await t('referrals/stats', 'GET', 'forged bearer -> 401 (earlier lane claimed 200: it was wrong)', () => R('GET', '/api/referrals/stats', { bearer: 'Bearer forged.token.value' }), 401);
  await t('referrals/stats', 'GET', 'valid bearer', () => R('GET', '/api/referrals/stats', { bearer: bearer(tk) }), 200);
}
{
  const route = 'score/submit';
  const w = mkWallet(), tk = session(w);
  await bearerMatrix(route, 'POST', (b) => R('POST', '/api/score/submit', { bearer: b, body: { walletAddress: w.addr, score: 10, level: 1 } }));
  await t(route, 'POST', 'valid', () => R('POST', '/api/score/submit', { bearer: bearer(tk), body: { walletAddress: w.addr, score: 10, level: 1 } }), 200);
  await fuzz({ route, send: (o) => R('POST', '/api/score/submit', { bearer: bearer(session(mkWallet())), ...o }), valid: () => ({ walletAddress: P.addr, score: 10, level: 1 }), fields: { walletAddress: 'string', score: 'number', level: 'any', txSignature: 'string' }, required: ['walletAddress', 'score'] });
  await t(route, 'POST', "another wallet's address -> 403", () => R('POST', '/api/score/submit', { bearer: bearer(tk), body: { walletAddress: P.addr, score: 10, level: 1 } }), 403);
  for (const [n, sc, e] of [['score 5_000_001', 5_000_001, 422], ['score -1', -1, 422], ['score 1e308', 1e308, 422], ['score 1.5', 1.5, 'lt500'], ['score 5_000_000', 5_000_000, 200]] as [string, number, Expect][]) await t(route, 'POST', n, () => R('POST', '/api/score/submit', { bearer: bearer(tk), body: { walletAddress: w.addr, score: sc, level: 1 } }), e);
  for (const [n, lv] of [['level -5', -5], ['level 1e308', 1e308], ['level "abc"', 'abc'], ['level object', { a: 1 }], ['level 70KB string', 'A'.repeat(70000)]] as const)
    await t(route, 'POST', `${n} (level normalised to 1..max, never stored raw)`, () => R('POST', '/api/score/submit', { bearer: bearer(tk), body: { walletAddress: w.addr, score: 5, level: lv } }), 'lt500');
  const rl = await t(route, 'POST', 'txSignature object', () => R('POST', '/api/score/submit', { bearer: bearer(tk), body: { walletAddress: w.addr, score: 5, level: 1, txSignature: { a: 1 } } }), 'lt500');
  void rl;
}
{
  const route = 'quests';
  const w = mkWallet(), tk = session(w);
  await t(route, 'GET', 'anonymous list', () => R('GET', '/api/quests'), 200);
  await t(route, 'GET', 'forged bearer -> 401', () => R('GET', '/api/quests', { bearer: 'Bearer nope' }), 401);
  await t(route, 'GET', 'revoked bearer -> 401', async () => { const x = mkWallet(), y = session(x), p = y.split('.'); await rev.revokeSession(p[2], Number(p[1])); return R('GET', '/api/quests', { bearer: bearer(y) }); }, 401);
  const q = await t('quests', 'POST', 'player session cannot create quest -> 401', () => R('POST', '/api/quests', { bearer: bearer(tk), body: { title: 't', description: 'd', type: 'custom', rewardLabel: 'r' } }), 401);
  void q;
}
{
  const w = mkWallet(), tk = session(w);
  for (const [n, id] of [['unknown quest', 'nope'], ['70KB id', 'A'.repeat(70000)], ['unicode id', '\u{1D54F}\u0000']] as const)
    await t('quests/[id]/submit', 'POST', `submit ${n}`, () => R('POST', '/api/quests/x/submit', { bearer: bearer(tk), body: { proof: 'p' } }), 404, { id });
  await bearerMatrix('quests/[id]/submit', 'POST', (b) => R('POST', '/api/quests/x/submit', { bearer: b, body: { proof: 'p' } }), { id: 'x' });
  await t('quests/[id]/review', 'GET', 'player session cannot list completions', () => R('GET', '/api/quests/x/review', { bearer: bearer(tk) }), 401, { id: 'x' });
  await t('quests/[id]/review', 'POST', 'player session cannot review', () => R('POST', '/api/quests/x/review', { bearer: bearer(tk), body: { wallet: w.addr, approve: true } }), 401, { id: 'x' });
}

// ═══════════ admin / partner (cookie) ═══════════
console.log('admin/partner ...');
const adminCookie = await consoleLogin('admin', admin);
const PW = mkWallet();
const partnerCookie = await consoleLogin('partner', PW);
const NPW = mkWallet(); // never applies: partner cookie but no application
const strangerCookie = await consoleLogin('partner', NPW);
{
  const bad = (label: string) => `${label}=${encodeURIComponent(`${PW.addr}.${Date.now() + 1e6}.${'A'.repeat(43)}`)}`;
  const cookieMatrix = async (route: string, method: string, role: 'admin' | 'partner', mk: (cookie: string | undefined, extra?: Opts) => Request, goodCookie: string, params?: Record<string, string>) => {
    const name = adminSession.COOKIE[role], other: 'admin' | 'partner' = role === 'admin' ? 'partner' : 'admin';
    const wallet = role === 'admin' ? admin.addr : PW.addr;
    const [, expS, macS] = decodeURIComponent(goodCookie.split('=')[1]).split('.');
    const cases: [string, string | undefined][] = [
      ['no cookie', undefined],
      ['empty cookie value', `${name}=`],
      ['garbage cookie', `${name}=garbage`],
      ['forged cookie (right shape, wrong mac)', bad(name)],
      ['expiry extended, mac kept', `${name}=${encodeURIComponent(`${wallet}.${Number(expS) + 3600_000}.${macS}`)}`],
      ['expired 1s ago (validly MACed)', consoleCookie(role, wallet, Date.now() - 1000)],
      ['exp = 0 (validly MACed)', consoleCookie(role, wallet, 0)],
      ['other role cookie under this name (mac label mismatch)', consoleCookie(other, wallet, Date.now() + 1e6).replace(adminSession.COOKIE[other], name)],
      ['other role cookie under its own name only', consoleCookie(other, wallet, Date.now() + 1e6)],
      ['malformed %-escape', `${name}=%E0%A4%A`],
      ['cookie value 5000 chars', `${name}=${'A'.repeat(5000)}`],
      ['4-part cookie', `${name}=${encodeURIComponent(`${wallet}.${Date.now() + 1e6}.${macS}.x`)}`],
      ['Bearer ranked session instead of cookie', undefined],
    ];
    for (const [n, c] of cases) await t(route, method, `auth: ${n}`, () => n.startsWith('Bearer') ? mk(undefined, { bearer: bearer(tokP) }) : mk(c), 401, params);
    if (role === 'admin') {
      const nonAdmin = mkWallet();
      await t(route, method, 'auth: validly MACed admin-label cookie for a NON-admin wallet', () => mk(consoleCookie('admin', nonAdmin.addr, Date.now() + 1e6)), 401, params);
      await t(route, method, 'auth: partner session cookie moved to admin cookie name', () => mk(`${name}=${goodPartnerValue}`), 401, params);
    }
  };
  var goodPartnerValue = decodeURIComponent(partnerCookie.split('=')[1]);
  goodPartnerValue = encodeURIComponent(goodPartnerValue);

  // auth endpoints
  for (const role of ['admin', 'partner'] as const) {
    const route = `${role}/auth`;
    const w = role === 'admin' ? admin : mkWallet();
    await t(route, 'GET', 'GET without cookie -> wallet null', () => R('GET', `/api/${route}`), 200);
    const g = await t(route, 'GET', 'GET with valid cookie', () => R('GET', `/api/${route}`, { cookie: role === 'admin' ? adminCookie : partnerCookie }), 200);
    rows.push({ route, method: 'GET', name: 'valid cookie reports wallet', expected: 'wallet set', actual: String(g.json?.wallet), pass: Boolean(g.json?.wallet) });
    await t(route, 'GET', 'GET with forged cookie -> wallet null', async () => R('GET', `/api/${route}`, { cookie: bad(adminSession.COOKIE[role]) }), 200);
    const c = await t(route, 'POST', 'challenge', () => R('POST', `/api/${route}`, { body: { wallet: w.addr } }), 200);
    const msg = c.json.message as string, sig = w.sign(msg);
    await t(route, 'POST', 'valid sign-in', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: msg, signature: sig } }), 200);
    await t(route, 'POST', 'REPLAY of used sign-in', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: msg, signature: sig } }), 401);
    const issued = Date.now();
    const old = adminSession.challenge(role, w.addr, issued - 11 * 60_000);
    await t(route, 'POST', 'expired challenge (validly signed)', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: old, signature: w.sign(old) } }), 401);
    const fut = adminSession.challenge(role, w.addr, issued + 120_000);
    await t(route, 'POST', 'future-dated challenge', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: fut, signature: w.sign(fut) } }), 401);
    const otherRole = adminSession.challenge(role === 'admin' ? 'partner' : 'admin', w.addr, issued);
    await t(route, 'POST', 'challenge of the OTHER role (cross-role replay)', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: otherRole, signature: w.sign(otherRole) } }), 401);
    const rc = rChallenge(w.addr, issued);
    await t(route, 'POST', 'ranked sign-in challenge replayed here (cross-scheme)', () => R('POST', `/api/${route}`, { body: { wallet: w.addr, message: rc, signature: w.sign(rc) } }), 401);
    if (role === 'admin') {
      const ns = mkWallet(), m2 = adminSession.challenge('admin', ns.addr, issued);
      await t(route, 'POST', 'non-admin wallet signs a correct admin challenge', () => R('POST', `/api/${route}`, { body: { wallet: ns.addr, message: m2, signature: ns.sign(m2) } }), 401);
      const m3 = ns.addr; void m3;
    }
    await fuzz({ route, send: (o) => R('POST', `/api/${route}`, o), valid: () => { const m = adminSession.challenge(role, w.addr, Date.now()); return { wallet: w.addr, message: m, signature: w.sign(m) }; }, fields: { wallet: 'string', message: 'string', signature: 'string' }, required: ['wallet'] });
    await t(route, 'DELETE', 'DELETE clears cookie (no auth needed; logout CSRF only)', () => R('DELETE', `/api/${route}`), 200);
    await t(route, 'PUT', 'PUT not allowed', () => R('PUT', `/api/${route}`, { body: {} }), 405);
    const sc = await t(route, 'POST', 'cookie flags on sign-in', () => R('POST', `/api/${route}`, { body: (() => { const m = adminSession.challenge(role, w.addr, Date.now()); return { wallet: w.addr, message: m, signature: w.sign(m) }; })() }), 200);
    const flags = sc.res?.headers.getSetCookie().join(';') ?? '';
    rows.push({ route, method: 'POST', name: 'Set-Cookie has HttpOnly, SameSite=Strict, Secure (NODE_ENV=production)', expected: 'all three', actual: flags.replace(/=[^;]*\.[^;]*;/, '=<tok>;').slice(0, 120), pass: /HttpOnly/.test(flags) && /SameSite=Strict/.test(flags) && /Secure/.test(flags) });
  }

  // admin read routes
  for (const [route, q] of [['admin/stats', '?tab=traffic'], ['admin/errors', ''], ['admin/partners', '']] as const) {
    await t(route, 'GET', 'valid admin cookie', () => R('GET', `/api/${route}`, { cookie: adminCookie, query: q }), 200);
    await cookieMatrix(route, 'GET', 'admin', (c, x) => R('GET', `/api/${route}`, { cookie: c, query: q, ...x }), adminCookie);
    await t(route, 'GET', 'partner cookie on admin route -> 401', () => R('GET', `/api/${route}`, { cookie: partnerCookie, query: q }), 401);
  }
  for (const [n, q, e] of [['unknown tab', '?tab=nope', 400], ['no tab', '', 400], ['tab=__proto__', '?tab=__proto__', 400], ['tab=constructor', '?tab=constructor', 400], ['tab=toString', '?tab=toString', 400], ['tab=hasOwnProperty', '?tab=hasOwnProperty', 400], ['tab 70KB', `?tab=${'a'.repeat(70000)}`, 400], ['tabs: money', '?tab=money', 200], ['tabs: players', '?tab=players', 200], ['tabs: health', '?tab=health', 200]] as [string, string, number][])
    await t('admin/stats', 'GET', `admin ${n}`, () => R('GET', '/api/admin/stats', { cookie: adminCookie, query: q }), e);
  // admin/partners POST
  {
    const route = 'admin/partners';
    await cookieMatrix(route, 'POST', 'admin', (c, x) => R('POST', `/api/${route}`, { cookie: c, body: { wallet: PW.addr, status: 'approved' }, ...x }), adminCookie);
    await t(route, 'POST', 'partner cookie -> 401', () => R('POST', `/api/${route}`, { cookie: partnerCookie, body: { wallet: PW.addr, status: 'approved' } }), 401);
    await fuzz({ route, send: (o) => R('POST', `/api/${route}`, { cookie: adminCookie, ...o }), valid: () => ({ wallet: PW.addr, status: 'approved' }), fields: { wallet: 'string', status: 'string' }, required: ['wallet', 'status'] });
    await t(route, 'POST', 'status = pending -> 400', () => R('POST', `/api/${route}`, { cookie: adminCookie, body: { wallet: PW.addr, status: 'pending' } }), 400);
    await t(route, 'POST', 'status = APPROVED (case) -> 400', () => R('POST', `/api/${route}`, { cookie: adminCookie, body: { wallet: PW.addr, status: 'APPROVED' } }), 400);
    await t(route, 'POST', 'unknown wallet -> 404', () => R('POST', `/api/${route}`, { cookie: adminCookie, body: { wallet: mkWallet().addr, status: 'approved' } }), 404);
  }
  // partner/me apply, then approve
  {
    const route = 'partner/me';
    await t(route, 'GET', 'valid partner cookie (no application yet)', () => R('GET', `/api/${route}`, { cookie: partnerCookie }), 200);
    await cookieMatrix(route, 'GET', 'partner', (c, x) => R('GET', `/api/${route}`, { cookie: c, ...x }), partnerCookie);
    await t(route, 'GET', 'admin cookie on partner route -> 401', () => R('GET', `/api/${route}`, { cookie: adminCookie }), 401);
    await cookieMatrix(route, 'POST', 'partner', (c, x) => R('POST', `/api/${route}`, { cookie: c, body: { name: 'Acme', tokenMint: P.addr, contact: 'a@b.co' }, ...x }), partnerCookie);
    await fuzz({ route, send: (o) => R('POST', `/api/${route}`, { cookie: partnerCookie, ...o }), valid: () => ({ name: 'Acme', tokenMint: P.addr, contact: 'a@b.co' }), fields: { name: 'string', tokenMint: 'string', contact: 'string' }, required: ['name', 'tokenMint', 'contact'] });
    await t(route, 'POST', 'valid application', () => R('POST', `/api/${route}`, { cookie: partnerCookie, body: { name: 'Acme', tokenMint: P.addr, contact: 'a@b.co' } }), 200);
    await t(route, 'POST', 'admin cookie on partner route -> 401', () => R('POST', `/api/${route}`, { cookie: adminCookie, body: { name: 'Acme', tokenMint: P.addr, contact: 'a@b.co' } }), 401);
    await t('partner/campaigns', 'POST', 'unapproved partner -> 403', () => R('POST', '/api/partner/campaigns', { cookie: partnerCookie, body: { mint: P.addr } }), 403);
    await t('admin/partners', 'POST', 'admin approves partner', () => R('POST', '/api/admin/partners', { cookie: adminCookie, body: { wallet: PW.addr, status: 'approved' } }), 200);
    await t(route, 'POST', 're-apply while approved -> 400', () => R('POST', `/api/${route}`, { cookie: partnerCookie, body: { name: 'Evil', tokenMint: P.addr, contact: 'a@b.co' } }), 400);
    await t(route, 'GET', 'approved partner GET', () => R('GET', `/api/${route}`, { cookie: partnerCookie }), 200);
    await t(route, 'GET', 'wallet w/o application GET (stranger cookie)', () => R('GET', `/api/${route}`, { cookie: strangerCookie }), 200);
  }
  // partner routes
  {
    const rc = 'partner/campaigns';
    await cookieMatrix(rc, 'POST', 'partner', (c, x) => R('POST', `/api/${rc}`, { cookie: c, body: { mint: P.addr, rule: 'level', startsOn: D(), endsOn: D(5), budget: '1', ruleAmount: '1', ruleLevel: 3 }, ...x }), partnerCookie);
    await t(rc, 'POST', 'stranger (no application) -> 403', () => R('POST', `/api/${rc}`, { cookie: strangerCookie, body: { mint: P.addr } }), 403);
    await fuzz({ route: rc, send: (o) => R('POST', `/api/${rc}`, { cookie: partnerCookie, ...o }), valid: () => ({ mint: P.addr, rule: 'level', startsOn: D(), endsOn: D(5), budget: '1', ruleAmount: '1', ruleLevel: 3 }), fields: { mint: 'string', rule: 'string', startsOn: 'string', endsOn: 'string', budget: 'any', ruleAmount: 'any', ruleLevel: 'any', ruleAmounts: 'any', ruleAchievement: 'string' }, required: ['mint', 'rule', 'startsOn', 'endsOn'] });
    await t(rc, 'POST', 'valid-shaped (mint lookup needs RPC, blocked) -> 400', () => R('POST', `/api/${rc}`, { cookie: partnerCookie, body: { mint: P.addr, rule: 'level', startsOn: D(), endsOn: D(5), budget: '1', ruleAmount: '1', ruleLevel: 3 } }), 400);
    for (const [n, b] of [['endsOn before startsOn', { startsOn: D(5), endsOn: D() }], ['rule unknown', { rule: 'x' }], ['rule __proto__', { rule: '__proto__' }], ['rule constructor', { rule: 'constructor' }], ['start date 2026-02-30', { startsOn: '2026-02-30' }], ['budget negative', { budget: '-5' }], ['budget 1e999', { budget: '1e999' }], ['budget 99999999999999999999999', { budget: '9'.repeat(40) }], ['ruleAmounts 1000 entries', { rule: 'daily_top', ruleAmounts: Array.from({ length: 1000 }, () => '1') }]] as const)
      await t(rc, 'POST', n, () => R('POST', `/api/${rc}`, { cookie: partnerCookie, body: { mint: P.addr, rule: 'level', startsOn: D(), endsOn: D(5), budget: '1', ruleAmount: '1', ruleLevel: 3, ...b } }), '4xx');
    const rp = 'partner/campaigns/pause';
    await cookieMatrix(rp, 'POST', 'partner', (c, x) => R('POST', `/api/${rp}`, { cookie: c, body: { campaignId: 'nope', paused: true }, ...x }), partnerCookie);
    await fuzz({ route: rp, send: (o) => R('POST', `/api/${rp}`, { cookie: partnerCookie, ...o }), valid: () => ({ campaignId: 'nope', paused: true }), fields: { campaignId: 'string', paused: 'boolean' }, required: ['campaignId', 'paused'] });
    await t(rp, 'POST', 'unknown campaign -> 404', () => R('POST', `/api/${rp}`, { cookie: partnerCookie, body: { campaignId: 'nope', paused: true } }), 404);
    await t(rp, 'POST', "stranger partner can't pause others -> 404", () => R('POST', `/api/${rp}`, { cookie: strangerCookie, body: { campaignId: 'nope', paused: true } }), 404);
    const rd = 'partner/deposit';
    await cookieMatrix(rd, 'POST', 'partner', (c, x) => R('POST', `/api/${rd}`, { cookie: c, body: { campaignId: 'nope', signature: B58_SIG }, ...x }), partnerCookie);
    await fuzz({ route: rd, send: (o) => R('POST', `/api/${rd}`, { cookie: partnerCookie, ...o }), valid: () => ({ campaignId: 'nope', signature: B58_SIG }), fields: { campaignId: 'string', signature: 'string' }, required: ['campaignId'] });
    const re = 'partner/export';
    await cookieMatrix(re, 'GET', 'partner', (c, x) => R('GET', `/api/${re}`, { cookie: c, query: '?campaign=nope', ...x }), partnerCookie);
    for (const q of ['', '?campaign=nope', `?campaign=${'a'.repeat(70000)}`, "?campaign=x'--", '?campaign=%00']) await t(re, 'GET', `campaign ${q.slice(0, 24) || '(none)'}`, () => R('GET', `/api/${re}`, { cookie: partnerCookie, query: q }), 404);
  }
  // player-side partner routes
  {
    const w = mkWallet(), tk = session(w);
    for (const [route, method, b] of [['partner/rewards', 'GET', undefined], ['partner/claim', 'POST', { allocationId: 'nope' }], ['partner/claim/confirm', 'POST', { allocationId: 'nope' }]] as const) {
      await bearerMatrix(route, method, (br) => R(method, `/api/${route}`, { bearer: br, ...(b ? { body: b } : {}) }));
      await t(route, method, 'valid session', () => R(method, `/api/${route}`, { bearer: bearer(tk), ...(b ? { body: b } : {}) }), method === 'GET' ? 200 : 'lt500');
    }
    await fuzz({ route: 'partner/claim', send: (o) => R('POST', '/api/partner/claim', { bearer: bearer(session(mkWallet())), ...o }), valid: () => ({ allocationId: 'nope' }), fields: { allocationId: 'string' }, required: ['allocationId'] });
    await fuzz({ route: 'partner/claim/confirm', send: (o) => R('POST', '/api/partner/claim/confirm', { bearer: bearer(session(mkWallet())), ...o }), valid: () => ({ allocationId: 'nope', signature: B58_SIG }), fields: { allocationId: 'string', signature: 'string' }, required: ['allocationId'] });
    for (const id of ['00000000-0000-4000-8000-000000000000', "1; DROP TABLE x", 'A'.repeat(70000)]) await t('partner/claim', 'POST', `allocationId ${id.slice(0, 18)}`, () => R('POST', '/api/partner/claim', { bearer: bearer(session(mkWallet())), body: { allocationId: id } }), 'lt500');
  }
  // admin/errors POST (public), quests POST (admin)
  {
    const route = 'admin/errors';
    await t(route, 'POST', 'valid report', () => R('POST', `/api/${route}`, { body: { message: 'boom', stack: 's', path: '/x', build: 'b' } }), 201);
    await fuzz({ route, send: (o) => R('POST', `/api/${route}`, o), valid: () => ({ message: 'boom', stack: 's', path: '/x', build: 'b' }), fields: { message: 'string', stack: 'string', path: 'string', build: 'string' }, required: ['message'] });
    await t(route, 'POST', '5KB body -> 413', () => R('POST', `/api/${route}`, { body: { message: 'x', pad: 'A'.repeat(5000) } }), [413, 429]);
    let last = 0; for (let i = 0; i < 14; i++) last = (await t(route, 'POST', `rate probe ${i}`, () => R('POST', `/api/${route}`, { body: { message: 'x' }, headers: { 'x-forwarded-for': '192.0.2.77' }, ip: '192.0.2.77' }), 'lt500')).status;
    rows.push({ route, method: 'POST', name: 'per-visitor report limit (10/min) enforced', expected: '429', actual: String(last), pass: last === 429 });
    await t(route, 'DELETE', 'DELETE not allowed', () => R('DELETE', `/api/${route}`), 405);

    const rq = 'quests';
    const qb = { title: 'T', description: 'D', type: 'custom', rewardLabel: 'R' };
    await cookieMatrix(rq, 'POST', 'admin', (c, x) => R('POST', `/api/${rq}`, { cookie: c, body: qb, ...x }), adminCookie);
    await t(rq, 'POST', 'partner cookie -> 401', () => R('POST', `/api/${rq}`, { cookie: partnerCookie, body: qb }), 401);
    await fuzz({ route: rq, send: (o) => R('POST', `/api/${rq}`, { cookie: adminCookie, ...o }), valid: () => qb, fields: { title: 'string', description: 'string', type: 'string', rewardLabel: 'string', maxCompletions: 'any', expiresAt: 'any' }, required: ['title', 'description', 'type', 'rewardLabel'] });
    await t(rq, 'POST', 'admin valid create', () => R('POST', `/api/${rq}`, { cookie: adminCookie, body: qb }), 201);
    for (const v of ['abc', {}, [], -1, 1e308, 'NaN']) await t(rq, 'POST', `expiresAt = ${JSON.stringify(v)}`, () => R('POST', `/api/${rq}`, { cookie: adminCookie, body: { ...qb, expiresAt: v } }), 'lt500');
    for (const v of ['abc', {}, -1, 1e308, 1.5]) await t(rq, 'POST', `maxCompletions = ${JSON.stringify(v)}`, () => R('POST', `/api/${rq}`, { cookie: adminCookie, body: { ...qb, maxCompletions: v } }), 'lt500');
    const list = await t(rq, 'GET', 'list after creates', () => R('GET', `/api/${rq}`), 200);
    const qid = list.json?.quests?.[0]?.id as string | undefined;
    if (qid) {
      const qs = 'quests/[id]/submit', qr = 'quests/[id]/review';
      const w = mkWallet(), tk = session(w);
      await t(qs, 'POST', 'valid submit', () => R('POST', `/api/quests/${qid}/submit`, { bearer: bearer(tk), body: { proof: 'https://x' } }), 201, { id: qid });
      await t(qs, 'POST', 'idempotent re-submit', () => R('POST', `/api/quests/${qid}/submit`, { bearer: bearer(tk), body: { proof: 'https://x' } }), 200, { id: qid });
      await fuzz({ route: qs, params: { id: qid }, send: (o) => R('POST', `/api/quests/${qid}/submit`, { bearer: bearer(session(mkWallet())), ...o }), valid: () => ({ proof: 'p' }), fields: { proof: 'string' }, required: ['proof'] }).catch(() => {});
      await cookieMatrix(qr, 'GET', 'admin', (c, x) => R('GET', `/api/quests/${qid}/review`, { cookie: c, ...x }), adminCookie, { id: qid });
      await cookieMatrix(qr, 'POST', 'admin', (c, x) => R('POST', `/api/quests/${qid}/review`, { cookie: c, body: { wallet: w.addr, approve: true }, ...x }), adminCookie, { id: qid });
      await t(qr, 'POST', 'admin approves', () => R('POST', `/api/quests/${qid}/review`, { cookie: adminCookie, body: { wallet: w.addr, approve: true } }), 200, { id: qid });
      for (const [n, b] of [['wallet number', { wallet: 7, approve: true }], ['wallet null', { wallet: null }], ['wallet object', { wallet: {} }], ['approve string', { wallet: w.addr, approve: 'false' }], ['wallet missing', { approve: true }], ['wallet 70KB', { wallet: 'A'.repeat(70000), approve: true }]] as const)
        await t(qr, 'POST', `review ${n}`, () => R('POST', `/api/quests/${qid}/review`, { cookie: adminCookie, body: b }), n === 'approve string' ? 'lt500' : '4xx', { id: qid });
      await t(qr, 'POST', 'review body JSON null', () => R('POST', `/api/quests/${qid}/review`, { cookie: adminCookie, raw: 'null' }), '4xx', { id: qid });
      await t(qr, 'POST', 'review invalid JSON', () => R('POST', `/api/quests/${qid}/review`, { cookie: adminCookie, raw: '{' }), 400, { id: qid });
      await t(qs, 'POST', 'submit proof number', () => R('POST', `/api/quests/${qid}/submit`, { bearer: bearer(session(mkWallet())), body: { proof: 7 } }), '4xx', { id: qid });
      await t(qs, 'POST', 'submit body JSON null', () => R('POST', `/api/quests/${qid}/submit`, { bearer: bearer(session(mkWallet())), raw: 'null' }), '4xx', { id: qid });
      await t(qs, 'POST', 'submit proof 2001 chars', () => R('POST', `/api/quests/${qid}/submit`, { bearer: bearer(session(mkWallet())), body: { proof: 'A'.repeat(2001) } }), 400, { id: qid });
    }
  }
}

// ═══════════ shared-secret routes ═══════════
console.log('secret-header routes ...');
{
  const secretMatrix = async (route: string, method: string, header: 'x-admin-token' | 'x-admin-secret' | 'bearer', good: string, mk: (h: Record<string, string>, extra?: Opts) => Request, okExpect: Expect, params?: Record<string, string>) => {
    const H = (v: string) => header === 'bearer' ? { authorization: `Bearer ${v}` } : { [header]: v };
    await t(route, method, 'secret: valid', () => mk(H(good)), okExpect, params);
    for (const [n, v] of [['empty', ''], ['wrong', 'wrong-secret-0123456789abcdef'], ['prefix of real', good.slice(0, -1)], ['real + extra char', good + 'x'], ['5000 chars', 'A'.repeat(5000)], ['unicode', '\u{1D54F}'.repeat(20)], ['same length, last char differs', good.slice(0, -1) + (good.endsWith('f') ? 'e' : 'f')], ['upper-cased', good.toUpperCase()]] as const)
      await t(route, method, `secret: ${n}`, () => mk(H(v)), header === 'bearer' && n === 'empty' ? 401 : 401, params);
    await t(route, method, 'secret: header absent', () => mk({}), 401, params);
    if (header !== 'bearer') await t(route, method, 'secret in query string instead of header', () => mk({}, { query: `?token=${good}&secret=${good}` }), method === 'GET' && route === 'waitlist/diag' ? 'lt500' : [400, 401], params);
    await t(route, method, 'secret: ranked player Bearer instead', () => mk({ authorization: bearer(tokP) }), 401, params);
  };
  await secretMatrix('admin', 'GET', 'x-admin-secret', process.env.ADMIN_SECRET!, (h, x) => R('GET', '/api/admin', { headers: h, ...x }), 200);
  await secretMatrix('admin', 'POST', 'x-admin-secret', process.env.ADMIN_SECRET!, (h, x) => R('POST', '/api/admin', { headers: h, body: { vault: { lastUpdate: 1 } }, ...x }), 200);
  for (const [n, raw] of [['body null', 'null'], ['body invalid JSON', '{'], ['body array', '[]'], ['body string', '"x"'], ['patch.vault string', '{"vault":"abc"}'], ['patch.vault number', '{"vault":5}'], ['__proto__', '{"__proto__":{"polluted":1},"vault":{"__proto__":{"polluted2":1}}}'], ['70KB', JSON.stringify({ vault: { x: 'A'.repeat(70000) } })]] as const)
    await t('admin', 'POST', `valid secret, ${n}`, () => R('POST', '/api/admin', { headers: { 'x-admin-secret': process.env.ADMIN_SECRET! }, raw }), n.startsWith('patch') || n === '__proto__' ? 'lt500' : '4xx');
  rows.push({ route: 'admin', method: 'POST', name: 'Object.prototype not polluted by __proto__ patch', expected: 'undefined', actual: String(({} as Record<string, unknown>).polluted ?? ({} as Record<string, unknown>).polluted2), pass: ({} as Record<string, unknown>).polluted === undefined && ({} as Record<string, unknown>).polluted2 === undefined });
  for (const m of ['PUT', 'PATCH', 'DELETE']) await t('admin', m, `${m} -> 405`, () => R(m, '/api/admin', { headers: { 'x-admin-secret': process.env.ADMIN_SECRET! }, body: {} }), 405);
  // lockout: 10 attempts / 15 min / IP
  let lk = 0; for (let i = 0; i < 12; i++) lk = (await t('admin', 'GET', `brute-force probe ${i}`, () => R('GET', '/api/admin', { headers: { 'x-admin-secret': 'x'.repeat(20) }, ip: '192.0.2.200' }), 'lt500')).status;
  rows.push({ route: 'admin', method: 'GET', name: '12th wrong secret from one IP is rate limited', expected: '429', actual: String(lk), pass: lk === 429 });
  const lk2 = await t('admin', 'GET', 'correct secret from the locked IP is ALSO refused (every attempt counts)', () => R('GET', '/api/admin', { headers: { 'x-admin-secret': process.env.ADMIN_SECRET! }, ip: '192.0.2.200' }), 429);
  void lk2;

  await secretMatrix('admin/analytics', 'GET', 'x-admin-token', process.env.ADMIN_TOKEN!, (h, x) => R('GET', '/api/admin/analytics', { headers: h, ...x }), 200);
  await secretMatrix('waitlist/list', 'GET', 'x-admin-token', process.env.ADMIN_TOKEN!, (h, x) => R('GET', '/api/waitlist/list', { headers: h, ...x }), 200);
  await secretMatrix('waitlist/list', 'DELETE', 'x-admin-token', process.env.ADMIN_TOKEN!, (h, x) => R('DELETE', '/api/waitlist/list', { headers: h, query: '?email=zz@zz.zz', ...x }), [200, 500, 503]);
  await t('waitlist/list', 'DELETE', 'valid token, no email -> 400', () => R('DELETE', '/api/waitlist/list', { headers: { 'x-admin-token': process.env.ADMIN_TOKEN! } }), 400);
  await secretMatrix('waitlist/diag', 'GET', 'x-admin-token', process.env.ADMIN_TOKEN!, (h, x) => R('GET', '/api/waitlist/diag', { headers: h, ...x }), 200);
  await t('waitlist/diag', 'GET', 'valid token in ?token= query is accepted (token ends up in logs)', () => R('GET', '/api/waitlist/diag', { query: `?token=${process.env.ADMIN_TOKEN}` }), 401);
  await secretMatrix('cron/prize-watch', 'GET', 'bearer', process.env.CRON_SECRET!, (h, x) => R('GET', '/api/cron/prize-watch', { headers: h, ...x }), [200, 409, 424, 503]);
  await t('cron/prize-watch', 'GET', 'ADMIN_SECRET also accepted as cron secret (documented)', () => R('GET', '/api/cron/prize-watch', { headers: { authorization: `Bearer ${process.env.ADMIN_SECRET}` } }), [200, 409, 424, 503]);
  await t('cron/prize-watch', 'POST', 'POST -> 405', () => R('POST', '/api/cron/prize-watch', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), 405);
  await secretMatrix('leaderboard/recover', 'POST', 'bearer', process.env.ADMIN_SECRET!, (h, x) => R('POST', '/api/leaderboard/recover', { headers: h, ...x }), 200);
  await t('leaderboard/recover', 'POST', 'secret in URL rejected even if correct', () => R('POST', '/api/leaderboard/recover', { query: `?secret=${process.env.ADMIN_SECRET}` }), 400);
  await t('leaderboard/recover', 'GET', 'GET -> 405', () => R('GET', '/api/leaderboard/recover'), 405);
}

// ═══════════ account recovery (/api/auth/*) ═══════════
console.log('auth/* ...');
{
  const w = mkWallet(), ws = acctWalletCookie(w.addr);
  const acct = (action: string, wallet = w, issued = Date.now()) => { const m = core.walletChallenge(wallet.addr, action, issued); return { wallet: wallet.addr, message: m, signature: wallet.sign(m) }; };
  // challenge
  for (const [n, q, e] of [['manage', `?wallet=${w.addr}&action=manage`, 200], ['unbind:google', `?wallet=${w.addr}&action=unbind:google`, 200], ['migrate', `?wallet=${w.addr}&action=migrate:${P.addr}`, 200], ['bad action', `?wallet=${w.addr}&action=evil`, 400], ['no action', `?wallet=${w.addr}`, 400], ['no wallet', '?action=manage', 400], ['bad wallet', '?wallet=x&action=manage', 400], ['action 70KB', `?wallet=${w.addr}&action=${'a'.repeat(70000)}`, 400], ['migrate to bad wallet', `?wallet=${w.addr}&action=migrate:xx`, 400], ['action with newline', `?wallet=${w.addr}&action=manage%0AWallet:${P.addr}`, 400]] as [string, string, number][])
    await t('auth/challenge', 'GET', n, () => R('GET', '/api/auth/challenge', { query: q }), e);
  // wallet session
  const rw = 'auth/wallet';
  await t(rw, 'POST', 'valid manage signature -> cookie', () => R('POST', '/api/auth/wallet', { body: acct('manage') }), 200);
  const rep = acct('manage');
  await t(rw, 'POST', 'valid (first use)', () => R('POST', '/api/auth/wallet', { body: rep }), 200);
  await t(rw, 'POST', 'REPLAY of the same signed manage message within 10 min', () => R('POST', '/api/auth/wallet', { body: rep }), 401);
  await t(rw, 'POST', 'expired challenge (11 min)', () => R('POST', '/api/auth/wallet', { body: acct('manage', w, Date.now() - 11 * 60_000) }), 401);
  await t(rw, 'POST', 'future challenge (+2 min)', () => R('POST', '/api/auth/wallet', { body: acct('manage', w, Date.now() + 120_000) }), 401);
  await t(rw, 'POST', 'signed for another action (unbind:google) replayed as manage', () => R('POST', '/api/auth/wallet', { body: acct('unbind:google') }), 401);
  await t(rw, 'POST', 'signed by other wallet', () => R('POST', '/api/auth/wallet', { body: { ...acct('manage'), signature: mkWallet().sign('x') } }), 401);
  await t(rw, 'POST', "ranked sign-in message replayed here", () => { const m = rChallenge(w.addr); return R('POST', '/api/auth/wallet', { body: { wallet: w.addr, message: m, signature: w.sign(m) } }); }, 401);
  for (let i = 0; i < 6; i++) { const a = bs58.encode(randomBytes(32)); await t(rw, 'POST', `random (maybe off-curve) wallet #${i}`, () => R('POST', '/api/auth/wallet', { body: { wallet: a, message: core.walletChallenge(a, 'manage'), signature: bs58.encode(randomBytes(64)) } }), 401); }
  await fuzz({ route: rw, send: (o) => R('POST', '/api/auth/wallet', o), valid: () => acct('manage'), fields: { wallet: 'string', message: 'string', signature: 'string' }, required: ['wallet', 'message', 'signature'] });
  await t(rw, 'DELETE', 'DELETE clears cookies', () => R('DELETE', '/api/auth/wallet'), 200);
  const set = await t(rw, 'POST', 'cookie flags', () => R('POST', '/api/auth/wallet', { body: acct('manage') }), 200);
  const fl = set.res?.headers.getSetCookie().join(';') ?? '';
  rows.push({ route: rw, method: 'POST', name: 'wallet cookie: HttpOnly; Secure; SameSite=Lax; Path=/api/auth', expected: 'all', actual: fl.replace(/bb_acct_w=[^;]*/, 'bb_acct_w=<tok>').slice(0, 130), pass: /HttpOnly/i.test(fl) && /Secure/i.test(fl) && /SameSite=lax/i.test(fl) && /Path=\/api\/auth/.test(fl) });

  // cookie matrix on wallet-cookie routes
  const acctMatrix = async (route: string, method: string, mk: (cookie: string | undefined, extra?: Opts) => Request, kind: 'wallet' | 'recover') => {
    const nm = kind === 'wallet' ? acctHttp.COOKIE.wallet : acctHttp.COOKIE.recover;
    const good = kind === 'wallet' ? acctWalletCookie(w.addr) : acctRecoverCookie(w.addr);
    const val = decodeURIComponent(good.split('=')[1]);
    const [body, mac] = val.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ w: P.addr, p: 'password', s: 'x', m: null, e: Date.now() + 1e7 })).toString('base64url');
    for (const [n, c, e] of [
      ['no cookie', undefined, 401], ['garbage', `${nm}=garbage`, 401], ['payload swapped, mac kept', `${nm}=${forgedBody}.${mac}`, 401],
      ['validly sealed but expired', kind === 'wallet' ? acctWalletCookie(w.addr, Date.now() - 1000) : acctRecoverCookie(w.addr, 'password', Date.now() - 1000), 401],
      ['sealed under the wrong label', kind === 'wallet' ? acctWalletCookie(w.addr, Date.now() + 6e4, 'recover') : `${nm}=${encodeURIComponent(core.seal('wallet', { w: w.addr, p: 'password', s: 'x', m: null, e: Date.now() + 6e4 }))}`, 401],
      ['3-part value', `${nm}=${body}.${mac}.x`, 401], ['payload not JSON', `${nm}=${Buffer.from('zz').toString('base64url')}.${core.seal('wallet', {}).split('.')[1]}`, 401],
      ['e is a string', `${nm}=${encodeURIComponent(core.seal(kind, { w: w.addr, e: String(Date.now() + 1e6) }))}`, 401],
      ['malformed %-escape', `${nm}=%E0%A4%A`, 401], ['cookie 5000 chars', `${nm}=${'A'.repeat(5000)}`, 401],
    ] as [string, string | undefined, number][]) await t(route, method, `auth: ${n}`, () => mk(c), e);
    return good;
  };
  const wcGood = await acctMatrix('auth/codes', 'POST', (c, x) => R('POST', '/api/auth/codes', { cookie: c, body: {}, ...x }), 'wallet');
  await t('auth/codes', 'POST', 'valid wallet cookie -> 10 codes', () => R('POST', '/api/auth/codes', { cookie: wcGood }), 200);
  await acctMatrix('auth/email', 'POST', (c, x) => R('POST', '/api/auth/email', { cookie: c, body: { email: 'a@b.co', password: 'Str0ng-passw0rd!' }, ...x }), 'wallet');
  await fuzz({ route: 'auth/email', send: (o) => R('POST', '/api/auth/email', { cookie: acctWalletCookie(mkWallet().addr), ...o }), valid: () => ({ email: `u${randomBytes(4).toString('hex')}@example.com`, password: 'Str0ng-passw0rd!' }), fields: { email: 'string', password: 'string' }, required: ['email', 'password'] });
  await t('auth/email', 'POST', 'valid bind', () => R('POST', '/api/auth/email', { cookie: acctWalletCookie(w.addr), body: { email: 'real@example.com', password: 'Str0ng-passw0rd!' } }), 200);
  for (const [n, e, p] of [['password 257 chars', 'a@example.com', 'A1'.repeat(129)], ['password 5MB-ish 70KB', 'a@example.com', 'Ab1!'.repeat(17500)], ['email 255 chars', `${'a'.repeat(240)}@example.com`, 'Str0ng-passw0rd!'], ['email with newline', 'a@example.com\nbcc:x@y.zz', 'Str0ng-passw0rd!'], ['password common', 'a@example.com', 'passwordpassword'], ['password includes email local', 'johnsmith@example.com', 'johnsmith-123456'], ['password all same char', 'a@example.com', 'aaaaaaaaaaaa']] as const)
    await t('auth/email', 'POST', n, () => R('POST', '/api/auth/email', { cookie: acctWalletCookie(mkWallet().addr), body: { email: e, password: p } }), '4xx');
  // login (email+password)
  const rl = 'auth/login';
  await t(rl, 'POST', 'unknown email -> 401', () => R('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'whatever-pass' } }), 401);
  await t(rl, 'POST', 'right email wrong password -> 401', () => R('POST', '/api/auth/login', { body: { email: 'real@example.com', password: 'wrong-password-1' } }), 401);
  await t(rl, 'POST', 'valid login -> recovery cookie', () => R('POST', '/api/auth/login', { body: { email: 'real@example.com', password: 'Str0ng-passw0rd!' } }), 200);
  await t(rl, 'POST', 'email case/whitespace variants normalise', () => R('POST', '/api/auth/login', { body: { email: '  REAL@Example.com ', password: 'Str0ng-passw0rd!' } }), 200);
  await fuzz({ route: rl, send: (o) => R('POST', '/api/auth/login', o), valid: () => ({ email: 'real@example.com', password: 'Str0ng-passw0rd!' }), fields: { email: 'string', password: 'string' }, required: ['email', 'password'] });
  for (const [n, p] of [['257-char password', 'A'.repeat(257)], ['password with NUL', 'a\u0000b1111111111']] as const) await t(rl, 'POST', n, () => R('POST', '/api/auth/login', { body: { email: 'real@example.com', password: p } }), [400, 401]);
  // lockout after 10 failures per email (+ the earlier ones)
  let lockedAt = -1; for (let i = 0; i < 14; i++) { const r = await t(rl, 'POST', `lockout probe ${i}`, () => R('POST', '/api/auth/login', { body: { email: 'real@example.com', password: 'wrong-password-1' } }), 'lt500'); if (r.status === 423 && lockedAt < 0) lockedAt = i; }
  rows.push({ route: rl, method: 'POST', name: 'account locks after 10 failures (423)', expected: 'locked within 14', actual: String(lockedAt), pass: lockedAt >= 0 });
  await t(rl, 'POST', 'locked: even the right password is refused', () => R('POST', '/api/auth/login', { body: { email: 'real@example.com', password: 'Str0ng-passw0rd!' } }), 423);
  // codes/login
  const rcl = 'auth/codes/login';
  await t(rcl, 'POST', 'wrong code -> 401', () => R('POST', '/api/auth/codes/login', { body: { wallet: w.addr, code: 'ABCD-EFGH-JKMN-PQRS' } }), 401);
  await fuzz({ route: rcl, send: (o) => R('POST', '/api/auth/codes/login', o), valid: () => ({ wallet: mkWallet().addr, code: 'ABCD-EFGH-JKMN-PQRS' }), fields: { wallet: 'string', code: 'string' }, required: ['wallet', 'code'] });
  for (const c of ['ABCD-EFGH-JKMN-PQR0', 'abcdefghjkmnpqrs', 'A'.repeat(70000), '']) await t(rcl, 'POST', `code ${c.slice(0, 20)}`, () => R('POST', '/api/auth/codes/login', { body: { wallet: w.addr, code: c } }), c === 'abcdefghjkmnpqrs' ? 401 : 400);
  // use a real code, once
  const cc = await t('auth/codes', 'POST', 'setup: fresh codes', () => R('POST', '/api/auth/codes', { cookie: acctWalletCookie(w.addr) }), 200);
  const code = cc.json.codes[0] as string;
  await t(rcl, 'POST', 'valid code -> recovery cookie', () => R('POST', '/api/auth/codes/login', { body: { wallet: w.addr, code } }), 200);
  await t(rcl, 'POST', 'REPLAY of a used code -> 401', () => R('POST', '/api/auth/codes/login', { body: { wallet: w.addr, code } }), 401);
  await t(rcl, 'POST', 'older code list invalid after regenerate', async () => { await mods.get('auth/codes')!.POST(R('POST', '/api/auth/codes', { cookie: acctWalletCookie(w.addr) })); return R('POST', '/api/auth/codes/login', { body: { wallet: w.addr, code: cc.json.codes[1] } }); }, 401);
  // status
  await t('auth/status', 'GET', 'anonymous', () => R('GET', '/api/auth/status'), 200);
  await t('auth/status', 'GET', 'wallet cookie', () => R('GET', '/api/auth/status', { cookie: acctWalletCookie(w.addr) }), 200);
  await t('auth/status', 'GET', 'forged cookie treated as signed out', () => R('GET', '/api/auth/status', { cookie: `${acctHttp.COOKIE.wallet}=x.y` }), 200);
  await t('auth/status', 'GET', 'malformed %-escape in cookie', () => R('GET', '/api/auth/status', { cookie: `${acctHttp.COOKIE.wallet}=%E0%A4%A` }), 200);
  await t('auth/status', 'GET', 'malformed %-escape in recover cookie', () => R('GET', '/api/auth/status', { cookie: `${acctHttp.COOKIE.recover}=%` }), 200);
  // unbind
  const ru = 'auth/unbind';
  await t(ru, 'POST', 'unbind unbound google -> 404', () => R('POST', '/api/auth/unbind', { body: { ...acct('unbind:google'), provider: 'google' } }), 404);
  await t(ru, 'POST', 'signature for the wrong provider -> 401', () => R('POST', '/api/auth/unbind', { body: { ...acct('unbind:google'), provider: 'password' } }), 401);
  await t(ru, 'POST', 'signature for manage replayed as unbind -> 401', () => R('POST', '/api/auth/unbind', { body: { ...acct('manage'), provider: 'codes' } }), 401);
  await t(ru, 'POST', 'someone ELSE signs, victim wallet in body -> 401', () => R('POST', '/api/auth/unbind', { body: { ...acct('unbind:password', mkWallet()), wallet: w.addr, provider: 'password' } }), 401);
  await fuzz({ route: ru, send: (o) => R('POST', '/api/auth/unbind', o), valid: () => ({ ...acct('unbind:password'), provider: 'password' }), fields: { wallet: 'string', provider: 'string', message: 'string', signature: 'string' }, required: ['wallet', 'provider', 'message', 'signature'] });
  for (const pv of ['__proto__', 'constructor', 'GOOGLE', 'google ', 'toString']) await t(ru, 'POST', `provider ${pv}`, () => R('POST', '/api/auth/unbind', { body: { ...acct('unbind:google'), provider: pv } }), 400);
  // unbind REPLAY demonstration: bind email, unbind with signature, rebind, replay signature
  {
    const x = mkWallet();
    const bindE = () => R('POST', '/api/auth/email', { cookie: acctWalletCookie(x.addr), body: { email: `${randomBytes(3).toString('hex')}@example.com`, password: 'Str0ng-passw0rd!' } });
    await t('auth/email', 'POST', 'setup: bind', bindE, 200);
    const ub = { ...acct('unbind:password', x), provider: 'password' };
    await t(ru, 'POST', 'unbind (first use)', () => R('POST', '/api/auth/unbind', { body: ub }), 200);
    await t('auth/email', 'POST', 'setup: bind again', bindE, 200);
    await t(ru, 'POST', 'REPLAY of the captured unbind signature after re-binding', () => R('POST', '/api/auth/unbind', { body: ub }), 401);
  }
  // recover
  const rr = 'auth/recover';
  const oldW = mkWallet(), newW = mkWallet();
  const rcv = acctRecoverCookie(oldW.addr);
  const mig = (issued = Date.now(), signer = newW, wallet = newW, action = `migrate:${oldW.addr}`) => { const m = core.walletChallenge(wallet.addr, action, issued); return { wallet: wallet.addr, message: m, signature: signer.sign(m) }; };
  await acctMatrix(rr, 'POST', (c, x) => R('POST', '/api/auth/recover', { cookie: c, body: mig(), ...x }), 'recover');
  await t(rr, 'POST', 'wallet cookie (not recover) is not enough', () => R('POST', '/api/auth/recover', { cookie: acctWalletCookie(oldW.addr), body: mig() }), 401);
  await t(rr, 'POST', 'signature for a different old wallet', () => R('POST', '/api/auth/recover', { cookie: rcv, body: mig(Date.now(), newW, newW, `migrate:${P.addr}`) }), 401);
  await t(rr, 'POST', 'same wallet as old -> 401/400', () => R('POST', '/api/auth/recover', { cookie: rcv, body: mig(Date.now(), oldW, oldW) }), [400, 401]);
  await t(rr, 'POST', 'expired challenge', () => R('POST', '/api/auth/recover', { cookie: rcv, body: mig(Date.now() - 11 * 60_000) }), 401);
  await fuzz({ route: rr, send: (o) => R('POST', '/api/auth/recover', { cookie: rcv, ...o }), valid: () => mig(), fields: { wallet: 'string', message: 'string', signature: 'string' }, required: ['wallet', 'message', 'signature'] });
  await t(rr, 'POST', 'valid migration (nothing bound -> refused or ok, never 5xx)', () => R('POST', '/api/auth/recover', { cookie: rcv, body: mig() }), 'lt500');
  // passkey
  const po = 'auth/passkey/options';
  await t(po, 'POST', 'recover mode (anonymous)', () => R('POST', '/api/auth/passkey/options', { body: { mode: 'recover' } }), 200);
  await t(po, 'POST', 'bind mode without wallet cookie -> 401', () => R('POST', '/api/auth/passkey/options', { body: { mode: 'bind' } }), 401);
  await t(po, 'POST', 'bind mode with wallet cookie', () => R('POST', '/api/auth/passkey/options', { cookie: acctWalletCookie(w.addr), body: { mode: 'bind' } }), 200);
  for (const [n, raw] of [['empty body', ''], ['invalid json', '{'], ['mode object', '{"mode":{}}'], ['mode "bind" with forged cookie', '{"mode":"bind"}']] as const)
    await t(po, 'POST', n, () => R('POST', '/api/auth/passkey/options', { raw, cookie: n.includes('forged') ? `${acctHttp.COOKIE.wallet}=x.y` : undefined }), n.includes('forged') ? 401 : 200);
  const pr = 'auth/passkey/register', pl = 'auth/passkey/login';
  await t(pr, 'POST', 'no wallet cookie -> 401', () => R('POST', '/api/auth/passkey/register', { body: {} }), 401);
  await t(pr, 'POST', 'wallet cookie, no challenge cookie -> 400', () => R('POST', '/api/auth/passkey/register', { cookie: acctWalletCookie(w.addr), body: {} }), 400);
  const opt = await t(po, 'POST', 'setup: bind challenge', () => R('POST', '/api/auth/passkey/options', { cookie: acctWalletCookie(w.addr), body: { mode: 'bind' } }), 200);
  const pkc = cookieOf(opt.res, acctHttp.COOKIE.passkey);
  const bindCk = `${acctWalletCookie(w.addr)}; ${pkc}`;
  for (const [n, b] of [['empty', {}], ['junk base64', { clientDataJSON: 'AAAA', attestationObject: 'AAAA' }], ['non-strings', { clientDataJSON: 5, attestationObject: {} }], ['70KB blobs', { clientDataJSON: 'A'.repeat(70000), attestationObject: 'A'.repeat(70000) }], ['CBOR bomb-ish', { clientDataJSON: Buffer.from('{"type":"webauthn.create","challenge":"x","origin":"https://x"}').toString('base64url'), attestationObject: Buffer.from('bf'.repeat(10000), 'hex').toString('base64url') }]] as const)
    await t(pr, 'POST', `register ${n}`, () => R('POST', '/api/auth/passkey/register', { cookie: bindCk, body: b }), 400);
  await t(pr, 'POST', "register with another wallet's challenge cookie -> 400", () => R('POST', '/api/auth/passkey/register', { cookie: `${acctWalletCookie(mkWallet().addr)}; ${pkc}`, body: {} }), 400);
  await t(pl, 'POST', 'no challenge cookie -> 400', () => R('POST', '/api/auth/passkey/login', { body: {} }), 400);
  const ropt = await t(po, 'POST', 'setup: recover challenge', () => R('POST', '/api/auth/passkey/options', { body: { mode: 'recover' } }), 200);
  const rck = cookieOf(ropt.res, acctHttp.COOKIE.passkey);
  for (const [n, b] of [['no id', {}], ['id too short', { id: 'abc' }], ['id with spaces', { id: 'a b'.repeat(10) }], ['id 1401 chars', { id: 'a'.repeat(1401) }], ['unknown credential', { id: 'a'.repeat(30), clientDataJSON: 'AAAA', authenticatorData: 'AAAA', signature: 'AAAA' }], ['non-string fields', { id: 'a'.repeat(30), clientDataJSON: {}, authenticatorData: [], signature: 5 }]] as const)
    await t(pl, 'POST', `login ${n}`, () => R('POST', '/api/auth/passkey/login', { cookie: rck, body: b }), [400, 401]);
  await t(pl, 'POST', 'bind-mode challenge cookie rejected for login', () => R('POST', '/api/auth/passkey/login', { cookie: pkc, body: { id: 'a'.repeat(30) } }), 400);
  await t(pl, 'POST', 'forged passkey cookie', () => R('POST', '/api/auth/passkey/login', { cookie: `${acctHttp.COOKIE.passkey}=a.b`, body: { id: 'a'.repeat(30) } }), 400);
  // google
  await t('auth/google/start', 'GET', 'unconfigured -> 404', () => R('GET', '/api/auth/google/start', { query: '?mode=bind' }), 404);
  await t('auth/google/callback', 'GET', 'unconfigured -> 404', () => R('GET', '/api/auth/google/callback', { query: '?code=x&state=y' }), 404);
  // wrong methods
  for (const r of ['auth/codes', 'auth/email', 'auth/login', 'auth/recover', 'auth/unbind', 'auth/passkey/register', 'auth/passkey/login', 'auth/passkey/options', 'auth/codes/login']) await t(r, 'GET', 'GET not allowed', () => R('GET', `/api/${r}`), 405);
}

// ═══════════ public / legacy routes ═══════════
console.log('public routes ...');
{
  await t('health', 'GET', 'GET', () => R('GET', '/api/health'), 200);
  await t('health', 'POST', 'POST not allowed', () => R('POST', '/api/health', { body: {} }), 405);
  await t('prizepool', 'GET', 'GET (RPC blocked) -> 200 with source:error, no URL leak', () => R('GET', '/api/prizepool'), 200);
  for (const [n, id, e] of [['1', '1', 200], ['0', '0', 400], ['-1', '-1', 400], ['999999999', '999999999', 400], ['NaN', 'abc', 400], ['1abc (parseInt prefix)', '1abc', 200], ['1e3', '1e3', 200], ['70KB', '9'.repeat(70000), 400], ['unicode', '%F0%9D%95%8F', 400]] as [string, string, number][])
    await t('levels/[id]', 'GET', `level ${n}`, () => R('GET', `/api/levels/${id}`), e, { id });
  await t('levels/[id]', 'GET', 'player param 70KB', () => R('GET', '/api/levels/1', { query: `?player=${'x'.repeat(70000)}` }), 'lt500', { id: '1' });
  for (const [n, k, e] of [['winners', 'winners', 200], ['acts', 'acts', 200], ['unknown', 'x', 404], ['__proto__', '__proto__', 404], ['constructor', 'constructor', 404], ['70KB', 'a'.repeat(70000), 404]] as [string, string, number][]) await t('list/[kind]', 'GET', n, () => R('GET', `/api/list/${k}`), e, { kind: k });
  for (const [n, l, e] of [['en', 'en', 200], ['id', 'id', 200], ['xx falls back to en', 'xx', 200], ['__proto__', '__proto__', 200], ['70KB', 'a'.repeat(70000), 200]] as [string, string, number][]) await t('i18n/[lang]', 'GET', n, () => R('GET', `/api/i18n/${l}`), e, { lang: l });
  for (const [n, q] of [['default', ''], ['limit=0', '?limit=0'], ['limit=-5', '?limit=-5'], ['limit=1e9', '?limit=1000000000'], ['limit=NaN', '?limit=abc'], ['limit=1.5', '?limit=1.5'], ['period=daily', '?period=daily'], ['period=__proto__', '?period=__proto__']] as const) await t('leaderboard', 'GET', n, () => R('GET', '/api/leaderboard', { query: q }), 200);
  for (const q of ['', `?wallet=${P.addr}`, '?wallet=x', `?wallet=${'1'.repeat(70000)}`]) await t('adventure/leaderboard', 'GET', `wallet ${q.slice(0, 20) || '(none)'}`, () => R('GET', '/api/adventure/leaderboard', { query: q }), 200);
  await t('waitlist/count', 'GET', 'GET', () => R('GET', '/api/waitlist/count'), 200);
  // waitlist POST
  {
    const route = 'waitlist';
    await t(route, 'POST', 'valid email', () => R('POST', '/api/waitlist', { body: { email: 'new@example.com' } }), 200);
    await t(route, 'POST', 'duplicate -> 409', () => R('POST', '/api/waitlist', { body: { email: 'new@example.com' } }), 409);
    await fuzz({ route, send: (o) => R('POST', '/api/waitlist', o), valid: () => ({ email: `u${randomBytes(4).toString('hex')}@example.com` }), fields: { email: 'string' }, required: ['email'] });
    for (const e of ['@', 'a@', ' @ ', 'a@b', 'a b@c.d', '<script>@x.y', 'a@b.c\r\nBcc: x@y.z', 'x'.repeat(260) + '@a.b', '@'.repeat(300)]) await t(route, 'POST', `weak validation: ${JSON.stringify(e).slice(0, 36)}`, () => R('POST', '/api/waitlist', { body: { email: e } }), '4xx');
    await t(route, 'GET', 'GET not allowed', () => R('GET', '/api/waitlist'), 405);
  }
  {
    const route = 'partnership-lead';
    const v = () => ({ email: `l${randomBytes(3).toString('hex')}@example.com`, project: 'Proj', notes: 'hi' });
    await t(route, 'POST', 'valid', () => R('POST', '/api/partnership-lead', { body: v() }), 200);
    await fuzz({ route, send: (o) => R('POST', '/api/partnership-lead', o), valid: v, fields: { email: 'string', project: 'string', notes: 'string' }, required: ['email', 'project'] });
    await t(route, 'POST', 'notes 100KB is truncated, not rejected', () => R('POST', '/api/partnership-lead', { body: { ...v(), notes: 'A'.repeat(100_000) } }), 'lt500');
    await t(route, 'POST', '300KB body accepted? (no size cap)', () => R('POST', '/api/partnership-lead', { body: { ...v(), pad: 'A'.repeat(300_000) } }), '4xx');
  }
  for (const [route, mkv, fields, required] of [
    ['track', () => ({ path: '/x', sid: 'abc' }), { path: 'string', sid: 'string' }, ['path']],
    ['wallet-connect', () => ({ path: '/x', anon: 'a', walletName: 'Phantom' }), { path: 'string', anon: 'string', walletName: 'string' }, ['path']],
  ] as const) {
    await t(route, 'POST', 'valid', () => R('POST', `/api/${route}`, { body: mkv() }), 200);
    await fuzz({ route, send: (o) => R('POST', `/api/${route}`, o), valid: mkv, fields: fields as Record<string, Kind>, required: [...required] });
    await t(route, 'POST', 'path not starting with / -> 400', () => R('POST', `/api/${route}`, { body: { path: 'x' } }), 400);
    await t(route, 'POST', 'path 201 chars -> 400', () => R('POST', `/api/${route}`, { body: { path: '/' + 'a'.repeat(200) } }), 400);
  }
  // score/sign + redeem (signature-only, no auth)
  {
    const route = 'score/sign';
    const s64 = (b58: string) => Buffer.from(bs58.decode(b58)).toString('base64'); // lib/sig.ts verifies base64
    const w = mkWallet();
    const msg = (lvl: number, sc: number, ts = Date.now()) => `blockbite:score:${w.addr}:${lvl}:${sc}:${ts}`;
    const body = (lvl = 1, sc = 10, ts = Date.now()) => ({ level: lvl, score: sc, message: msg(lvl, sc, ts), signature: s64(w.sign(msg(lvl, sc, ts))) });
    await t(route, 'POST', 'valid', () => R('POST', '/api/score/sign', { body: body() }), 200);
    await t(route, 'POST', 'REPLAY of same signed message (within 5 min)', () => R('POST', '/api/score/sign', { body: body() }), 200);
    await t(route, 'POST', 'expired (6 min old)', () => R('POST', '/api/score/sign', { body: body(1, 10, Date.now() - 6 * 60_000) }), 400);
    await t(route, 'POST', 'future timestamp year 3000 (never expires)', () => R('POST', '/api/score/sign', { body: body(1, 10, 32503680000000) }), 400);
    await t(route, 'POST', 'phone clock 3 min fast (legit)', () => R('POST', '/api/score/sign', { body: body(1, 10, Date.now() + 3 * 60_000) }), 200);
    await t(route, 'POST', 'timestamp 6 min in the future', () => R('POST', '/api/score/sign', { body: body(1, 10, Date.now() + 6 * 60_000) }), 400);
    await t(route, 'POST', 'level mismatch', () => R('POST', '/api/score/sign', { body: { ...body(), level: 2 } }), 400);
    await t(route, 'POST', 'bad signature', () => R('POST', '/api/score/sign', { body: { ...body(), signature: bs58.encode(randomBytes(64)) } }), 401);
    await t(route, 'POST', 'signature 1MB base58-ish', () => R('POST', '/api/score/sign', { body: { ...body(), signature: '1'.repeat(1_000_000) } }), 'lt500');
    await t(route, 'POST', 'player = off-curve random key', () => { const a = bs58.encode(randomBytes(32)); const m = `blockbite:score:${a}:1:10:${Date.now()}`; return R('POST', '/api/score/sign', { body: { level: 1, score: 10, message: m, signature: bs58.encode(randomBytes(64)) } }); }, 401);
    await fuzz({ route, send: (o) => R('POST', '/api/score/sign', o), valid: () => body(), fields: { level: 'number', score: 'number', message: 'string', signature: 'string' }, required: ['level', 'score', 'message', 'signature'] });
    const rd = 'redeem';
    const rb = (act = 1) => { const m = `blockbite:redeem:${w.addr}:act${act}`; return { addr: w.addr, act, sig: s64(w.sign(m)) }; };
    await t(rd, 'POST', 'valid', () => R('POST', '/api/redeem', { body: rb() }), 200);
    await t(rd, 'POST', 'signature replay (no nonce, KV absent)', () => R('POST', '/api/redeem', { body: rb() }), 200);
    await fuzz({ route: rd, send: (o) => R('POST', '/api/redeem', o), valid: () => rb(), fields: { addr: 'string', act: 'any', sig: 'string' }, required: ['addr', 'act', 'sig'] });
    for (const a of [0, 9, 1.5, -1, '1abc', '0x1', 1e308, '1e0', ' 1 ', true, [1]]) await t(rd, 'POST', `act = ${JSON.stringify(a)}`, () => R('POST', '/api/redeem', { body: { ...rb(), act: a } }), a === '1e0' || a === ' 1 ' || a === true || (Array.isArray(a)) ? 'lt500' : '4xx');
  }
  // versus challenge
  {
    const route = 'challenge';
    const seed = 'a'.repeat(32);
    await t(route, 'POST', 'bad seed -> 400', () => R('POST', '/api/challenge', { body: { seed: 'x', name: 'n', log: [[0, 0, 0]] } }), 400);
    const { SEED_RE } = await import('@/lib/versus/deal');
    const goodSeed = ['abcdef0123456789abcdef0123456789', 'a'.repeat(16), 'a'.repeat(64)].find((s) => SEED_RE.test(s)) ?? seed;
    await fuzz({ route, send: (o) => R('POST', '/api/challenge', o), valid: () => ({ seed: goodSeed, name: 'n', log: [[0, 0, 0]] }), fields: { seed: 'string', name: 'string', log: 'any' }, required: ['seed', 'name', 'log'] });
    for (const [n, log] of [['3001 moves', Array.from({ length: 3001 }, () => [0, 0, 0])], ['moves with 8', [[0, 0, 8]]], ['negative', [[-1, 0, 0]]], ['floats', [[0.5, 0, 0]]], ['strings', [['0', '0', '0']]], ['nested', [[[0], 0, 0]]], ['4 elems', [[0, 0, 0, 0]]], ['null move', [null]], ['3000 legal-shaped moves (CPU)', Array.from({ length: 3000 }, (_, i) => [i % 3, i % 8, (i * 3) % 8])]] as const)
      await t(route, 'POST', `log ${n}`, () => R('POST', '/api/challenge', { body: { seed: goodSeed, name: 'n', log } }), n.startsWith('3000') ? 'lt500' : '4xx');
    await t(route, 'POST', 'body JSON null', () => R('POST', '/api/challenge', { raw: 'null' }), 400);
    await t(route, 'POST', 'body 3MB', () => R('POST', '/api/challenge', { raw: JSON.stringify({ seed: goodSeed, name: 'n', log: [], pad: 'A'.repeat(3_000_000) }) }), '4xx');
    for (const id of ['x', 'a'.repeat(70000), '../x', '%00']) { await t('challenge/[id]', 'GET', `GET id ${id.slice(0, 12)}`, () => R('GET', `/api/challenge/${id}`), 200, { id }); await t('challenge/[id]', 'POST', `POST id ${id.slice(0, 12)}`, () => R('POST', `/api/challenge/${id}`, { body: { name: 'n', log: [[0, 0, 0]] } }), 404, { id }); }
  }
  // session start/submit (HMAC session, SESSION_SECRET captured at import)
  {
    const route = 'session/start';
    const w = mkWallet();
    const st = await t(route, 'POST', 'valid', () => R('POST', '/api/session/start', { body: { walletAddress: w.addr, level: 3 } }), 200);
    await fuzz({ route, send: (o) => R('POST', '/api/session/start', o), valid: () => ({ walletAddress: w.addr, level: 3 }), fields: { walletAddress: 'string', level: 'number' }, required: ['walletAddress'] });
    await t(route, 'POST', 'ANY wallet gets a token with no proof of ownership (documents the model)', () => R('POST', '/api/session/start', { body: { walletAddress: P.addr } }), 200);
    const tok = st.json.token as string;
    const sub = 'session/submit';
    const [sid, wal, iat, exp, nonce, sig] = Buffer.from(tok, 'base64url').toString().split('|');
    const SS = process.env.SESSION_SECRET!;
    const mk = (parts: string[]) => Buffer.from(parts.join('|')).toString('base64url');
    const hm = (p: string) => createHmac('sha256', SS).update(p).digest('hex');
    const sb = (token = tok, score: unknown = 10, level: unknown = 3, walletAddress = w.addr) => ({ token, score, level, walletAddress });
    await t(sub, 'POST', 'valid submit', () => R('POST', '/api/session/submit', { body: sb() }), 200);
    await t(sub, 'POST', 'REPLAY of the same token (nonce single-use)', () => R('POST', '/api/session/submit', { body: sb() }), 401);
    const fresh = async () => ((await t(route, 'POST', 'setup', () => R('POST', '/api/session/start', { body: { walletAddress: w.addr, level: 3 } }), 200)).json.token as string);
    await t(sub, 'POST', 'forged token (bad mac)', () => R('POST', '/api/session/submit', { body: sb(mk([sid, wal, iat, exp, nonce, 'a'.repeat(64)])) }), 401);
    await t(sub, 'POST', 'token with expiry extended', () => R('POST', '/api/session/submit', { body: sb(mk([sid, wal, iat, String(Number(exp) + 1e9), nonce, sig])) }), 401);
    await t(sub, 'POST', 'expired but validly MACed', () => { const p = `${sid}|${wal}|${iat}|${Date.now() - 1000}|${nonce}`; return R('POST', '/api/session/submit', { body: sb(mk([...p.split('|'), hm(p)])) }); }, 401);
    await t(sub, 'POST', 'legacy 5-part token', () => { const p = `${sid}|${wal}|${iat}|${exp}`; return R('POST', '/api/session/submit', { body: sb(mk([...p.split('|'), hm(p)])) }); }, 401);
    await t(sub, 'POST', 'wallet mismatch -> 403', async () => R('POST', '/api/session/submit', { body: sb(await fresh(), 10, 3, P.addr) }), 403);
    for (const [n, sc] of [['score -1', -1], ['score 1e308', 1e308], ['score huge > plausible', 1e9], ['score "abc" (NaN)', 'abc'], ['score {}', {}], ['score [5]', [5]], ['score "5"', '5'], ['score true', true], ['score 1.5', 1.5]] as [string, unknown][])
      await t(sub, 'POST', n, async () => R('POST', '/api/session/submit', { body: sb(await fresh(), sc) }), ['score "5"', 'score 1.5', 'score true', 'score [5]'].includes(n) ? 'lt500' : '4xx');
    for (const [n, lv] of [['level 0', 0], ['level -1', -1], ['level 1e308', 1e308], ['level "3"', '3'], ['level {}', {}], ['level null', null]] as [string, unknown][])
      await t(sub, 'POST', n, async () => R('POST', '/api/session/submit', { body: sb(await fresh(), 10, lv) }), 'lt500');
    await fuzz({ route: sub, send: (o) => R('POST', '/api/session/submit', o), valid: async () => sb(await fresh()), fields: { token: 'string', score: 'number', level: 'number', walletAddress: 'string' }, required: ['token', 'score', 'level', 'walletAddress'] });
    const t10 = await fresh();
    const hits = await Promise.all(Array.from({ length: 5 }, () => mods.get(sub)!.POST(R('POST', '/api/session/submit', { body: sb(t10) }))));
    rows.push({ route: sub, method: 'POST', name: '5 parallel submits of one token: exactly one 200', expected: '1x200', actual: `${hits.filter((r) => r.status === 200).length}x200 [${hits.map((r) => r.status).join(',')}]`, pass: hits.filter((r) => r.status === 200).length === 1 && hits.every((r) => r.status < 500) });
  }
}

// ── summary ─────────────────────────────────────────────────────────
const out = process.env.QA_OUT ?? 'qa-api-fuzz-results.json';
writeFileSync(out, JSON.stringify(rows, null, 1));
const failed = rows.filter((r) => !r.pass);
const blocked = (globalThis as { __blockedFetch?: string[] }).__blockedFetch ?? [];
console.log(`\n${rows.length} cases, ${rows.length - failed.length} as expected, ${failed.length} unexpected`);
console.log(`outbound fetches blocked: ${blocked.length} (${[...new Set(blocked.map((u) => new URL(u).host))].join(', ')})`);
const by: Record<string, number> = {};
for (const r of rows) by[r.actual] = (by[r.actual] ?? 0) + 1;
console.log('status histogram', JSON.stringify(by));
for (const r of failed) console.log(`UNEXPECTED ${r.method} ${r.route} | ${r.name} | expected ${r.expected} got ${r.actual}${r.note ? ` | ${r.note}` : ''}`);
process.exit(0);
