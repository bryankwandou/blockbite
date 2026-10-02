'use client';
import { useState, useEffect } from 'react';

const BG     = '#0a0a0f';
const CARD   = '#13131a';
const PURPLE = '#7c3aed';
const TEAL   = '#0891b2';
const GOLD   = '#d97706';
const RED    = '#dc2626';
const TEXT   = '#f1f5f9';
const MUTED  = '#64748b';
const BORDER = '#1e293b';

type Entry = { email: string; ts: number };

function downloadCSV(entries: Entry[]) {
  const rows = entries.map(e => {
    const d = new Date(e.ts);
    return `"${e.email}","${d.toLocaleDateString('en-GB')}","${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}"`;
  });
  const csv = ['Email,Date,Time', ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blockbite-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [loggedIn, setLoggedIn]     = useState(false);
  const [authError, setAuthError]   = useState('');
  const [loading, setLoading]       = useState(false);
  const token = password;
  const [entries, setEntries]       = useState<Entry[]>([]);
  const [count, setCount]           = useState(0);
  const [fetched, setFetched]       = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [deleting, setDeleting]     = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { setAuthError('Enter username and password'); return; }
    if (username.trim() !== 'nayrbryanGaming') { setAuthError('Invalid username'); return; }
    setLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/waitlist/list', {
        headers: { 'x-admin-token': token.trim() },
      });
      if (res.status === 401) { setAuthError('Invalid token'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCount(data.count ?? 0);
      setEntries(data.entries ?? []);
      setFetched(true);
      setLoggedIn(true);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }

  async function fetchEntries(silent = false) {
    if (!silent) setLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/waitlist/list', {
        headers: { 'x-admin-token': token.trim() },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCount(data.count ?? 0);
      setEntries(data.entries ?? []);
      setFetched(true);
    } catch (err: unknown) {
      if (!silent) setFetchError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Live-sync: poll every 15s + refresh on tab focus, so the admin number
  // always matches Supabase truth (no frozen-UI drift across sessions).
  useEffect(() => {
    if (!loggedIn) return;
    const tick = () => { fetchEntries(true); };
    const id = setInterval(tick, 15_000);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  async function deleteEntry(email: string) {
    if (!confirm(`Delete ${email} from waitlist?`)) return;
    setDeleting(email);
    try {
      const res = await fetch(
        `/api/waitlist/list?email=${encodeURIComponent(email)}`,
        { method: 'DELETE', headers: { 'x-admin-token': token.trim() } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries(prev => prev.filter(e => e.email !== email));
      setCount(prev => Math.max(0, prev - 1));
    } catch {
      alert('Delete failed. Try again.');
    } finally {
      setDeleting(null);
    }
  }

  if (!loggedIn) {
    return (
      <div style={{
        minHeight: '100vh', background: BG, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}>
        <div style={{
          background: CARD, border: `1px solid ${BORDER}`, borderRadius: '16px',
          padding: '40px', width: '100%', maxWidth: '400px',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>◆</div>
            <h1 style={{ color: TEXT, fontSize: '22px', fontWeight: 700, margin: 0 }}>BlockBite Admin</h1>
            <p style={{ color: MUTED, fontSize: '13px', marginTop: '6px' }}>Waitlist Dashboard</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              style={{
                background: '#0f172a', border: `1px solid ${BORDER}`, borderRadius: '10px',
                color: TEXT, padding: '12px 16px', fontSize: '15px', outline: 'none',
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                background: '#0f172a', border: `1px solid ${BORDER}`, borderRadius: '10px',
                color: TEXT, padding: '12px 16px', fontSize: '15px', outline: 'none',
              }}
            />
            {authError && (
              <p style={{ color: '#f87171', fontSize: '13px', margin: 0 }}>{authError}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                background: `linear-gradient(135deg, ${PURPLE}, ${TEAL})`,
                color: '#fff', border: 'none', borderRadius: '10px',
                padding: '13px', fontSize: '15px', fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ color: TEXT, fontSize: '24px', fontWeight: 800, margin: 0 }}>Waitlist Dashboard</h1>
            <p style={{ color: MUTED, fontSize: '13px', margin: '4px 0 0' }}>BlockBite Admin</p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => downloadCSV(entries)}
                style={{
                  background: TEAL, color: '#fff', border: 'none', borderRadius: '10px',
                  padding: '10px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Download CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchEntries()}
              disabled={loading}
              style={{
                background: PURPLE, color: '#fff', border: 'none', borderRadius: '10px',
                padding: '10px 20px', fontSize: '14px', fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '28px' }}>
          {[
            { label: 'Total Signups', value: count,                                                   color: PURPLE },
            { label: 'DB Status',     value: fetched ? 'Live' : 'Ready',                              color: TEAL   },
            { label: 'Latest',        value: entries[0] ? new Date(entries[0].ts).toLocaleDateString() : 'None', color: GOLD },
          ].map((s) => (
            <div key={s.label} style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: '12px', padding: '20px',
            }}>
              <div style={{ color: s.color, fontSize: '26px', fontWeight: 800 }}>{s.value}</div>
              <div style={{ color: MUTED, fontSize: '12px', marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {fetchError && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #7f1d1d', borderRadius: '10px',
            padding: '14px 18px', color: '#f87171', marginBottom: '20px', fontSize: '14px',
          }}>
            Error: {fetchError}
          </div>
        )}

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px', borderBottom: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ color: TEXT, fontWeight: 700, fontSize: '15px' }}>Signups</span>
            <span style={{
              background: '#1e1b4b', color: '#a5b4fc', borderRadius: '20px',
              padding: '3px 12px', fontSize: '12px', fontWeight: 700,
            }}>{count} total</span>
          </div>

          {loading && !fetched ? (
            <div style={{ color: MUTED, padding: '40px', textAlign: 'center', fontSize: '14px' }}>Loading...</div>
          ) : entries.length === 0 ? (
            <div style={{ color: MUTED, padding: '40px', textAlign: 'center', fontSize: '14px' }}>
              {fetched ? 'No signups yet.' : 'Click Refresh to load entries.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {['#', 'Email', 'Date', 'Time', 'Actions'].map((h) => (
                      <th key={h} style={{
                        padding: '12px 16px', textAlign: h === 'Actions' ? 'center' : 'left',
                        color: MUTED, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => {
                    const d = new Date(entry.ts);
                    const isDeleting = deleting === entry.email;
                    return (
                      <tr key={entry.email} style={{
                        borderBottom: i < entries.length - 1 ? `1px solid ${BORDER}` : 'none',
                        opacity: isDeleting ? 0.4 : 1,
                        transition: 'opacity 0.2s',
                      }}>
                        <td style={{ padding: '12px 16px', color: MUTED, fontSize: '13px', width: '40px' }}>{i + 1}</td>
                        <td style={{ padding: '12px 16px', color: TEXT, fontSize: '14px' }}>{entry.email}</td>
                        <td style={{ padding: '12px 16px', color: MUTED, fontSize: '13px' }}>
                          {d.toLocaleDateString('en-GB')}
                        </td>
                        <td style={{ padding: '12px 16px', color: MUTED, fontSize: '13px' }}>
                          {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => deleteEntry(entry.email)}
                            disabled={!!deleting}
                            style={{
                              background: 'transparent', color: RED,
                              border: `1px solid ${RED}44`, borderRadius: '6px',
                              padding: '4px 12px', fontSize: '12px', fontWeight: 600,
                              cursor: deleting ? 'wait' : 'pointer',
                              opacity: deleting ? 0.5 : 1,
                            }}
                          >
                            {isDeleting ? '...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p style={{ color: MUTED, fontSize: '11px', textAlign: 'center', marginTop: '24px' }}>
          BlockBite Admin · Data from Supabase (or in-memory fallback)
        </p>
      </div>
    </div>
  );
}
