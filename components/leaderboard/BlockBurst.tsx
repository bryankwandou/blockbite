'use client';

import { useEffect, useState } from 'react';
import s from './BlockBurst.module.css';

const COLORS = ['#fbbf24', '#a78bfa', '#5eead4', '#f472b6', '#60a5fa', '#34d399'];
const N = 22;

/** True when motion should be skipped: OS reduced-motion, the in-app toggle, or low graphics. */
export function motionOff(): boolean {
  if (typeof window === 'undefined') return true;
  const d = document.documentElement;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || d.dataset.reduceMotion === 'true'
    || d.dataset.gfx === 'low';
}

/**
 * A one-shot burst of little square blocks from the centre of the parent
 * (which must be position: relative). Pure CSS, removed after it ends.
 * Renders nothing when motion is off.
 */
export default function BlockBurst({ onDone }: { onDone?: () => void }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (motionOff()) { onDone?.(); return; }
    setOn(true);
    const id = window.setTimeout(() => { setOn(false); onDone?.(); }, 1700);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!on) return null;
  return (
    <span className={s.burst} aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const a = (i / N) * Math.PI * 2 + (i % 2) * 0.2;
        const r = 70 + ((i * 37) % 60);
        return (
          <i
            key={i}
            style={{
              ['--dx' as string]: `${Math.round(Math.cos(a) * r)}px`,
              ['--dy' as string]: `${Math.round(Math.sin(a) * r - 40)}px`,
              ['--rot' as string]: `${(i * 67) % 360}deg`,
              background: COLORS[i % COLORS.length],
              animationDelay: `${(i % 5) * 25}ms`,
            }}
          />
        );
      })}
    </span>
  );
}
