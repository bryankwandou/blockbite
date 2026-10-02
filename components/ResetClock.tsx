'use client';

import { useEffect, useState } from 'react';

/** Next UTC midnight ('day') or next UTC month start ('month'), in ms. */
function nextBoundary(kind: 'day' | 'month', now: number): number {
  const d = new Date(now);
  return kind === 'day'
    ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Time left until the UTC day or month ends. Renders a fixed placeholder on
 * the server and on the first client pass, and only starts ticking after
 * mount, so server and client HTML always match (no hydration error).
 */
export default function ResetClock({
  kind,
  className,
  daysLabel = (n) => `${n}d`,
}: {
  kind: 'day' | 'month';
  className?: string;
  daysLabel?: (n: number) => string;
}) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setLeft(Math.max(0, nextBoundary(kind, now) - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [kind]);

  if (left === null) {
    return <span className={className} dir="ltr">--:--:--</span>;
  }
  const s = Math.floor(left / 1000);
  const days = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return (
    <span className={className} dir="ltr" suppressHydrationWarning>
      {days > 0 ? `${daysLabel(days)} ${hms}` : hms}
    </span>
  );
}
