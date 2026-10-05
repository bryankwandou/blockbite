'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import w from '../waitlist/waitlist.module.css';

/**
 * Partnership contact page: a short note about BlockBite and a form that
 * POSTs to /api/partnership-lead.
 */
export default function PartnershipPage() {
  const t = useT('partnership');
  const [email, setEmail]     = useState('');
  const [project, setProject] = useState('');
  const [notes, setNotes]     = useState('');
  const [sent, setSent]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !project) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/partnership-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, project, notes }),
      });
      if (res.ok || res.status === 409) {
        setSent(true);
      } else {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const ready = !busy && !!email && !!project;

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.narrow} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('kicker')}</div>
            <h1 className={k.title}>{t('title')}</h1>
            <p className={k.lede}>{t('sub')}</p>
          </div>
        </header>

        <div className={`${k.wrap} ${k.narrow}`}>
          <section className={`${k.section} ${k.card}`} style={{ maxWidth: 560 }}>
            {sent ? (
              <div className={w.done} role="status">
                {t('sent_title')} {t('sent_desc', { email })}
              </div>
            ) : (
              <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
                <div>
                  <label htmlFor="pl-email" className={w.label}>{t('email_label')}</label>
                  <input id="pl-email" type="email" required dir="ltr" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder={t('email_ph')}
                    className={w.input} style={{ width: '100%' }} />
                </div>
                <div>
                  <label htmlFor="pl-project" className={w.label}>{t('project_label')}</label>
                  <input id="pl-project" type="text" required value={project}
                    onChange={(e) => setProject(e.target.value)} placeholder={t('project_ph')}
                    className={w.input} style={{ width: '100%' }} />
                </div>
                <div>
                  <label htmlFor="pl-notes" className={w.label}>{t('notes_label')}</label>
                  <textarea id="pl-notes" rows={3} value={notes}
                    onChange={(e) => setNotes(e.target.value)} placeholder={t('notes_ph')}
                    className={w.input} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
                {err && <p className={w.err} role="alert">{t('err', { msg: err })}</p>}
                <div>
                  <button type="submit" className={k.btn} disabled={!ready}>
                    {busy ? t('submitting') : t('submit')}
                  </button>
                </div>
              </form>
            )}
          </section>

          <p className={k.fine}>
            {t('contact')}{' '}
            <a href="https://x.com/blockbitegame" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ds-accent, #a78bfa)', fontWeight: 700 }}>{t('contact_x')}</a>.
          </p>
        </div>
      </main>
    </>
  );
}
