// Counts studio colours passing WCAG AA in light+dark; also sweeps every possible code.
//   node lib/themes/scripts/pastel-check.mjs
import fs from 'node:fs';
// pastel.ts imports './gen' extensionless (Next style); node needs './gen.ts', so run a patched temp copy.
const src = new URL('../pastel.ts', import.meta.url);
const tmp = new URL('../.pastel.tmp.ts', import.meta.url);
fs.writeFileSync(tmp, fs.readFileSync(src, 'utf8').replace("'./gen'", "'./gen.ts'"));
const { pastelGrid, passesContrast } = await import(tmp.href).finally(() => fs.rmSync(tmp));
import { PASTEL_BASES } from '../gen.ts';
const g = pastelGrid();
const names = new Set(g.map((x) => x.name));
let all = 0, ok = 0;
for (const base of Object.keys(PASTEL_BASES)) for (let h = 0; h < 360; h++) for (let s = 0; s <= 4; s++) { all++; if (passesContrast({ base, accent: h, softness: s })) ok++; }
console.log(`grid: ${g.length} colours pass, unique names ${names.size}; full space ${ok}/${all} pass`);
console.log(g.slice(0, 3).map((x) => `${x.code} ${x.name}`).join(' | '));
process.exit(names.size === g.length && g.length >= 300 ? 0 : 1);
