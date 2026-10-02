'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import s from './versus.module.css';

const KEY = 'bb:vs-name';

export function savedName(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

/** Name field + submit. Calls onSubmit(name); shows its error string if it returns one. */
export default function NameForm({ cta, onSubmit }: { cta: string; onSubmit: (name: string) => Promise<string | null> }) {
  const t = useT('challenge');
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className={s.row}
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n || busy) return;
        try { localStorage.setItem(KEY, n); } catch { /* storage blocked */ }
        setBusy(true);
        setErr(await onSubmit(n));
        setBusy(false);
      }}
    >
      <label htmlFor="vs-name" className={s.note} style={{ flexBasis: '100%', margin: 0 }}>{t('name_label')}</label>
      <input id="vs-name" className={s.input} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder={t('name_placeholder')} autoComplete="nickname" />
      <button type="submit" className={s.btn} disabled={busy || !name.trim()}>{busy ? t('saving') : cta}</button>
      {err && <p className={s.note} role="alert" style={{ flexBasis: '100%' }}>{err}</p>}
    </form>
  );
}
