'use client';

/**
 * Partner console: apply → (admin approves in /admin) → create campaigns,
 * fund the distributor (deposit checked on-chain), watch allocations and
 * claims, pause/resume, CSV. Players claim from components/partner/PartnerRewards.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Navbar from '@/components/Navbar';
import { useT } from '@/lib/i18n';
import { api, useConsoleAuth } from '@/lib/admin/useConsoleAuth';
import { Bars, Empty, Kpi, SignInCard, Source, Table, s, short } from '../admin/ui';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type TT = (k: string, v?: Record<string, string | number>) => string;

export default function PartnerPage() {
  const t = useT('partner');
  const auth = useConsoleAuth('partner');
  const [me, setMe] = useState<Any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setMe(await api<Any>('/api/partner/me')); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (auth.session) load(); else setMe(null); }, [auth.session, load]);

  return (
    <>
      <Navbar />
      <main className={s.page}>
        <h1 className={s.title}>{t('title')}</h1>
        <p className={s.sub}>{t('subtitle')}</p>
        {!auth.session ? (
          auth.checked && <SignInCard wallet={auth.wallet} busy={auth.busy} error={auth.error} configured={auth.configured}
            onSignIn={auth.signIn} t={t} note={t('sign_in_note')} />
        ) : (
          <>
            <div className={s.row} style={{ marginBottom: 12 }}>
              <span className={s.note}>{t('signed_as')} <code className={s.mono}>{short(auth.session)}</code></span>
              <button type="button" className={s.ghost} onClick={load}>{t('refresh')}</button>
              <button type="button" className={s.ghost} onClick={auth.signOut}>{t('sign_out')}</button>
            </div>
            {err && <p className={s.error} role="alert">{err}</p>}
            {me && (me.partner?.status === 'approved'
              ? <Approved me={me} t={t} reload={load} />
              : <Apply me={me} t={t} reload={load} />)}
          </>
        )}
      </main>
    </>
  );
}

function Apply({ me, t, reload }: { me: Any; t: TT; reload: () => void }) {
  const p = me.partner as Any | null;
  const [f, setF] = useState({ name: p?.name ?? '', tokenMint: p?.token_mint ?? '', contact: p?.contact ?? '' });
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try { await api('/api/partner/me', f); reload(); } catch (x) { setMsg(x instanceof Error ? x.message : String(x)); }
  };
  return (
    <section className={s.card}>
      <h2 className={s.cardTitle}>{t('apply_title')}</h2>
      {p && <p className={p.status === 'rejected' ? s.error : s.note}>{t(`status_${p.status}`)}</p>}
      <p className={s.note}>{t('apply_body')}</p>
      <form onSubmit={submit}>
        <div className={s.field}><label htmlFor="p-name">{t('name')}</label>
          <input id="p-name" className={s.input} value={f.name} maxLength={80} required onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className={s.field}><label htmlFor="p-mint">{t('mint')}</label>
          <input id="p-mint" className={`${s.input} ${s.mono}`} value={f.tokenMint} maxLength={44} required onChange={(e) => setF({ ...f, tokenMint: e.target.value.trim() })} /></div>
        <div className={s.field}><label htmlFor="p-contact">{t('contact')}</label>
          <input id="p-contact" className={s.input} value={f.contact} maxLength={120} required onChange={(e) => setF({ ...f, contact: e.target.value })} /></div>
        <button type="submit" className={s.btn}>{p ? t('resubmit') : t('submit')}</button>
      </form>
      {msg && <p className={s.error} role="alert">{msg}</p>}
    </section>
  );
}

function Approved({ me, t, reload }: { me: Any; t: TT; reload: () => void }) {
  return (
    <>
      <p className={s.ok}>{t('status_approved')}</p>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('how_title')}</h2>
        <p className={s.note}>{t('how_body')}</p>
      </section>
      <NewCampaign me={me} t={t} reload={reload} />
      <h2 className={s.cardTitle}>{t('campaigns')}</h2>
      {me.campaigns.length ? (me.campaigns as Any[]).map((c) => <CampaignCard key={c.id} c={c} t={t} reload={reload} />) : <Empty>{t('no_campaigns')}</Empty>}
    </>
  );
}

function NewCampaign({ me, t, reload }: { me: Any; t: TT; reload: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    mint: me.partner.token_mint as string, budget: '', rule: 'daily_top', ruleAmounts: '100, 50, 25',
    ruleLevel: '10', ruleAchievement: '', ruleAmount: '', startsOn: today, endsOn: today,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try { await api('/api/partner/campaigns', f); reload(); } catch (x) { setMsg(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); }
  };
  return (
    <section className={s.card}>
      <h2 className={s.cardTitle}>{t('new_campaign')}</h2>
      <form onSubmit={submit} className={s.grid}>
        <div className={s.field}><label htmlFor="c-mint">{t('mint')}</label><input id="c-mint" className={`${s.input} ${s.mono}`} value={f.mint} onChange={set('mint')} required /></div>
        <div className={s.field}><label htmlFor="c-budget">{t('budget')}</label><input id="c-budget" className={s.input} inputMode="decimal" value={f.budget} onChange={set('budget')} required /></div>
        <div className={s.field}><label htmlFor="c-rule">{t('rule')}</label>
          <select id="c-rule" className={s.input} value={f.rule} onChange={set('rule')}>
            {(me.rules as string[]).map((r) => <option key={r} value={r}>{t(`rule_${r}`)}</option>)}
          </select></div>
        {f.rule === 'daily_top' && (
          <div className={s.field}><label htmlFor="c-amounts">{t('rule_amounts')}</label><input id="c-amounts" className={s.input} value={f.ruleAmounts} onChange={set('ruleAmounts')} required /></div>
        )}
        {f.rule === 'level' && (
          <div className={s.field}><label htmlFor="c-level">{t('rule_level_n')}</label><input id="c-level" className={s.input} inputMode="numeric" value={f.ruleLevel} onChange={set('ruleLevel')} required /></div>
        )}
        {f.rule === 'achievement' && (
          <div className={s.field}><label htmlFor="c-ach">{t('rule_ach_id')}</label><input id="c-ach" className={s.input} value={f.ruleAchievement} onChange={set('ruleAchievement')} required /></div>
        )}
        {f.rule !== 'daily_top' && (
          <div className={s.field}><label htmlFor="c-amount">{t('rule_amount')}</label><input id="c-amount" className={s.input} inputMode="decimal" value={f.ruleAmount} onChange={set('ruleAmount')} required /></div>
        )}
        <div className={s.field}><label htmlFor="c-start">{t('starts')}</label><input id="c-start" type="date" className={s.input} value={f.startsOn} onChange={set('startsOn')} required /></div>
        <div className={s.field}><label htmlFor="c-end">{t('ends')}</label><input id="c-end" type="date" className={s.input} value={f.endsOn} onChange={set('endsOn')} required /></div>
        <div className={s.field} style={{ justifyContent: 'flex-end' }}><button type="submit" className={s.btn} disabled={busy}>{t('create')}</button></div>
      </form>
      {msg && <p className={s.error} role="alert">{msg}</p>}
    </section>
  );
}

function ruleText(c: Any, t: TT): string {
  const r = c.rule as Any;
  if (r.kind === 'daily_top') return `${t('rule_daily_top')} · N=${r.amounts.length} · ${(r.amounts as string[]).join(' / ')}`;
  if (r.kind === 'level') return `${t('rule_level')} · L=${r.level} · ${r.amount}`;
  return `${t('rule_achievement')} · ${r.id} · ${r.amount}`;
}

function CampaignCard({ c, t, reload }: { c: Any; t: TT; reload: () => void }) {
  const tot = c.totals as Any;
  const [sig, setSig] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api<{ amount: string }>('/api/partner/deposit', { campaignId: c.id, signature: sig });
      setMsg({ ok: true, text: t('deposit_ok', { amount: r.amount }) });
      setSig('');
      reload();
    } catch (x) { setMsg({ ok: false, text: x instanceof Error ? x.message : String(x) }); }
  };
  const pause = async () => {
    try { await api('/api/partner/campaigns/pause', { campaignId: c.id, paused: !c.paused }); reload(); }
    catch (x) { setMsg({ ok: false, text: x instanceof Error ? x.message : String(x) }); }
  };
  const nd = t('no_data');
  const rec = c.recipients as Any[];
  return (
    <section className={s.card}>
      <h3 className={s.cardTitle}>{ruleText(c, t)} · {c.startsOn} → {c.endsOn}</h3>
      <p className={`${s.source} ${s.mono}`}>{t('mint')}: {c.mint} · {t('budget_of', { budget: c.budget })} · id {c.id}</p>
      {c.paused && <p className={s.error}>{t('paused')}</p>}
      <div className={s.row}>
        <button type="button" className={s.ghost} onClick={pause}>{c.paused ? t('resume') : t('pause')}</button>
        <a className={s.ghost} href={`/api/partner/export?campaign=${encodeURIComponent(c.id)}`} download>{t('export_csv')}</a>
      </div>

      <h4 className={s.cardTitle} style={{ marginTop: 14 }}>{t('deposit_title')}</h4>
      {c.deposit ? (
        <>
          <p className={s.note}>{t('deposit_body')}</p>
          <p className={s.note}>{t('deposit_owner')}: <span className={s.mono}>{c.deposit.owner}</span></p>
          <p className={s.note}>{t('deposit_ata')}: <span className={s.mono}>{c.deposit.tokenAccount}</span></p>
          <form onSubmit={verify} className={s.row}>
            <input aria-label={t('deposit_sig')} placeholder={t('deposit_sig')} className={`${s.input} ${s.mono}`} style={{ flex: '1 1 240px' }} value={sig} onChange={(e) => setSig(e.target.value.trim())} required />
            <button type="submit" className={s.btn}>{t('verify')}</button>
          </form>
        </>
      ) : <p className={s.error}>{t('deposit_missing')}</p>}
      {msg && <p className={msg.ok ? s.ok : s.error}>{msg.text}</p>}

      <div className={s.kpis} style={{ marginTop: 14 }}>
        <Kpi label={t('deposited')} value={(c.deposits as Any[]).length ? tot.deposited : null} empty={nd} />
        <Kpi label={t('allocated')} value={rec.length ? tot.allocated : null} empty={nd} />
        <Kpi label={t('paid')} value={rec.length ? tot.paid : null} empty={nd} />
        <Kpi label={t('pending')} value={rec.length ? tot.pending : null} empty={nd} />
        <Kpi label={t('remaining')} value={(c.deposits as Any[]).length ? tot.remaining : null} empty={nd} />
        <Kpi label={t('unallocated')} value={(c.deposits as Any[]).length ? tot.unallocated : null} empty={nd} />
        <Kpi label={t('recipients')} value={rec.length ? tot.recipients : null} empty={nd} />
      </div>
      <h4 className={s.cardTitle} style={{ marginTop: 14 }}>{t('daily_chart')}</h4>
      {(c.paidPerDay as Any[]).length ? <Bars label={t('daily_chart')} data={(c.paidPerDay as Any[]).map((x) => ({ k: x.day, a: x.amount }))} /> : <Empty>{nd}</Empty>}
      <h4 className={s.cardTitle} style={{ marginTop: 14 }}>{t('recipients')}</h4>
      {rec.length ? (
        <Table head={[t('wallet'), t('period'), t('amount'), t('status'), t('tx')]}
          rows={rec.slice(0, 200).map((a) => [<span key="w" className={s.mono}>{short(a.wallet)}</span>, a.period, a.amount, a.status,
            a.txSig ? <span key="x" className={s.mono}>{short(a.txSig)}</span> : ''])} />
      ) : <Empty>{nd}</Empty>}
      <Source label={t('source')}>ptn_allocations, ptn_dist_deposits (finalized signatures)</Source>
    </section>
  );
}
