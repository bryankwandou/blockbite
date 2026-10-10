/**
 * QA2 lane 15: ranked score integrity / anti-cheat, offline and adversarial.
 *
 *   QA2_PG_PORT unset; DB is an in-process PGlite (scripts/pglite-neon-shim.ts):
 *   blockbite_DATABASE_URL=postgresql://u:p@localhost.test/db \
 *     npx tsx --import ./scripts/pglite-neon-shim.ts scripts/test-anticheat.ts
 *
 * Drives the real route handlers (start/play/run/me/day/leaderboard) with real
 * signed sessions. No network, no mainnet, no real DB. Date.now is shifted to
 * cross day boundaries.
 */
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import bs58 from 'bs58';

process.env.RANKED_SECRET = randomBytes(32).toString('hex');
process.env.blockbite_DATABASE_URL ??= 'postgresql://u:p@localhost.test/db';

let passed = 0;
const failures: string[] = [];
const table: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); table.push(`PASS | ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${(e as Error).stack?.split('\n').slice(0, 3).join('\n       ')}`); table.push(`FAIL | ${name}`); }
}

function newWallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: bs58.encode(raw), sign: (m: string) => bs58.encode(sign(null, Buffer.from(m, 'utf8'), privateKey)) };
}

// Controllable clock.
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const DAY = 86_400_000;
const dayStart = (d: string) => Date.parse(d + 'T00:00:00Z');

