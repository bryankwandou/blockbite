'use client';
import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/Navbar';

const BG     = '#0a0a0f';
const CARD   = '#13131a';
const PURPLE = '#7c3aed';
const TEAL   = '#0891b2';
const GREEN  = '#10b981';
const GOLD   = '#d97706';
const RED    = '#dc2626';
const BLUE   = '#3b82f6';
const TEXT   = '#f1f5f9';
const MUTED  = '#64748b';
const BORDER = '#1e293b';

// ── Types ─────────────────────────────────────────────────────────────────────
type Entry    = { email: string; ts: number };
type PageStat = { path: string; views: number; sessions: number };
type DayStat  = { date: string; views: number; visitors: number };
type TotalStats = {
  totalViews: number; uniqueVisitors: number; today: number;
  tableReady: boolean; byDay?: DayStat[];
};
type WalletStat = {
  total: number; unique: number; today: number;
  byWallet: { name: string; count: number }[];
};

// ── CSV Export ────────────────────────────────────────────────────────────────
// Single-source export: internal tracker + wallet connects + waitlist.
// BOM + sep= hint ensures Excel opens with proper columns on any locale (ID/EN).
function downloadCSV(
  entries:     Entry[],
  totalStats:  TotalStats | null,
  walletStats: WalletStat | null,
) {
  const now  = new Date();
  const fmt  = (d: Date) => d.toLocaleDateString('en-GB');
  const fmtT = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const q    = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const row  = (...cols: (string | number)[]) => cols.map(q).join(',');

  const lines: string[] = [
    'sep=,',
    '',
    row('BLOCKBITE CORPORATION — ADMIN REPORT', ''),
    row('Generated',    `${fmt(now)} ${fmtT(now)}`),
    row('Source',       'BlockBite Corporation — Internal Tracker (real human visits only)'),
    row('Methodology',  'Client-side tracking fires after JS hydration. Bots & crawlers excluded.'),
    '',

    row('=== WEBSITE ANALYTICS ===', ''),
    row('Metric', 'Value'),
    row('Total Page Views',  totalStats?.totalViews     ?? 0),
    row('Unique Visitors',   totalStats?.uniqueVisitors ?? 0),
    row('Views Today',       totalStats?.today          ?? 0),
    '',

    row('=== WALLET CONNECTIONS ===', ''),
    row('Metric', 'Value'),
    row('Total Connects',  walletStats?.total  ?? 0),
    row('Unique Wallets',  walletStats?.unique ?? 0),
    row('Connects Today',  walletStats?.today  ?? 0),
    '',
  ];

  if ((walletStats?.byWallet.length ?? 0) > 0) {
    lines.push(
      row('Wallet App', 'Connects', '% Share'),
      ...walletStats!.byWallet.map(w => {
        const pct = walletStats!.total > 0
          ? `${((w.count / walletStats!.total) * 100).toFixed(1)}%` : '0%';
        return row(w.name, w.count, pct);
      }),
      '',
    );
  }

  lines.push(
    row('=== WAITLIST SIGNUPS ===', ''),
    row('#', 'Email', 'Date', 'Time (WIB)'),
    ...entries.map((e, i) => {
      const d = new Date(e.ts);
      return row(i + 1, e.email, fmt(d), fmtT(d));
    }),
  );

  const csv  = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `blockbite-report-${now.toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, sub }: {
  label: string; value: string | number; color: string; sub?: string;
}) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ color, fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: PURPLE, fontSize: 11, fontWeight: 700, marginTop: 2 }}>{sub}</div>}
      <div style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>{label}</div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, badge, children }: {
  title: string; badge?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: TEXT, fontWeight: 700, fontSize: 15 }}>{title}</span>
        {badge && (
          <span style={{ background: '#1e1b4b', color: '#a5b4fc', borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── 7-day bar chart ────────────────────────────────────────────────────────────
function VisitorChart({ data }: { data: DayStat[] }) {
  if (!data?.length) return null;
  const maxViews = Math.max(...data.map(d => d.views), 1);
  const H = 60;
  return (
    <div style={{ padding: '20px 20px 16px' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        {data.map((d, i) => {
          const barH   = Math.max(Math.round((d.views / maxViews) * H), d.views > 0 ? 4 : 2);
          const label  = d.date.slice(5).replace('-', '/');
          const isToday = i === data.length - 1;
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: isToday ? BLUE : MUTED, marginBottom: 3, height: 12, lineHeight: '12px' }}>
                {d.views > 0 ? d.views : ''}
              </div>
              <div style={{
                width: '100%', height: barH, borderRadius: '3px 3px 0 0', transition: 'height .3s ease',
                background: d.views > 0
                  ? (isToday ? `linear-gradient(to top,${BLUE},${PURPLE})` : `linear-gradient(to top,${BLUE}55,${PURPLE}55)`)
                  : BORDER,
              }} />
              <div style={{ width: '100%', height: 1, background: BORDER }} />
              <div style={{ fontSize: 9, color: isToday ? TEXT : MUTED, marginTop: 4, fontWeight: isToday ? 700 : 400, whiteSpace: 'nowrap' }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: MUTED }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: `linear-gradient(to top,${BLUE},${PURPLE})` }} />
          Real human page views
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 9, color: MUTED }}>
          Bots &amp; crawlers excluded · Client-side only
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [loggedIn, setLoggedIn]   = useState(false);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading]     = useState(false);
  const token = password;

  // Waitlist
  const [entries, setEntries]   = useState<Entry[]>([]);
  const [wlCount, setWlCount]   = useState(0);
  const [wlFetched, setWlFetched] = useState(false);
  const [wlSource, setWlSource] = useState<string | null>(null);
  const [wlError, setWlError]   = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // Analytics — single source of truth: internal tracker via this company's Neon DB
  const [pageStats, setPageStats]     = useState<PageStat[] | null>(null);
  const [totalStats, setTotalStats]   = useState<TotalStats | null>(null);
  const [walletStats, setWalletStats] = useState<WalletStat | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // ── Login ──────────────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setAuthError('Enter username and password'); return; }
    if (username.trim() !== 'nayrbryanGaming')  { setAuthError('Invalid username'); return; }
    setLoading(true); setAuthError('');
    try {
      const res = await fetch('/api/waitlist/list', { headers: { 'x-admin-token': token.trim() } });
      if (res.status === 401) { setAuthError('Invalid token'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWlCount(data.count ?? 0);
      setEntries(data.entries ?? []);
      setWlSource(data.source ?? null);
      setWlFetched(true);
      setLoggedIn(true);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally { setLoading(false); }
  }

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchWaitlist = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setWlError('');
    try {
      const res = await fetch('/api/waitlist/list', { headers: { 'x-admin-token': token.trim() }, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWlCount(data.count ?? 0); setEntries(data.entries ?? []); setWlSource(data.source ?? null); setWlFetched(true);
    } catch (err: unknown) {
      if (!silent) setWlError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally { if (!silent) setLoading(false); }
  }, [token]);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch('/api/admin/analytics', { headers: { 'x-admin-token': token.trim() }, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPageStats(data.pageStats   ?? null);
      setTotalStats(data.totalStats ?? null);
      setWalletStats(data.walletStats ?? null);
    } catch { /* silent */ } finally { setAnalyticsLoading(false); }
  }, [token]);

  const refreshAll = useCallback(() => {
    fetchWaitlist();
    fetchAnalytics();
  }, [fetchWaitlist, fetchAnalytics]);

  // Auto-poll every 30 s + re-fetch on tab focus
  useEffect(() => {
    if (!loggedIn) return;
    fetchAnalytics();
    const tick = () => { fetchWaitlist(true); };
    const id   = setInterval(tick, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') { tick(); fetchAnalytics(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [loggedIn, fetchWaitlist, fetchAnalytics]);

  async function deleteEntry(email: string) {
    if (!confirm(`Delete ${email} from waitlist?`)) return;
    setDeleting(email);
    try {
      const res = await fetch(`/api/waitlist/list?email=${encodeURIComponent(email)}`, { method: 'DELETE', headers: { 'x-admin-token': token.trim() } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries(prev => prev.filter(e => e.email !== email));
      setWlCount(prev => Math.max(0, prev - 1));
    } catch { alert('Delete failed. Try again.'); } finally { setDeleting(null); }
  }

  // ── Login screen ───────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 40, width: '100%', maxWidth: 400 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>◆</div>
            <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 700, margin: 0 }}>BlockBite Admin</h1>
            <p style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>Analytics &amp; Waitlist Dashboard</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"
              style={{ background: '#0f172a', border: `1px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: '12px 16px', fontSize: 15, outline: 'none' }} />
            <input type="password" placeholder="Password / Admin Token" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
              style={{ background: '#0f172a', border: `1px solid ${BORDER}`, borderRadius: 10, color: TEXT, padding: '12px 16px', fontSize: 15, outline: 'none' }} />
            {authError && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{authError}</p>}
            <button type="submit" disabled={loading}
              style={{ background: `linear-gradient(135deg,${PURPLE},${TEAL})`, color: '#fff', border: 'none', borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
      </>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────────
  const tableReady = totalStats?.tableReady ?? false;
  const topPages   = pageStats?.slice(0, 15) ?? [];
  const byDay      = totalStats?.byDay ?? [];

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '88px 16px 24px', fontFamily: 'system-ui, sans-serif', color: TEXT }}>
      <Navbar />
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ color: TEXT, fontSize: 24, fontWeight: 800, margin: 0 }}>BlockBite Admin</h1>
            <p style={{ color: MUTED, fontSize: 13, margin: '4px 0 0' }}>Analytics + Waitlist Dashboard · nayrbryangaming</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {entries.length > 0 && (
              <button type="button" onClick={() => downloadCSV(entries, totalStats, walletStats)}
                style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Download CSV
              </button>
            )}
            <button type="button" onClick={refreshAll} disabled={loading}
              style={{ background: PURPLE, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Refreshing...' : '↻ Refresh All'}
            </button>
          </div>
        </div>

        {/* ── Methodology badge ── */}
        <div style={{ background: '#0a1628', border: `1px solid ${BLUE}33`, borderRadius: 10, padding: '10px 16px', marginBottom: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: BLUE, fontSize: 13, flexShrink: 0 }}>●</span>
          <span style={{ color: BLUE, fontSize: 12, fontWeight: 700 }}>Single Source of Truth — Internal Tracker</span>
          <span style={{ color: MUTED, fontSize: 12 }}>
            · Counts real human page loads after JavaScript runs · Bots, crawlers &amp; prefetches automatically excluded · Zero manual configuration · Data stored in this company&apos;s own Neon database
          </span>
        </div>

        {/* ── WEBSITE ANALYTICS ── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '1.8px', textTransform: 'uppercase', fontWeight: 700 }}>
            ◈ Website Analytics {analyticsLoading && <span style={{ color: PURPLE, marginLeft: 8 }}>syncing…</span>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 20 }}>
          <StatCard label="Total Page Views"  value={tableReady ? (totalStats?.totalViews    ?? 0).toLocaleString() : '—'} color={BLUE}   />
          <StatCard label="Unique Visitors"   value={tableReady ? (totalStats?.uniqueVisitors ?? 0).toLocaleString() : '—'} color={PURPLE} />
          <StatCard label="Views Today"       value={tableReady ? (totalStats?.today          ?? 0).toLocaleString() : '—'} color={GREEN}  />
          <StatCard label="Waitlist Signups"  value={wlCount.toLocaleString()}                                              color={GOLD}   />
        </div>

        {/* 7-day chart */}
        <Section
          title="Visitor Trend — Last 7 Days"
          badge={tableReady && totalStats ? `${totalStats.totalViews} total views` : 'loading'}
        >
          {byDay.length > 0 ? (
            <VisitorChart data={byDay} />
          ) : (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
              {analyticsLoading ? 'Loading…' : 'No views yet — data populates automatically on every visit.'}
            </div>
          )}
        </Section>

        {/* Per-page breakdown */}
        <Section title="Page Views Breakdown" badge={tableReady ? `${topPages.length} pages` : 'loading'}>
          {analyticsLoading && !pageStats ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: MUTED, fontSize: 13 }}>Loading analytics…</div>
          ) : topPages.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
              No page views yet. Data will appear automatically after the next visit.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {['Page', 'Page Views', 'Unique Visitors', '% of Total'].map(hd => (
                      <th key={hd} style={{ padding: '10px 16px', textAlign: hd === 'Page' ? 'left' : 'right', color: MUTED, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>{hd}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((p, i) => {
                    const pct = totalStats?.totalViews ? ((p.views / totalStats.totalViews) * 100).toFixed(1) : '0.0';
                    return (
                      <tr key={p.path} style={{ borderBottom: i < topPages.length - 1 ? `1px solid ${BORDER}` : 'none', background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                        <td style={{ padding: '10px 16px', fontSize: 13, color: TEXT, fontFamily: 'monospace' }}>{p.path}</td>
                        <td style={{ padding: '10px 16px', fontSize: 13, color: BLUE,   textAlign: 'right', fontWeight: 700 }}>{p.views.toLocaleString()}</td>
                        <td style={{ padding: '10px 16px', fontSize: 13, color: PURPLE, textAlign: 'right', fontWeight: 700 }}>{p.sessions.toLocaleString()}</td>
                        <td style={{ padding: '10px 16px', fontSize: 12, color: MUTED,  textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                            <div style={{ width: 60, height: 4, borderRadius: 2, background: BORDER, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: BLUE, borderRadius: 2 }} />
                            </div>
                            {pct}%
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── WALLET CONNECTIONS ── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '1.8px', textTransform: 'uppercase', fontWeight: 700 }}>
            ◈ Wallet Connections
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 20 }}>
          <StatCard label="Total Connects"   value={walletStats != null ? walletStats.total  : '—'} color={TEAL}   />
          <StatCard label="Unique Wallets"   value={walletStats != null ? walletStats.unique : '—'} color={PURPLE} />
          <StatCard label="Connects Today"   value={walletStats != null ? walletStats.today  : '—'} color={GREEN}  />
          <StatCard label="Waitlist Signups" value={wlCount}                                        color={GOLD}   />
        </div>

        {walletStats && walletStats.byWallet.length > 0 && (
          <Section title="Wallet App Breakdown" badge={`${walletStats.total} connects`}>
            <div style={{ padding: '8px 0' }}>
              {walletStats.byWallet.map((w, i) => {
                const pct = walletStats.total > 0 ? ((w.count / walletStats.total) * 100).toFixed(0) : '0';
                return (
                  <div key={w.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: i < walletStats.byWallet.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: `${TEAL}22`, border: `1px solid ${TEAL}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: TEAL, flexShrink: 0 }}>◈</div>
                    <div style={{ flex: 1, fontSize: 13, color: TEXT, fontWeight: 600 }}>{w.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 4, borderRadius: 2, background: BORDER, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: TEAL, borderRadius: 2 }} />
                      </div>
                      <span style={{ color: TEAL, fontSize: 13, fontWeight: 700, width: 28, textAlign: 'right' }}>{w.count}</span>
                      <span style={{ color: MUTED, fontSize: 11, width: 36 }}>{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {walletStats != null && walletStats.total === 0 && (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px', marginBottom: 20, color: MUTED, fontSize: 13 }}>
            No wallet connections yet. Data appears automatically when a user connects their Solana wallet.
          </div>
        )}

        {/* ── DB DISCONNECT BANNER — mencegah "0 palsu" tampil seperti data hilang ── */}
        {wlFetched && wlSource && wlSource !== 'neon' && (
          <div style={{ background: '#2a1207', border: `1px solid ${GOLD}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
            <div style={{ color: GOLD, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
              ⚠ Database TIDAK terhubung — angka di bawah TIDAK dapat dipercaya
            </div>
            <div style={{ color: TEXT, fontSize: 13, lineHeight: 1.5 }}>
              Aplikasi sedang membaca dari penyimpanan sementara (<code>source: {wlSource}</code>), bukan database.
              Data pendaftaran kemungkinan besar <b>masih aman tersimpan di database</b> — ini masalah koneksi,
              BUKAN data hilang atau di-hack. Periksa <code>DATABASE_URL</code> di Vercel,
              lalu buka <code>/api/waitlist/diag</code> untuk diagnosa.
            </div>
          </div>
        )}

        {/* ── WAITLIST SECTION ── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '1.8px', textTransform: 'uppercase', fontWeight: 700 }}>
            ◎ Waitlist Signups
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 20 }}>
          <StatCard label="Total Signups"  value={wlCount}                                                                        color={PURPLE} />
          <StatCard label="DB Status"      value={!wlFetched ? 'Ready' : wlSource === 'neon' ? 'Live' : 'FALLBACK'} color={!wlFetched ? TEAL : wlSource === 'neon' ? TEAL : GOLD} />
          <StatCard label="Latest Signup"  value={entries[0] ? new Date(entries[0].ts).toLocaleDateString('en-GB') : 'None'}      color={GOLD}   />
          <StatCard label="This Week"      value={entries.filter(e => e.ts > Date.now() - 7 * 86400_000).length}                  color={GREEN}  />
        </div>

        {wlError && (
          <div style={{ background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: 10, padding: '14px 18px', color: '#f87171', marginBottom: 20, fontSize: 14 }}>
            Error: {wlError}
          </div>
        )}

        <Section title="Signups" badge={`${wlCount} total`}>
          {!wlFetched ? (
            <div style={{ color: MUTED, padding: 40, textAlign: 'center', fontSize: 14 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ color: MUTED, padding: 40, textAlign: 'center', fontSize: 14 }}>
              {wlSource && wlSource !== 'neon'
                ? 'Database tidak terhubung — daftar tidak dapat dimuat (lihat peringatan di atas).'
                : 'No signups yet.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {['#', 'Email', 'Date', 'Time', 'Actions'].map(hd => (
                      <th key={hd} style={{ padding: '12px 16px', textAlign: hd === 'Actions' ? 'center' : 'left', color: MUTED, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{hd}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => {
                    const d    = new Date(entry.ts);
                    const isDel = deleting === entry.email;
                    return (
                      <tr key={entry.email} style={{ borderBottom: i < entries.length - 1 ? `1px solid ${BORDER}` : 'none', opacity: isDel ? 0.4 : 1, transition: 'opacity .2s' }}>
                        <td style={{ padding: '12px 16px', color: MUTED, fontSize: 13, width: 40 }}>{i + 1}</td>
                        <td style={{ padding: '12px 16px', color: TEXT, fontSize: 14 }}>{entry.email}</td>
                        <td style={{ padding: '12px 16px', color: MUTED, fontSize: 13 }}>{d.toLocaleDateString('en-GB')}</td>
                        <td style={{ padding: '12px 16px', color: MUTED, fontSize: 13 }}>{d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <button type="button" onClick={() => deleteEntry(entry.email)} disabled={!!deleting}
                            style={{ background: 'transparent', color: RED, border: `1px solid ${RED}44`, borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: deleting ? 'wait' : 'pointer', opacity: deleting ? 0.5 : 1 }}>
                            {isDel ? '…' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <p style={{ color: MUTED, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
          BlockBite Admin · Internal Tracker — real human visits via /api/track · Wallet connects · Waitlist from this company's own Neon database · Auto-refreshes every 30s
        </p>

      </div>
    </div>
  );
}
