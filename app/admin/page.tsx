'use client';

import { useCallback, useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useT } from '@/lib/i18n';
import { api, useConsoleAuth } from '@/lib/admin/useConsoleAuth';
import { Bars, Empty, Kpi, SignInCard, Source, Table, fmt, s, short } from './ui';

type Tab = 'traffic' | 'errors' | 'money' | 'players' | 'health' | 'partners';
const TABS: Tab[] = ['traffic', 'errors', 'money', 'players', 'health', 'partners'];
type KN = { k: string; n: number };
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function AdminPage() {
  const t = useT('admin');
  const auth = useConsoleAuth('admin');
  const [tab, setTab] = useState<Tab>('traffic');
  const [data, setData] = useState<Any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const url = which === 'errors' ? '/api/admin/errors' : which === 'partners' ? '/api/admin/partners' : `/api/admin/stats?tab=${which}`;
      setData(await api<Any>(url));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/sign in first/.test(m)) auth.setSession(null);
      setErr(m);
    } finally {
      setLoading(false);
    }
  }, [auth.setSession]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (auth.session) load(tab); }, [auth.session, tab, load]);

  const nd = t('no_data');
  const kv = (rows: KN[] | undefined, head: string) => rows?.length
    ? <Table head={[head, t('count')]} rows={rows.map((r) => [r.k, fmt(r.n, 0)])} />
    : <Empty>{nd}</Empty>;

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
              <button type="button" className={s.ghost} onClick={() => load(tab)} disabled={loading}>{t('refresh')}</button>
              <button type="button" className={s.ghost} onClick={auth.signOut}>{t('sign_out')}</button>
            </div>
            <nav className={s.tabs} aria-label={t('title')}>
              {TABS.map((x) => (
                <button key={x} type="button" className={x === tab ? s.tabOn : s.tab} aria-pressed={x === tab} onClick={() => setTab(x)}>
                  {t(`tab_${x}`)}
                </button>
              ))}
            </nav>
            {loading && <p className={s.note}>{t('loading')}</p>}
            {err && <p className={s.error} role="alert">{err}</p>}
            {data && tab === 'traffic' && <Traffic d={data} t={t} kv={kv} />}
            {data && tab === 'errors' && <Errors d={data} t={t} />}
            {data && tab === 'money' && <Money d={data} t={t} />}
            {data && tab === 'players' && <Players d={data} t={t} />}
            {data && tab === 'health' && <Health d={data} t={t} />}
            {data && tab === 'partners' && <Partners d={data} t={t} reload={() => load('partners')} />}
          </>
        )}
      </main>
    </>
  );
}

type TT = (k: string, v?: Record<string, string | number>) => string;

function Traffic({ d, t, kv }: { d: Any; t: TT; kv: (r: KN[] | undefined, h: string) => React.ReactNode }) {
  const days = d.days as { day: string; views: number; visitors: number }[];
  return (
    <>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('visitors_day')}</h2>
        <div className={s.kpis}>
          <Kpi label={t('live_15m')} value={d.live} empty={t('no_data')} />
          <Kpi label={t('visitors_30d')} value={days.length ? fmt(days.reduce((a, x) => a + x.visitors, 0), 0) : null} empty={t('no_data')} />
          <Kpi label={t('views_30d')} value={days.length ? fmt(days.reduce((a, x) => a + x.views, 0), 0) : null} empty={t('no_data')} />
        </div>
        {days.length ? <Bars label={t('visitors_day')} data={days.map((x) => ({ k: x.day, a: x.views, b: x.visitors }))} /> : <Empty>{t('no_data')}</Empty>}
        <p className={s.note}>{t('legend_views_visitors')}</p>
        <Source label={t('source')}>{d.source}</Source>
      </section>
      <div className={s.grid}>
        <section className={s.card}><h2 className={s.cardTitle}>{t('pages')}</h2>{kv(d.pages, t('path'))}</section>
        <section className={s.card}><h2 className={s.cardTitle}>{t('countries')}</h2>{kv(d.countries, t('country'))}</section>
        <section className={s.card}><h2 className={s.cardTitle}>{t('devices')}</h2>{kv(d.devices, t('device'))}</section>
        <section className={s.card}><h2 className={s.cardTitle}>{t('referrers')}</h2>{kv(d.referrers, t('host'))}</section>
      </div>
    </>
  );
}

