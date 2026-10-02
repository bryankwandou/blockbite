// Checks every lib/i18n/messages/<ns>/<locale>.json against en.json:
// valid JSON, no BOM, no missing or extra keys, same {placeholders}, no empty values.
// usage: node scripts/i18n-check.mjs [locale ...]   (default: all locales)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = 'lib/i18n/messages';
const namespaces = readdirSync(root);
const all = readdirSync(join(root, 'common')).map((f) => f.replace(/\.json$/, '')).filter((l) => l !== 'en');
const locales = process.argv.slice(2).length ? process.argv.slice(2) : all;
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let problems = 0, missing = 0, checked = 0;
for (const ns of namespaces) {
  const en = JSON.parse(readFileSync(join(root, ns, 'en.json'), 'utf8'));
  for (const l of locales) {
    const p = join(root, ns, `${l}.json`);
    if (!existsSync(p)) { missing += Object.keys(en).length; console.log(`MISSING FILE ${p}`); problems++; continue; }
    const raw = readFileSync(p);
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) { console.log(`BOM ${p}`); problems++; }
    let d;
    try { d = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { console.log(`BAD JSON ${p}: ${e.message}`); problems++; continue; }
    for (const k of Object.keys(en)) {
      checked++;
      if (!(k in d) || String(d[k]).trim() === '') { missing++; continue; }
      if (ph(en[k]) !== ph(d[k])) { console.log(`PLACEHOLDER ${p} ${k}: en {${ph(en[k])}} vs {${ph(d[k])}}`); problems++; }
    }
    for (const k of Object.keys(d)) if (!(k in en)) { console.log(`EXTRA KEY ${p} ${k}`); problems++; }
  }
}
console.log(`${locales.length} locales x ${namespaces.length} namespaces: ${checked} strings checked, ${missing} missing, ${problems} problems`);
process.exit(missing || problems ? 1 : 0);
