'use client';

/** Small shared pieces for /admin and /partner. Charts are plain SVG. */

import type { ReactNode } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import s from './console.module.css';

export { s };

export function Empty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}

export function Source({ label, children }: { label: string; children: ReactNode }) {
  return <p className={s.source}>{label}: {children}</p>;
}

export function Kpi({ label, value, empty }: { label: string; value: ReactNode | null | undefined; empty: string }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiLabel}>{label}</div>
      <div className={s.kpiValue}>{value === null || value === undefined ? <span className={s.empty}>{empty}</span> : value}</div>
    </div>
  );
}

/** Vertical bars, one per item; optional second series drawn on top. */
export function Bars({ data, label }: { data: { k: string; a: number; b?: number }[]; label: string }) {
  if (!data.length) return null;
  const W = 600;
  const H = 120;
  const max = Math.max(1, ...data.map((d) => d.a));
  const w = W / data.length;
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {data.map((d, i) => {
        const h = (d.a / max) * (H - 14);
        const h2 = ((d.b ?? 0) / max) * (H - 14);
        return (
          <g key={d.k}>
            <title>{`${d.k}: ${d.a}${d.b !== undefined ? ` / ${d.b}` : ''}`}</title>
            <rect className={s.bar} x={i * w + 1} y={H - 12 - h} width={Math.max(1, w - 2)} height={h} />
            {d.b !== undefined && <rect className={s.bar2} x={i * w + w * 0.25} y={H - 12 - h2} width={Math.max(1, w * 0.5)} height={h2} />}
          </g>
        );
      })}
      <text className={s.axis} x={0} y={H - 1}>{data[0].k}</text>
      <text className={s.axis} x={W} y={H - 1} textAnchor="end">{data[data.length - 1].k}</text>
    </svg>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function short(w: string) {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

export const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });

/** Not-signed-in card: connect wallet, then sign the nonce message. */
export function SignInCard(p: {
  wallet: string | null; busy: boolean; error: string | null; configured: boolean; onSignIn: () => void;
  t: (k: string, v?: Record<string, string | number>) => string; note: string;
}) {
  const { setVisible } = useWalletModal();
  return (
    <section className={s.card}>
      <p className={s.note}>{p.note}</p>
      {!p.configured && <p className={s.error}>{p.t('not_configured')}</p>}
      <div className={s.row} style={{ marginTop: 12 }}>
        {!p.wallet
          ? <button type="button" className={s.btn} onClick={() => setVisible(true)}>{p.t('connect')}</button>
          : <button type="button" className={s.btn} disabled={p.busy || !p.configured} onClick={p.onSignIn}>{p.busy ? p.t('signing') : p.t('sign_in')}</button>}
      </div>
      {p.error && <p className={s.error} role="alert">{p.error}</p>}
    </section>
  );
}
