// Asserts the album catalogue: 5 albums x 8 tracks, unique keys and names.
// Run: node scripts/audio-check.mjs
import { ALBUMS, getTrackDef } from '../lib/audio/albums.ts';
import assert from 'node:assert';
assert.equal(ALBUMS.length, 5);
const names = new Set(), keys = new Set();
for (const a of ALBUMS) {
  const ks = Object.keys(a.tracks);
  assert.equal(ks.length, 8, `${a.id} has ${ks.length}`);
  for (const k of ks) {
    const t = a.tracks[k];
    assert(!names.has(t.name), 'dup name ' + t.name); names.add(t.name);
    assert(!keys.has(a.id + '/' + k)); keys.add(a.id + '/' + k);
    assert(t.lead.length && t.lead.every((b) => b.length === 16), 'bad bar ' + k);
    assert(t.bassPattern.length === 16 && t.kick.length === 16 && t.snare.length === 16 && t.hat.length === 16, 'bad pattern ' + k);
    assert(getTrackDef(a.id + '/' + k));
  }
  console.log(a.id, ks.length, ks.map((k) => a.tracks[k].name).join(' | '));
}
for (const k of ['classic/menu', 'classic/adventure', 'classic/ranked', 'classic/monthly']) assert(getTrackDef(k), k);
assert.equal(keys.size, 40);
console.log('OK 5 albums x 8 = 40 unique tracks');