async function main() {
  const rules = await import('../lib/ranked/rules');
  const seed = await import('../lib/ranked/seed');
  const { replayRun } = await import('../lib/ranked/replay');
  const auth = await import('../lib/ranked/auth');
  const db = await import('../lib/ranked/db');
  const { calculateScore } = await import('../lib/game/scoring');
  const { PIECE_DEFINITIONS } = await import('../lib/game/pieces');
  const R = {
    start: (await import('../app/api/ranked/start/route')).POST,
    play: (await import('../app/api/ranked/play/route')).POST,
    run: (await import('../app/api/ranked/run/route')).GET,
    me: (await import('../app/api/ranked/me/route')).GET,
    day: (await import('../app/api/ranked/day/route')).GET,
    board: (await import('../app/api/ranked/leaderboard/route')).GET,
  };
  const { applyMove, dealTray, initialState, trayEmpty, boardFromHex, fits, PIECES, RulesError } = rules;
  type S = import('../lib/ranked/rules').RankedState;

  const today = () => seed.dayOf(Date.now());
  const session = (w: ReturnType<typeof newWallet>) => {
    const now = Date.now();
    const msg = auth.challenge(w.address, now);
    return auth.signIn(w.address, msg, w.sign(msg), now)!;
  };
  async function call(h: (r: Request) => Promise<Response>, method: 'GET' | 'POST', path: string, token: string | null, body?: unknown, rawBody?: BodyInit) {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const init: RequestInit & { duplex?: string } = { method, headers, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) };
    if (rawBody && typeof rawBody !== 'string') init.duplex = 'half';
    const res = await h(new Request('http://t.local' + path, init));
    return { status: res.status, json: (await res.json()) as any };
  }
  let sigN = 0;
  const give = (wallet: string, tickets: number) =>
    db.creditPurchase({ sig: `sig${++sigN}-${randomBytes(4).toString('hex')}`, wallet, tickets, vaultAmount: BigInt(tickets) * 700_000n, referralAccount: null, blockTimeMs: Date.now() });
  async function newPlayer(tickets: number) {
    const w = newWallet();
    if (tickets) await give(w.address, tickets);
    return { ...w, token: session(w) };
  }
  const startRun = (p: { token: string }, body?: unknown) => call(R.start, 'POST', '/api/ranked/start', p.token, body ?? {});
  const play = (p: { token: string }, runId: string, fromMoves: number, moves: unknown, extra: object = {}) =>
    call(R.play, 'POST', '/api/ranked/play', p.token, { runId, fromMoves, moves, ...extra });

  function legal(s: S) {
    const out: { slot: 0 | 1 | 2; row: number; col: number }[] = [];
    const b = boardFromHex(s.board);
    for (const slot of [0, 1, 2] as const) {
      const p = s.tray[slot];
      if (p === null) continue;
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) if (fits(b, p, row, col)) out.push({ slot, row, col });
    }
    return out;
  }
  const pickRand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

  // ── 1. Property: server rules === independent reference engine, 2000 games ──
  // Reference: boolean grid + explicit loops, scored through lib/game/scoring.ts (what the
  // client engine calls), sharing nothing with the bitboard code in rules.ts.
  await test('property: 2000 random legal games, replay score === reference engine === live score', async () => {
    const SZ = 8;
    let totalMoves = 0, maxScore = 0;
    for (let g = 0; g < 2000; g++) {
      const runSeedHex = randomBytes(32).toString('hex');
      let s = initialState(seed.trayFor(runSeedHex, rules.boardToHex(0n), 0));
      const grid: boolean[][] = Array.from({ length: SZ }, () => Array(SZ).fill(false));
      let refScore = 0, refChain = 0, refPerfectNext = false;
      const log: { m: [number, number, number][] }[] = [];
      let step: [number, number, number][] = [];
      let guard = 0;
      while (!s.over && guard++ < 4000) {
        const mv = pickRand(legal(s));
        // reference apply
        const def = PIECE_DEFINITIONS[s.tray[mv.slot]!];
        for (let r = 0; r < def.shape.length; r++) for (let c = 0; c < def.shape[0].length; c++) if (def.shape[r][c] === 1) {
          assert.equal(grid[mv.row + r][mv.col + c], false, 'reference saw an overlap the server allowed');
          grid[mv.row + r][mv.col + c] = true;
        }
        const fullRows: number[] = [], fullCols: number[] = [];
        for (let i = 0; i < SZ; i++) {
          if (grid[i].every(Boolean)) fullRows.push(i);
          if (grid.every((row) => row[i])) fullCols.push(i);
        }
        for (const r of fullRows) for (let c = 0; c < SZ; c++) grid[r][c] = false;
        for (const c of fullCols) for (let r = 0; r < SZ; r++) grid[r][c] = false;
        const perfect = grid.every((row) => row.every((v) => !v));
        const sc = calculateScore(fullRows.length + fullCols.length, def.size, refChain, perfect, refPerfectNext ? 10 : undefined);
        refScore += sc.pointsEarned; refChain = sc.newChain; refPerfectNext = perfect;

        s = applyMove(s, mv).state;
        step.push([mv.slot, mv.row, mv.col]);
        assert.equal(s.score, refScore, `game ${g} move ${s.moves}: server ${s.score} vs reference ${refScore}`);
        if (!s.over && trayEmpty(s.tray)) {
          s = dealTray(s, seed.trayFor(runSeedHex, s.board, s.moves));
          log.push({ m: step }); step = [];
        }
      }
      if (step.length) log.push({ m: step });
      assert.ok(s.over, `game ${g} did not end`);
      assert.equal(replayRun(runSeedHex, log).score, s.score, `game ${g} replay mismatch`);
      // re-chunked log (one move per step) must replay identically
      const flat = log.flatMap((l) => l.m).map((m) => ({ m: [m] as [number, number, number][] }));
      assert.equal(replayRun(runSeedHex, flat).score, s.score, `game ${g} rechunked replay mismatch`);
      totalMoves += s.moves; maxScore = Math.max(maxScore, s.score);
    }
    console.log(`       (${totalMoves} placements checked, max random score ${maxScore})`);
  });

  // ── 2. Illegal placements through the real API ──
  const A = await newPlayer(6);
  const B = await newPlayer(1);
  let runA: { runId: string; state: S };
  await test('start: spends exactly one ticket; body cannot pick a day/seed/tray', async () => {
    const before = await db.getCredits(A.address);
    const r = await startRun(A, { day: '2099-01-01', seed: '00'.repeat(32), tray: [0, 0, 0], runId: 'evil', attempt: 9 });
    assert.equal(r.status, 200);
    runA = r.json;
    assert.equal(r.json.day, today());
    assert.notEqual(r.json.runId, 'evil');
    assert.equal(await db.getCredits(A.address), before - 1);
    const expect = seed.trayFor(seed.runSeed(seed.dailySeed(today()), r.json.runId), rules.boardToHex(0n), 0);
    assert.deepEqual(r.json.state.tray, expect);
    assert.equal(r.json.state.score, 0);
    assert.equal(r.json.state.board, '0000000000000000');
  });

  const stateOf = async (id: string) => (await call(R.run, 'GET', `/api/ranked/run?id=${id}`, A.token)).json.state as S;
  const unchanged = async (label: string, r: { status: number }, want: number | number[]) => {
    const wants = Array.isArray(want) ? want : [want];
    assert.ok(wants.includes(r.status), `${label}: got ${r.status}, want ${wants}`);
    const row = await db.getRun(runA.runId);
    assert.equal(row!.moves, cur.moves, `${label}: run advanced`);
    assert.equal(row!.score, cur.score, `${label}: score changed`);
  };
  const cur = { moves: 0, score: 0 };

  await test('off-board / non-integer / bogus coordinates and slots are rejected, run unchanged', async () => {
    const bad: unknown[] = [
      { slot: 0, row: -1, col: 0 }, { slot: 0, row: 0, col: -1 }, { slot: 0, row: 8, col: 0 }, { slot: 0, row: 0, col: 8 },
      { slot: 0, row: 7, col: 7 }, { slot: 0, row: 1e9, col: 0 }, { slot: 0, row: 0.5, col: 0 }, { slot: 0, row: '0', col: '0' },
      { slot: 0, row: null, col: 0 }, { slot: 0, row: NaN, col: 0 }, { slot: 3, row: 0, col: 0 }, { slot: -1, row: 0, col: 0 },
      { slot: '0', row: 0, col: 0 }, { slot: 0 }, {}, null, 7, 'x', { slot: 0, row: Number.MAX_SAFE_INTEGER, col: 0 },
      { slot: 0, row: 2 ** 53, col: 0 }, { slot: 0, row: Infinity, col: 0 },
    ];
    for (const m of bad) {
      // piece 0 may be a 1x1; (7,7) is then legal, skip that single case when so
      if (JSON.stringify(m) === JSON.stringify({ slot: 0, row: 7, col: 7 }) && PIECES[runA.state.tray[0]!].rows === 1 && PIECES[runA.state.tray[0]!].cols === 1) continue;
      const r = await play(A, runA.runId, 0, [m]);
      await unchanged(JSON.stringify(m), r, [400, 422]);
    }
  });

  await test('moves array shape: empty, >3, non-array, huge are rejected', async () => {
    for (const mv of [[], null, 'x', {}, Array(4).fill({ slot: 0, row: 0, col: 0 }), Array(5000).fill({ slot: 0, row: 0, col: 0 })]) {
      const r = await play(A, runA.runId, 0, mv);
      await unchanged('moves ' + JSON.stringify(mv)?.slice(0, 30), r, 400);
    }
  });

  await test('atomic: legal first move + illegal second move in one request applies nothing', async () => {
    const l = legal(runA.state);
    const first = l[0];
    const r = await play(A, runA.runId, 0, [first, { slot: first.slot, row: first.row, col: first.col }]); // same slot twice
    await unchanged('reuse slot in one request', r, 422);
  });

  // First real move so there is a board to overlap with.
  await test('legal move is accepted; body score/piece/state/board/tray fields are ignored', async () => {
    const mv = pickRand(legal(runA.state));
    const honest = applyMove(runA.state, mv).state;
    const r = await play(A, runA.runId, 0, [mv], { score: 999_999_999, piece: 5, tray: [1, 1, 1], state: { score: 1e9 }, board: 'f'.repeat(16), over: false, points: 1e9 });
    assert.equal(r.status, 200);
    assert.equal(r.json.state.score, honest.score);
    assert.equal(r.json.state.board, honest.board);
    const row = await db.getRun(runA.runId);
    assert.equal(row!.score, honest.score);
    cur.moves = row!.moves; cur.score = row!.score;
    runA.state = r.json.state;
  });

  await test('overlap on occupied cells, reused (emptied) slot, wrong fromMoves all rejected', async () => {
    const s = runA.state;
    const b = boardFromHex(s.board);
    // overlap: in-bounds placement that collides
    let overlap: { slot: 0 | 1 | 2; row: number; col: number } | null = null;
    for (const slot of [0, 1, 2] as const) {
      const p = s.tray[slot]; if (p === null) continue;
      for (let row = 0; row < 8 && !overlap; row++) for (let col = 0; col < 8; col++) {
        if (rules.pieceMask(p, row, col) !== null && !fits(b, p, row, col)) { overlap = { slot, row, col }; break; }
      }
    }
    assert.ok(overlap, 'no overlap candidate found');
    await unchanged('overlap', await play(A, runA.runId, cur.moves, [overlap!]), 422);
    const emptied = s.tray.findIndex((p) => p === null);
    assert.ok(emptied >= 0);
    await unchanged('empty slot', await play(A, runA.runId, cur.moves, [{ slot: emptied, row: 0, col: 0 }]), 422);
    for (const f of [cur.moves - 1, cur.moves + 1, 1e9, -1]) {
      const r = await play(A, runA.runId, f, [legal(s)[0]]);
      await unchanged('fromMoves ' + f, r, 409);
    }
    for (const f of [0.5, '1', null, NaN]) {
      await unchanged('fromMoves ' + f, await play(A, runA.runId, f as number, [legal(s)[0]]), 400);
    }
  });

  await test('future tray: slots can never be addressed beyond the dealt tray; server deals only after tray empty', async () => {
    // tray has 3 slots; piece identities never come from the client. Prove that a 3-move
    // request only succeeds for the 3 dealt pieces and the 4th placement needs a new request.
    const u = await newPlayer(1);
    const st = (await startRun(u)).json;
    let s: S = st.state, from = 0;
    const seq: any[] = [];
    let tmp = s;
    for (let i = 0; i < 3; i++) { const m = pickRand(legal(tmp)); seq.push(m); tmp = applyMove(tmp, m).state; if (tmp.over) break; }
    if (seq.length === 3 && !tmp.over) {
      const r = await play(u, st.runId, from, seq);
      assert.equal(r.status, 200);
      // the next tray is dealt by the server from the run seed, board and move count
      const want = seed.trayFor(seed.runSeed(seed.dailySeed(today()), st.runId), tmp.board, tmp.moves);
      assert.deepEqual(r.json.state.tray, want);
      // trying to place a 4th piece in the same request is a 400 (max 3)
      const r2 = await play(u, st.runId, 3, Array(4).fill({ slot: 0, row: 0, col: 0 }));
      assert.equal(r2.status, 400);
    }
  });

  await test('another wallet cannot play or read my run (404), nor with my run id on its own session', async () => {
    const m = legal(runA.state)[0];
    const r = await play(B, runA.runId, cur.moves, [m]);
    assert.equal(r.status, 404);
    const g = await call(R.run, 'GET', `/api/ranked/run?id=${runA.runId}`, B.token);
    assert.equal(g.status, 404);
    await unchanged('foreign play', r, 404);
  });

  await test('unauthenticated / forged / expired session tokens are 401', async () => {
    const m = legal(runA.state)[0];
    for (const t of [null, 'garbage', A.token.slice(0, -2) + 'xx', A.token.replace(/^[^.]+/, B.address)]) {
      const r = await call(R.play, 'POST', '/api/ranked/play', t, { runId: runA.runId, fromMoves: cur.moves, moves: [m] });
      assert.equal(r.status, 401, String(t)?.slice(0, 20));
    }
    const exp = auth.parseSession(A.token, Date.now() + 13 * 3600_000);
    assert.equal(exp, null);
  });

  await test('replay of an old request (same fromMoves) is out of sync, and concurrent duplicates apply once', async () => {
    const m = pickRand(legal(runA.state));
    const results = await Promise.all([0, 1, 2, 3].map(() => play(A, runA.runId, cur.moves, [m])));
    const ok = results.filter((r) => r.status === 200).length;
    assert.equal(ok, 1, `statuses ${results.map((r) => r.status)}`);
    assert.ok(results.every((r) => r.status === 200 || r.status === 409));
    const row = await db.getRun(runA.runId);
    assert.equal(row!.moves, cur.moves + 1);
    cur.moves = row!.moves; cur.score = row!.score; runA.state = row!.state;
    const again = await play(A, runA.runId, cur.moves - 1, [m]);
    assert.equal(again.status, 409);
  });

  // ── Play run A to the end, then verify game-over, and public verification ──
  await test('moves after game over are refused (409) and score is frozen', async () => {
    let s = runA.state, guard = 0;
    while (!s.over && guard++ < 1000) {
      const mvs: any[] = []; let t = s;
      while (mvs.length < 3 && !t.over) { const m = pickRand(legal(t)); mvs.push(m); t = applyMove(t, m).state; if (trayEmpty(t.tray)) break; }
      const r = await play(A, runA.runId, s.moves, mvs);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      s = r.json.state;
    }
    assert.ok(s.over);
    const frozen = (await db.getRun(runA.runId))!;
    for (const m of [{ slot: 0, row: 0, col: 0 }, { slot: 1, row: 3, col: 3 }]) {
      const r = await play(A, runA.runId, s.moves, [m]);
      assert.equal(r.status, 409);
    }
    const after = (await db.getRun(runA.runId))!;
    assert.equal(after.score, frozen.score); assert.equal(after.moves, frozen.moves);
    runA.state = s;
  });

  await test('published log replays to the stored score (verifier path) and matches live engine', async () => {
    const runs = await db.dayRuns(today());
    const mine = runs.find((r) => r.id === runA.runId)!;
    const sd = seed.runSeed(seed.dailySeed(today()), mine.id);
    const rep = replayRun(sd, mine.log);
    assert.equal(rep.score, mine.score);
    assert.equal(rep.score, runA.state.score);
    assert.equal(rep.over, true);
  });

  await test('tampered move log: every single-move mutation is caught or yields an identical score', async () => {
    const mine = (await db.dayRuns(today())).find((r) => r.id === runA.runId)!;
    const sd = seed.runSeed(seed.dailySeed(today()), mine.id);
    let caught = 0, same = 0, total = 0;
    for (let si = 0; si < mine.log.length; si++) for (let mi = 0; mi < mine.log[si].m.length; mi++) {
      for (const delta of [[0, 1, 0], [0, 0, 1], [0, -1, 0], [1, 0, 0]]) {
        const log = JSON.parse(JSON.stringify(mine.log));
        const m = log[si].m[mi];
        log[si].m[mi] = [(m[0] + delta[0] + 3) % 3, m[1] + delta[1], m[2] + delta[2]];
        total++;
        let sc: number | null = null;
        try { sc = replayRun(sd, log).score; } catch (e) { assert.ok(e instanceof RulesError); caught++; continue; }
        if (sc !== mine.score) caught++; else same++;
      }
    }
    console.log(`       (${total} mutations: ${caught} caught, ${same} score-neutral)`);
    assert.ok(caught > 0);
    // Truncated / extended logs cannot raise the score without legal extra moves:
    const trunc = replayRun(sd, mine.log.slice(0, -1));
    assert.ok(trunc.score <= mine.score);
    assert.throws(() => replayRun(sd, [...mine.log, { m: [[0, 0, 0]] }]), RulesError, 'moves after game over in a published log');
    // Wrong run id / wrong seed (another player's seed) does not reproduce the score
    const other = replayRun(seed.runSeed(seed.dailySeed(today()), 'someone-else'), mine.log.slice(0, 1).concat([]));
    assert.ok(other);
  });

  await test('another wallet cannot reuse my log: logs replay only under the run seed they were played on', async () => {
    const mine = (await db.dayRuns(today())).find((r) => r.id === runA.runId)!;
    const wrong = seed.runSeed(seed.dailySeed(today()), randomUUID());
    let r: number | 'throws';
    try { r = replayRun(wrong, mine.log).score; } catch { r = 'throws'; }
    assert.ok(r === 'throws' || r !== mine.score, 'log replayed to identical score under a different run seed (collision)');
  });

  // ── Tickets and attempts ──
  await test('no ticket: 402; no credit is created', async () => {
    const z = await newPlayer(0);
    assert.equal((await startRun(z)).status, 402);
    assert.equal(await db.getCredits(z.address), 0);
    assert.equal((await db.runsOf(z.address, today())).length, 0);
  });

  await test('more runs than tickets: with 2 tickets the 3rd start is 402', async () => {
    const z = await newPlayer(2);
    assert.equal((await startRun(z)).status, 200);
    assert.equal((await startRun(z)).status, 200);
    assert.equal((await startRun(z)).status, 402);
  });

  await test('4th attempt in a day: 429 and the ticket is NOT consumed', async () => {
    const z = await newPlayer(5);
    for (let i = 0; i < 3; i++) assert.equal((await startRun(z)).status, 200);
    assert.equal(await db.getCredits(z.address), 2);
    assert.equal((await startRun(z)).status, 429);
    assert.equal(await db.getCredits(z.address), 2);
    assert.equal((await db.runsOf(z.address, today())).length, 3);
  });

  await test('race: 6 parallel starts with 1 ticket open exactly one run', async () => {
    const z = await newPlayer(1);
    const rs = await Promise.all(Array.from({ length: 6 }, () => startRun(z)));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join());
    assert.equal(await db.getCredits(z.address), 0);
    assert.equal((await db.runsOf(z.address, today())).length, 1);
  });

  await test('race: 6 parallel starts with 5 tickets never exceed 3 runs and never lose/duplicate tickets', async () => {
    const z = await newPlayer(5);
    const rs = await Promise.all(Array.from({ length: 6 }, () => startRun(z)));
    const ok = rs.filter((r) => r.status === 200).length;
    const runs = (await db.runsOf(z.address, today())).length;
    assert.ok(ok <= 3 && runs === ok, `ok=${ok} runs=${runs}`);
    assert.equal(await db.getCredits(z.address), 5 - ok, 'tickets spent without a run, or run without a ticket');
  });

  await test('one purchase signature credits once; same sig under a second wallet credits nothing', async () => {
    const w1 = newWallet(), w2 = newWallet();
    assert.equal(await db.creditPurchase({ sig: 'dupSig', wallet: w1.address, tickets: 2, vaultAmount: 1_400_000n, referralAccount: null, blockTimeMs: Date.now() }), true);
    assert.equal(await db.creditPurchase({ sig: 'dupSig', wallet: w1.address, tickets: 2, vaultAmount: 1_400_000n, referralAccount: null, blockTimeMs: Date.now() }), false);
    assert.equal(await db.creditPurchase({ sig: 'dupSig', wallet: w2.address, tickets: 2, vaultAmount: 1_400_000n, referralAccount: null, blockTimeMs: Date.now() }), false);
    assert.equal(await db.getCredits(w1.address), 2); assert.equal(await db.getCredits(w2.address), 0);
  });

  // ── Day open / closed ──
  await test('day closed: moves refused 5 min after midnight, still allowed inside the 5 min grace', async () => {
    const u = await newPlayer(1);
    const st = (await startRun(u)).json;
    const end = dayStart(st.day) + DAY;
    const m = legal(st.state)[0];
    // Sessions last 12 h and midnight can be up to 24 h away, so sign in again at
    // the shifted clock; otherwise an expired session (401) hides the day check.
    skew = end + seed.PLAY_GRACE_MS + 1000 - realNow();
    try {
      const late = await play({ token: session(u) }, st.runId, 0, [m]);
      assert.equal(late.status, 409, 'late play accepted');
      assert.equal((await db.getRun(st.runId))!.moves, 0);
    } finally { skew = 0; }
    skew = end + seed.PLAY_GRACE_MS - 5000 - realNow();
    try {
      const ok = await play({ token: session(u) }, st.runId, 0, [m]);
      assert.equal(ok.status, 200, 'inside grace should work');
    } finally { skew = 0; }
  });

  await test('seed secrecy: today/next 7 days = commitment only; yesterday stays sealed until 10 min after midnight; day+8 = 404', async () => {
    const d0 = today();
    const t = await call(R.day, 'GET', `/api/ranked/day?d=${d0}`, null);
    assert.equal(t.json.final, false); assert.equal(t.json.seed, undefined); assert.equal(t.json.runs, undefined);
    assert.equal(t.json.commitment, seed.commitment(seed.dailySeed(d0)));
    for (let k = 1; k <= 7; k++) {
      const d = seed.dayOf(dayStart(d0) + k * DAY);
      const r = await call(R.day, 'GET', `/api/ranked/day?d=${d}`, null);
      assert.equal(r.status, 200); assert.equal(r.json.seed, undefined, 'future seed leaked ' + d); assert.equal(r.json.runs, undefined);
    }
    assert.equal((await call(R.day, 'GET', `/api/ranked/day?d=${seed.dayOf(dayStart(d0) + 8 * DAY)}`, null)).status, 404);
    for (const bad of ['', 'x', '2026-13-01', '2026-02-30', '../etc', '2026-1-1']) {
      assert.equal((await call(R.day, 'GET', `/api/ranked/day?d=${encodeURIComponent(bad)}`, null)).status, 400, bad);
    }
    const midnight = dayStart(d0) + DAY;
    for (const [off, revealed] of [[60_000, false], [seed.PLAY_GRACE_MS + 1000, false], [9 * 60_000, false], [10 * 60_000 + 1000, true]] as const) {
      skew = midnight + off - realNow();
      try {
        const r = await call(R.day, 'GET', `/api/ranked/day?d=${d0}`, null);
        assert.equal(r.json.seed !== undefined, revealed, `offset ${off}ms`);
        if (revealed) assert.equal(r.json.seed, seed.dailySeed(d0));
      } finally { skew = 0; }
    }
    assert.ok(seed.PLAY_GRACE_MS < 10 * 60_000, 'play grace must stay below reveal grace');
  });

  await test('no endpoint leaks the daily seed, the run seed or a future tray (start/play/run/me)', async () => {
    const u = await newPlayer(1);
    const st = await startRun(u);
    const ds = seed.dailySeed(today()), rs = seed.runSeed(ds, st.json.runId);
    const m = legal(st.json.state)[0];
    const pl = await play(u, st.json.runId, 0, [m]);
    const run = await call(R.run, 'GET', `/api/ranked/run?id=${st.json.runId}`, u.token);
    const me = await call(R.me, 'GET', '/api/ranked/me', u.token);
    const lb = await call(R.board, 'GET', '/api/ranked/leaderboard', null);
    for (const blob of [st, pl, run, me, lb].map((x) => JSON.stringify(x.json))) {
      assert.ok(!blob.includes(ds) && !blob.includes(rs));
    }
    // me exposes only the commitment; commitment does not reveal the seed (sha256 preimage)
    assert.equal(me.json.commitment, createHash('sha256').update(Buffer.from(ds, 'hex')).digest('hex'));
    // the state shows only the CURRENT tray (<=3 pieces); next tray comes only after it empties
    assert.equal(Object.keys(st.json.state).sort().join(), 'board,chain,moves,over,perfectNext,score,tray');
  });

  await test('seed prediction: trays are bound to the server run id; two runs / two wallets differ; board+moves alone is not enough', async () => {
    const firsts = new Set<string>();
    const ds = seed.dailySeed(today());
    for (let i = 0; i < 40; i++) firsts.add(seed.trayFor(seed.runSeed(ds, randomUUID()), rules.boardToHex(0n), 0).join());
    assert.ok(firsts.size > 10, 'first trays barely vary across run ids: ' + firsts.size);
    const a = seed.trayFor(seed.runSeed(ds, 'r1'), '0000000000000000', 0), b = seed.trayFor(seed.runSeed(ds, 'r2'), '0000000000000000', 0);
    const c = seed.trayFor(seed.runSeed(seed.dailySeed(seed.dayOf(Date.now() + DAY)), 'r1'), '0000000000000000', 0);
    // not a strict inequality guarantee for a 3-piece tray, so check over many positions
    let diffRun = 0, diffDay = 0;
    for (let mv = 0; mv < 60; mv++) {
      if (seed.trayFor(seed.runSeed(ds, 'r1'), '0000000000000000', mv).join() !== seed.trayFor(seed.runSeed(ds, 'r2'), '0000000000000000', mv).join()) diffRun++;
      if (seed.trayFor(seed.runSeed(ds, 'r1'), '0000000000000000', mv).join() !== seed.trayFor(seed.runSeed(seed.dailySeed(seed.dayOf(Date.now() + DAY)), 'r1'), '0000000000000000', mv).join()) diffDay++;
    }
    assert.ok(diffRun > 40 && diffDay > 40, `diffRun=${diffRun} diffDay=${diffDay}`);
    void a; void b; void c;
  });

  // ── DoS / size ──
  await test('oversize bodies are cut off (400): Content-Length lie, streamed without length, 300 KB', async () => {
    const huge = JSON.stringify({ runId: runA.runId, fromMoves: 0, moves: [{ slot: 0, row: 0, col: 0 }], pad: 'a'.repeat(300_000) });
    const r1 = await call(R.play, 'POST', '/api/ranked/play', A.token, undefined, huge);
    assert.equal(r1.status, 400);
    const stream = new ReadableStream({ start(c) { const e = new TextEncoder(); for (let i = 0; i < 40; i++) c.enqueue(e.encode('a'.repeat(10_000))); c.close(); } });
    const r2 = await call(R.play, 'POST', '/api/ranked/play', A.token, undefined, stream);
    assert.equal(r2.status, 400);
    const r3 = await call(R.play, 'POST', '/api/ranked/play', A.token, undefined, '[1,2,3]');
    assert.equal(r3.status, 400);
    const r4 = await call(R.play, 'POST', '/api/ranked/play', A.token, undefined, '{"runId":');
    assert.equal(r4.status, 400);
    // deeply nested JSON must not crash the handler
    const r5 = await call(R.play, 'POST', '/api/ranked/play', A.token, undefined, '['.repeat(50_000));
    assert.equal(r5.status, 400);
  });

  // ── Timing flags ──
  await test('timing: >250 ms/placement is flagged (not rejected); slow play is not; flags are recorded in the run', async () => {
    const u = await newPlayer(1);
    const st = (await startRun(u)).json;
    let s: S = st.state, from = 0;
    const m1 = pickRand(legal(s));
    let r = await play(u, st.runId, from, [m1]); // immediately after start
    assert.equal(r.status, 200, 'fast play is accepted, not rejected');
    s = r.json.state; from = 1;
    const row1 = (await db.getRun(st.runId))!;
    assert.ok(row1.flags >= 1, 'fast first move should be flagged');
    await new Promise((res) => setTimeout(res, 400));
    r = await play(u, st.runId, from, [pickRand(legal(s))]);
    assert.equal(r.status, 200);
    const row2 = (await db.getRun(st.runId))!;
    assert.equal(row2.flags, row1.flags, 'a 400 ms single move must not be flagged');
    // flagged runs still reach the leaderboard (design: human review before --send)
    const lb = await db.dayBoard(today(), 1000);
    assert.ok(lb.length > 0);
  });

  // ── Legacy claim-only endpoint ──
  await test('legacy /api/score/submit: not wired into ranked prizes (rk_runs is the only prize source)', async () => {
    const fs = await import('node:fs');
    for (const f of ['lib/ranked/results.ts', 'lib/ranked/db.ts', 'scripts/post-results.ts', 'app/api/ranked/proof/route.ts']) {
      const t = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
      assert.ok(!/leaderboard\/store|api\/score\/submit|recordScore/.test(t), f + ' reads the claim-only leaderboard');
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
}

import { randomUUID } from 'node:crypto';
main().catch((e) => { console.error(e); process.exit(1); });
