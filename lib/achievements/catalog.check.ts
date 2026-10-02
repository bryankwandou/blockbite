/** Run: npx tsx lib/achievements/catalog.check.ts */
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, emblemSignature, evaluate } from './catalog';
import { emblemSvg } from './emblem';
import { AVATAR_COMBOS, AVATAR_PARTS, PART_KEYS, avatarSvg, formatCode, parseCode, partsFromSeed } from '../../components/avatar/parts';

const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
assert.equal(ids.size, ACHIEVEMENTS.length, 'duplicate achievement ids');
assert.ok(ids.size >= 5000, `only ${ids.size} achievements`);

const sigs = new Set(ACHIEVEMENTS.map((a) => emblemSignature(a.emblem)));
assert.equal(sigs.size, ACHIEVEMENTS.length, 'duplicate emblem signatures');
const svgs = new Set(ACHIEVEMENTS.map((a) => emblemSvg(a.emblem)));
assert.equal(svgs.size, ACHIEVEMENTS.length, 'duplicate emblem SVGs');

const lvl = Math.max(...ACHIEVEMENTS.filter((a) => a.cat === 'level').map((a) => a.threshold));
assert.equal(lvl, 500_000);

assert.deepEqual(evaluate({}), []);
const got = evaluate({ level: 10, lines: 0 });
assert.ok(got.includes('level-1') && got.includes('level-10') && !got.some((id) => id.startsWith('lines-')));

assert.ok(AVATAR_COMBOS >= 50_000, `only ${AVATAR_COMBOS} avatar combos`);
for (let s = 0; s < 5000; s++) {
  const p = partsFromSeed(s);
  const code = formatCode(p);
  assert.ok(code.length <= 32 && /^[a-z0-9-]{1,40}$/.test(code), code);
  assert.deepEqual(parseCode(code), p, `round-trip ${code}`);
}
assert.equal(formatCode(parseCode('m1-b03-p11-e07-m04-a15-g02')!), 'm1-b03-p11-e07-m04-a15-g02');
for (const bad of ['m1-b99-p00-e00-m00-a00-g00', 'm2-b00-p00-e00-m00-a00-g00', 'rex', '', 'm1-b0-p00-e00-m00-a00-g00']) {
  assert.equal(parseCode(bad), null, bad);
}
// Each part option changes the picture (no part is a no-op), apart from gear 0 = none.
for (const k of PART_KEYS) {
  const base = partsFromSeed(1);
  const seen = new Set<string>();
  for (let i = 0; i < AVATAR_PARTS[k].length; i++) seen.add(avatarSvg({ ...base, [k]: i }));
  assert.equal(seen.size, AVATAR_PARTS[k].length, `part ${k} has identical options`);
}

console.log(`ok: ${ids.size} achievements, ${sigs.size} unique emblems, ${AVATAR_COMBOS.toLocaleString('en')} avatar combos, code round-trip ok`);
