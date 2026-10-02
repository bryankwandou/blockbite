// WCAG AA check for every palette x mode x softness, plus a sweep of custom
// share codes. Reads the CSS actually shipped (styles/themes.css) for presets.
//   node lib/themes/scripts/contrast-check.mjs
import fs from 'node:fs';
import { SEEDS, CONTRAST_PAIRS, contrast, generate, customTokens } from '../gen.ts';

const css = fs.readFileSync(new URL('../../../styles/themes.css', import.meta.url), 'utf8');
let fails = 0, checks = 0, worst = { r: 99, where: '' };
function check(where, t) {
  for (const [fg, bg] of CONTRAST_PAIRS) {
    const r = contrast(t[fg], t[bg]);
    checks++;
    if (r < worst.r) worst = { r, where: `${where} ${fg} on ${bg}` };
    if (r < 4.5) { fails++; console.log(`FAIL ${where}: ${fg} ${t[fg]} on ${bg} ${t[bg]} = ${r.toFixed(2)}`); }
  }
}
for (const s of SEEDS) for (const mode of ['light', 'dark']) {
  const m = css.match(new RegExp(`\\[data-theme='${mode}'\\]\\[data-palette='${s.id}'\\] \\{([^}]*)\\}`));
  if (!m) { fails++; console.log(`FAIL missing CSS block ${s.id}/${mode}`); continue; }
  const t = Object.fromEntries([...m[1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]]));
  check(`css ${s.id}/${mode}`, t);
  for (let soft = 0; soft <= 4; soft++) check(`gen ${s.id}/${mode}/soft${soft}`, generate(s, mode, soft));
  const row = CONTRAST_PAIRS.map(([f, b]) => contrast(t[f], t[b]).toFixed(1)).join(' ');
  console.log(`${s.id.padEnd(9)} ${mode.padEnd(5)} ${row}`);
}
for (const s of SEEDS) for (let hue = 0; hue < 360; hue += 15) for (let soft = 0; soft <= 4; soft++)
  for (const mode of ['light', 'dark']) check(`custom ${s.id}-${hue}-${soft}/${mode}`, customTokens({ base: s.id, accent: hue, softness: soft }, mode));
console.log(`pairs: ${CONTRAST_PAIRS.map(([f, b]) => `${f}/${b}`).join(' ')}`);
console.log(`${checks} checks, ${fails} failures, worst ${worst.r.toFixed(2)}:1 (${worst.where})`);
process.exit(fails ? 1 : 0);
