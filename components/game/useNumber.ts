'use client';

import { useCallback } from 'react';
import { useLang } from '@/lib/i18n';

/**
 * Numbers in the UI language, not the OS locale. A bare toLocaleString()
 * follows the operating system, so an English page on an Indonesian or
 * German machine showed "Level 1.001", which reads as a decimal.
 */
export function useNumber() {
  const lang = useLang();
  const num = useCallback(
    (n: number, opts?: Intl.NumberFormatOptions) => n.toLocaleString(lang, opts),
    [lang],
  );
  /** Scores: full digits below 10,000, compact above (12.3K, 1.25M), like lib/game/scoring formatScore. */
  const score = useCallback(
    (n: number) => (n >= 10_000
      ? new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: n >= 1_000_000 ? 2 : 1 }).format(n)
      : n.toLocaleString(lang)),
    [lang],
  );
  return { num, score };
}
