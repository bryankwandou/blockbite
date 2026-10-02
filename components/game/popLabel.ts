/**
 * Score-pop labels come from the shared scoring code as English strings
 * ("x3 CHAIN TRIPLE CLEAR!", "LEVEL UP: 4", ...). Scoring stays untouched;
 * this only maps those strings to the `game` namespace for display.
 */
type T = (key: string, vars?: Record<string, string | number>) => string;

const CLEAR_KEYS: Record<string, string> = {
  'CLEAR': 'pop_clear',
  'DOUBLE CLEAR!': 'pop_double',
  'TRIPLE CLEAR!': 'pop_triple',
  'QUAD CLEAR!': 'pop_quad',
  'PENTA CLEAR!': 'pop_penta',
};

export function translatePop(t: T, label: string): string {
  if (!label) return label;
  const s = label.trim();
  if (s.startsWith('PERFECT BOARD')) return t('pop_perfect');
  let m = /^LEVEL UP:\s*(\d+)$/.exec(s);
  if (m) return t('pop_level_up', { n: m[1] });
  m = /^\+(\d+) LARGE PIECE$/.exec(s);
  if (m) return t('pop_large', { n: m[1] });
  m = /^x(\d+) CHAIN!?\s*(.*)$/.exec(s);
  if (m) {
    const rest = m[2] ? translatePop(t, m[2]) : '';
    return `${t('pop_chain', { n: m[1] })}${rest ? ' ' + rest : ''}`;
  }
  const key = CLEAR_KEYS[s];
  return key ? t(key) : s;
}
