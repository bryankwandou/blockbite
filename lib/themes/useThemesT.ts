'use client';

/**
 * Translator for the 'themes' namespace. Same contract as useT() from lib/i18n:
 * English is bundled, other languages load from lib/i18n/messages/themes/<code>.json
 * and fall back to English. (Self-contained so lib/i18n/registry.ts needs no edit;
 * once 'themes' is registered there, this can become useT('themes').)
 */
import { useCallback, useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import EN from '@/lib/i18n/messages/themes/en.json';

const cache = new Map<string, Record<string, string>>();

export function useThemesT() {
  const lang = useLang();
  const [, bump] = useState(0);
  useEffect(() => {
    if (lang === 'en' || cache.has(lang)) return;
    import(`@/lib/i18n/messages/themes/${lang}.json`)
      .then((m) => cache.set(lang, m.default))
      .catch(() => cache.set(lang, {}))
      .finally(() => bump((x) => x + 1));
  }, [lang]);
  const msgs = cache.get(lang);
  return useCallback(
    (key: string) => (lang !== 'en' ? msgs?.[key] : undefined) ?? (EN as Record<string, string>)[key] ?? key,
    [lang, msgs],
  );
}
