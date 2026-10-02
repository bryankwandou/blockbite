'use client';

import { useEffect } from 'react';

/** Registers /sw.js so the site installs as an app (Android, iOS, Windows, macOS). Production only. */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* install stays optional */ });
  }, []);
  return null;
}