function Errors({ d, t }: { d: Any; t: TT }) {
  const g = d.groups as { message: string; n: number; first: string; last: string; paths: string[]; builds: string[] }[];
  return (
    <section className={s.card}>
      <h2 className={s.cardTitle}>{t('tab_errors')}</h2>
      {g.length ? (
        <Table head={[t('message'), t('count'), t('first_seen'), t('last_seen'), t('path'), t('build')]}
          rows={g.map((x) => [<span key="m" className={s.mono}>{x.message}</span>, x.n, x.first.slice(0, 16), x.last.slice(0, 16),
            (x.paths ?? []).filter(Boolean).join(', '), (x.builds ?? []).filter(Boolean).join(', ')])} />
      ) : <Empty>{t('no_data')}</Empty>}
      <Source label={t('source')}>{d.source}</Source>
    </section>
  );
}

function Money({ d, t }: { d: Any; t: TT }) {
  const days = d.days as { day: string; tickets: number; gross: number; vault: number; referrer: number; team: number }[];
  const sum = (k: 'gross' | 'vault' | 'referrer' | 'team') => days.length ? `${fmt(days.reduce((a, x) => a + x[k], 0))} USDC` : null;
  return (
    <>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('sales_day')}</h2>
        <div className={s.kpis}>
          <Kpi label={t('gross_60d')} value={sum('gross')} empty={t('no_data')} />
          <Kpi label={t('vault')} value={sum('vault')} empty={t('no_data')} />
          <Kpi label={t('team')} value={sum('team')} empty={t('no_data')} />
          <Kpi label={t('referrer')} value={sum('referrer')} empty={t('no_data')} />
        </div>
        {days.length ? (
          <>
            <Bars label={t('sales_day')} data={days.map((x) => ({ k: x.day, a: x.gross, b: x.vault }))} />
            <Table head={[t('day'), t('tickets'), t('gross'), t('vault'), t('team'), t('referrer')]}
              rows={days.map((x) => [x.day, x.tickets, fmt(x.gross), fmt(x.vault), fmt(x.team), fmt(x.referrer)])} />
          </>
        ) : <Empty>{t('no_data')}</Empty>}
        <p className={s.note}>{t('split_note', { ticket: d.split.ticket, vault: d.split.vault, ref: d.split.referrer })}</p>
        <Source label={t('source')}>{d.source.sales}</Source>
      </section>
      <div className={s.grid}>
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t('vault_balance')}</h2>
          <div className={s.kpis}>
            <Kpi label={t('vault_total')} value={d.vaultBalance === null ? null : `${fmt(d.vaultBalance)} USDC`} empty={t('no_data')} />
            <Kpi label={t('vault_reserved')} value={d.vaultReserved === null ? null : `${fmt(d.vaultReserved)} USDC`} empty={t('no_data')} />
            <Kpi label={t('vault_free')} value={d.vaultFree === null ? null : `${fmt(d.vaultFree)} USDC`} empty={t('no_data')} />
          </div>
          <p className={s.note}>{t('pool_rule', { vp: d.split.vaultPct, dp: d.split.dailyPct, dn: d.split.dailyTop, mp: d.split.monthlyPct, mn: d.split.monthlyTop })}</p>
          {d.vaultError && <p className={s.error}>{d.vaultError}</p>}
          <Source label={t('source')}>{d.source.vault}</Source>
        </section>
        <section className={s.card}>
          <h2 className={s.cardTitle}>{t('payouts')}</h2>
          {d.payouts ? (
            <div className={s.kpis}>
              <Kpi label={t('posted_rounds')} value={d.payouts.postedRounds} empty={t('no_data')} />
              <Kpi label={t('posted_usdc')} value={fmt(d.payouts.postedUsdc)} empty={t('no_data')} />
              <Kpi label={t('unposted_rounds')} value={d.payouts.unpostedRounds} empty={t('no_data')} />
              <Kpi label={t('claimed')} value={null} empty={t('not_indexed')} />
            </div>
          ) : <Empty>{t('no_data')}</Empty>}
          <Source label={t('source')}>{d.source.payouts}; {d.claimedNote}</Source>
        </section>
      </div>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('top_referrers')}</h2>
        {d.topReferrers.length
          ? <Table head={[t('referrer'), t('tickets'), 'USDC']} rows={(d.topReferrers as Any[]).map((r) => [<span key="r" className={s.mono}>{r.k}</span>, r.tickets, fmt(r.usdc)])} />
          : <Empty>{t('no_data')}</Empty>}
        <Source label={t('source')}>{d.source.referrers}</Source>
      </section>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('open_risks')}</h2>
        <ol className={s.note}>{(d.openRisks as string[]).map((r) => <li key={r}>{r}</li>)}</ol>
        <Source label={t('source')}>lib/ranked/AUDIT.md (NOT HANDLED / residual risk)</Source>
      </section>
    </>
  );
}

