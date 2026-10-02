'use client';

import { useEffect, useState } from 'react';

/**
 * Prize vault USDC balance from /api/prizepool (read on-chain).
 * Shows a placeholder until the fetch finishes, and on errors, so it never
 * differs between server and client HTML.
 */
export default function PoolBalance({ className }: { className?: string }) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/prizepool', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.balance === 'number') setBalance(d.balance);
      })
      .catch(() => { /* keep the placeholder */ });
    return () => { alive = false; };
  }, []);

  return (
    <span className={className} dir="ltr">
      {balance === null ? '—' : balance.toFixed(2)}
    </span>
  );
}
