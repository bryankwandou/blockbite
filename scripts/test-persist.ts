import { recordGameOver } from '../lib/game/persist';
let fail = 0; const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const mk = (init: Record<string,string> = {}, throwSet = false) => { const d = { ...init }; return { d, getItem: (k: string) => d[k] ?? null, setItem: (k: string, v: string) => { if (throwSet) throw new Error('quota'); d[k] = v; } } as any; };
let s = mk(); recordGameOver(5, s); ok(s.d.bb_max_level === '5' && s.d.bb_games_played === '1', 'fresh store');
recordGameOver(3, s); ok(s.d.bb_max_level === '5' && s.d.bb_games_played === '2', 'never lowers');
s = mk({ bb_max_level: 'abc', bb_games_played: '-4' }); recordGameOver(2, s); ok(s.d.bb_max_level === '2' && s.d.bb_games_played === '1', 'garbage values');
let threw = false; try { recordGameOver(9, mk({}, true)); } catch { threw = true; } ok(!threw, 'full storage does not throw');
threw = false; try { recordGameOver(9); } catch { threw = true; } ok(!threw, 'no localStorage does not throw');
process.exit(fail ? 1 : 0);
