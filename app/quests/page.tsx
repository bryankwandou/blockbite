'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import Navbar from '@/components/Navbar';
import type { Quest, QuestCompletion } from '@/lib/quests/store';
import { RankedClient } from '@/lib/ranked/client';

/**
 * Public quest feed for users.
 *
 * Shows every active quest from every admin. Each quest can be submitted
 * for verification — admins review on /distribute/quests.
 *
 * Per-user submission status renders inline so the user knows whether to
 * resubmit, wait for review, or move on.
 */
export default function QuestsPage() {
  const { publicKey, connected, signMessage } = useWallet();
  const { setVisible } = useWalletModal();

  const [quests,       setQuests]       = useState<Quest[]>([]);
  const [mySubs,       setMySubs]       = useState<Record<string, QuestCompletion>>({});
  const [proofInput,   setProofInput]   = useState<Record<string, string>>({});
  const [openQuest,    setOpenQuest]    = useState<string | null>(null);
  const [busy,         setBusy]         = useState<string | null>(null);
  const [loading,      setLoading]      = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/quests', { cache: 'no-store' });
      const data = await res.json();
      setQuests((data.quests ?? []) as Quest[]);

      if (publicKey) {
        const wallet = publicKey.toBase58();
        // Fetch each quest's review feed and pick out our wallet's row.
        // For Phase 0 this is N requests — fine for tens of quests; W7
        // adds /api/quests/mine?wallet=... aggregator.
        const subs: Record<string, QuestCompletion> = {};
        await Promise.all(
          (data.quests as Quest[]).map(async (q) => {
            try {
              // Public can't hit review GET (admin-only). For user side we
              // optimistically POST submit with no proof to fetch existing
              // record? No — we'd write. Skip: user state shown only after
              // they themselves submit during this session.
              // Future: dedicated /api/quests/[id]/me?wallet endpoint.
              void q; void wallet;
            } catch { /* ignore */ }
          }),
        );
        setMySubs(subs);
      }
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = useCallback(async (q: Quest) => {
    if (!publicKey || !signMessage) return;
    const proof = (proofInput[q.id] ?? '').trim();
    if (!proof) return;
    setBusy(q.id);
    try {
      // One wallet signature per tab session proves the submission is yours.
      const client = await RankedClient.connect(publicKey.toBase58(), signMessage);
      const res = await fetch(`/api/quests/${q.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: client.authorization },
        body: JSON.stringify({ proof }),
      });
      const data = await res.json();
      if (data.completion) {
        setMySubs((m) => ({ ...m, [q.id]: data.completion }));
      }
      setProofInput((p) => ({ ...p, [q.id]: '' }));
      setOpenQuest(null);
    } finally {
      setBusy(null);
    }
  }, [publicKey, signMessage, proofInput]);

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--ds-bg)', color: 'var(--ds-text)',
      fontFamily: "'Montserrat', 'Space Grotesk', system-ui, sans-serif",
    }}>
      <Navbar />
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '120px 24px 80px' }}>

        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, marginBottom: 6 }}>Quests</h1>
        <p style={{ color: 'var(--ds-text-dim)', fontSize: 13, marginBottom: 26 }}>
          Tasks posted by partners. Submit proof and a reviewer checks it.
        </p>

        {!connected && (
          <div style={{
            padding: 22, borderRadius: 14, marginBottom: 18,
            background: 'rgba(167,139,250,0.06)', border: '1px solid var(--ds-border)',
            textAlign: 'center',
          }}>
            <p style={{ color: 'var(--ds-text-dim)', marginBottom: 12, fontSize: 13 }}>
              Connect a wallet to submit quest completions.
            </p>
            <button
              type="button" onClick={() => setVisible(true)}
              style={{
                padding: '10px 18px', borderRadius: 10, border: 'none',
                background: 'var(--ds-grad)', color: '#0a0a14',
                fontWeight: 800, fontSize: 13, cursor: 'pointer',
              }}>
              CONNECT WALLET
            </button>
          </div>
        )}

        {loading && <div style={{ color: 'var(--ds-text-dim)', fontSize: 13, textAlign: 'center', padding: 30 }}>Loading quests…</div>}

        {!loading && quests.length === 0 && (
          <div style={{
            padding: 30, borderRadius: 14, textAlign: 'center',
            background: 'var(--ds-surface)', border: '1px solid var(--ds-border)',
          }}>
            <p style={{ color: 'var(--ds-text-dim)', fontSize: 13 }}>
              No active quests right now. Check back soon.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {quests.map((q) => {
            const sub  = mySubs[q.id];
            const open = openQuest === q.id;
            return (
              <div key={q.id} style={{
                padding: 18, borderRadius: 14,
                background: 'var(--ds-surface)', border: '1px solid var(--ds-border)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, letterSpacing: 1.4, color: 'var(--ds-accent)', fontWeight: 700, marginBottom: 4 }}>
                      {q.type.toUpperCase()} · {q.rewardLabel}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{q.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ds-text-dim)', marginTop: 6, lineHeight: 1.6 }}>
                      {q.description}
                    </div>
                  </div>
                  {sub ? (
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
                      padding: '4px 10px', borderRadius: 999,
                      background: sub.status === 'approved' ? 'rgba(94,234,212,0.18)'
                                : sub.status === 'rejected' ? 'rgba(244,114,182,0.18)'
                                : 'rgba(251,191,36,0.18)',
                      color: sub.status === 'approved' ? '#5eead4'
                            : sub.status === 'rejected' ? '#f472b6'
                            : '#fbbf24',
                      whiteSpace: 'nowrap',
                    }}>
                      {sub.status.toUpperCase()}
                    </span>
                  ) : connected ? (
                    <button type="button"
                      onClick={() => setOpenQuest(open ? null : q.id)}
                      style={{
                        padding: '8px 14px', borderRadius: 8,
                        border: '1px solid var(--ds-accent)',
                        background: open ? 'var(--ds-grad)' : 'transparent',
                        color: open ? '#0a0a14' : 'var(--ds-accent)',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                      {open ? 'CANCEL' : 'SUBMIT'}
                    </button>
                  ) : null}
                </div>

                {open && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 10, letterSpacing: 1.5, color: 'var(--ds-text-dim)', fontWeight: 700 }}>
                      Proof (link, txn signature, screenshot URL, etc.)
                    </label>
                    <textarea
                      rows={2}
                      value={proofInput[q.id] ?? ''}
                      onChange={(e) => setProofInput((p) => ({ ...p, [q.id]: e.target.value }))}
                      placeholder="https://x.com/yourhandle/status/..."
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ds-border)',
                        color: 'var(--ds-text)', fontSize: 13, outline: 'none',
                        fontFamily: 'inherit', resize: 'vertical',
                      }}
                    />
                    <button type="button"
                      onClick={() => handleSubmit(q)}
                      disabled={busy === q.id || !(proofInput[q.id] ?? '').trim()}
                      style={{
                        padding: '10px 14px', borderRadius: 10, border: 'none',
                        background: busy !== q.id && (proofInput[q.id] ?? '').trim()
                          ? 'var(--ds-grad)' : 'rgba(255,255,255,0.08)',
                        color: busy !== q.id && (proofInput[q.id] ?? '').trim()
                          ? '#0a0a14' : 'var(--ds-text-dim)',
                        fontWeight: 800, fontSize: 13,
                        cursor: busy === q.id ? 'wait' : 'pointer',
                      }}>
                      {busy === q.id ? 'SUBMITTING…' : 'SUBMIT FOR REVIEW'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