function Players({ d, t }: { d: Any; t: TT }) {
  const daily = d.daily as { day: string; dau: number; fresh: number }[];
  const last = daily[daily.length - 1];
  const pct = (a: number, b: number) => `${fmt((100 * a) / b, 1)}%`;
  return (
    <section className={s.card}>
      <h2 className={s.cardTitle}>{t('tab_players')}</h2>
      <div className={s.kpis}>
        <Kpi label={t('dau')} value={last ? `${last.dau} (${last.day})` : null} empty={t('no_data')} />
        <Kpi label={t('mau')} value={d.mau} empty={t('no_data')} />
        <Kpi label={t('ranked_runs')} value={d.rankedRuns30d} empty={t('no_data')} />
        <Kpi label={t('d1')} value={d.retention ? pct(d.retention.d1, d.retention.cohort) : null} empty={t('no_data')} />
        <Kpi label={t('d7')} value={d.retention ? pct(d.retention.d7, d.retention.cohort) : null} empty={t('no_data')} />
        <Kpi label={t('visitors_24h')} value={d.visitors24h} empty={t('no_data')} />
      </div>
      {daily.length ? <Bars label={t('dau')} data={daily.map((x) => ({ k: x.day, a: x.dau, b: x.fresh }))} /> : <Empty>{t('no_data')}</Empty>}
      <p className={s.note}>{t('legend_dau_new')} {d.note}</p>
      {d.retention && <p className={s.note}>{t('cohort', { n: d.retention.cohort })}</p>}
      <Source label={t('source')}>{d.source.ranked}; {d.source.visitors}</Source>
    </section>
  );
}

function Health({ d, t }: { d: Any; t: TT }) {
  return (
    <section className={s.card}>
      <h2 className={s.cardTitle}>{t('tab_health')}</h2>
      <div className={s.kpis}>
        <Kpi label={t('db_latency')} value={d.dbMs === null ? null : `${d.dbMs} ms`} empty={t('no_data')} />
        <Kpi label={t('rpc_latency')} value={d.rpcMs === null ? null : `${d.rpcMs} ms`} empty={t('no_data')} />
        <Kpi label={t('slot')} value={d.slot} empty={t('no_data')} />
        <Kpi label={t('last_post')} value={d.lastPost ? `${d.lastPost.kind} ${d.lastPost.period} · ${d.lastPost.at.slice(0, 16)}` : null} empty={t('no_data')} />
      </div>
      {d.dbError && <p className={s.error}>DB: {d.dbError}</p>}
      {d.rpcError && <p className={s.error}>RPC: {d.rpcError}</p>}
      {d.lastPost && <p className={`${s.source} ${s.mono}`}>{d.lastPost.sig}</p>}
      <Source label={t('source')}>{d.source.db}; {d.source.rpc}; {d.source.post}</Source>
    </section>
  );
}

function Partners({ d, t, reload }: { d: Any; t: TT; reload: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const decide = async (wallet: string, status: 'approved' | 'rejected') => {
    try { await api('/api/admin/partners', { wallet, status }); reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('partners')}</h2>
        {d.partners.length ? (
          <Table head={[t('name'), t('wallet'), t('mint'), t('contact'), t('status'), '']}
            rows={(d.partners as Any[]).map((p) => [p.name, <span key="w" className={s.mono}>{p.wallet}</span>, <span key="m" className={s.mono}>{p.token_mint}</span>, p.contact, p.status,
              <div key="a" className={s.row}>
                {p.status !== 'approved' && <button type="button" className={s.btn} onClick={() => decide(p.wallet, 'approved')}>{t('approve')}</button>}
                {p.status !== 'rejected' && <button type="button" className={s.ghost} onClick={() => decide(p.wallet, 'rejected')}>{t('reject')}</button>}
              </div>])} />
        ) : <Empty>{t('no_data')}</Empty>}
        {msg && <p className={s.error}>{msg}</p>}
        <Source label={t('source')}>{d.source}</Source>
      </section>
      <section className={s.card}>
        <h2 className={s.cardTitle}>{t('campaigns')}</h2>
        {d.campaigns.length ? (
          <Table head={['id', t('wallet'), t('mint'), t('rule'), t('period')]}
            rows={(d.campaigns as Any[]).map((c) => [c.id, short(c.partner), short(c.mint), `${c.rule.kind}${c.paused ? ' (paused)' : ''}`, `${c.startsOn} → ${c.endsOn}`])} />
        ) : <Empty>{t('no_data')}</Empty>}
      </section>
    </>
  );
}
