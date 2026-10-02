/**
 * Client-side error reporter.
 * Stores structured crash/bug reports in localStorage under key "bb_error_log".
 * The /dev/dashboard page reads and displays them.
 * In production, `flush()` would POST to an API route.
 */

import { getStageName, getTierCode } from '@/lib/game/stages';

const STORAGE_KEY = 'bb_error_log';
const MAX_STORED = 500;

export type ErrorSeverity = 'crash' | 'error' | 'warning' | 'info';

export interface ErrorReport {
  id: string;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  stageName: string;       // e.g. "Cursed-00021"
  tierCode: string;        // e.g. "CRS"
  level: number;
  sessionId: string;
  walletAddress?: string;
  component?: string;      // React component name or page path
  extra?: Record<string, unknown>;
  timestamp: number;       // unix ms
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Store a new error report to localStorage. */
export function reportError(params: {
  severity?: ErrorSeverity;
  message: string;
  error?: Error | unknown;
  level?: number;
  sessionId?: string;
  walletAddress?: string;
  component?: string;
  extra?: Record<string, unknown>;
}): void {
  const level = params.level ?? 0;
  const report: ErrorReport = {
    id: genId(),
    severity: params.severity ?? 'error',
    message: params.message,
    stack: params.error instanceof Error ? params.error.stack : undefined,
    stageName: level > 0 ? getStageName(level) : 'MENU',
    tierCode: level > 0 ? getTierCode(level) : 'SYS',
    level,
    sessionId: params.sessionId ?? 'unknown',
    walletAddress: params.walletAddress,
    component: params.component,
    extra: params.extra,
    timestamp: Date.now(),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const existing: ErrorReport[] = raw ? JSON.parse(raw) : [];
    existing.unshift(report);               // newest first
    if (existing.length > MAX_STORED) existing.splice(MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // localStorage unavailable — silently ignore
  }
  sendRemote(report);
}

// ── Remote reporting (/api/admin/errors) ─────────────────────────────
// Sends message, first stack lines, path and build id. No wallet, no extra
// fields. At most 5 reports per page load, and each distinct message once.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev';
let remoteSent = 0;
const remoteSeen = new Set<string>();

function sendRemote(r: ErrorReport): void {
  if (typeof window === 'undefined' || r.severity === 'info') return;
  if (remoteSent >= 5 || remoteSeen.has(r.message)) return;
  remoteSeen.add(r.message);
  remoteSent++;
  const payload = JSON.stringify({
    message: r.message.slice(0, 300),
    stack: r.stack?.split('\n').slice(0, 6).join('\n').slice(0, 1200),
    path: window.location.pathname,
    build: BUILD,
  });
  try {
    fetch('/api/admin/errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
      .catch(() => { /* reporting must never throw */ });
  } catch { /* noop */ }
}

/** Read all stored reports. */
export function getStoredReports(): ErrorReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Clear all stored reports. */
export function clearReports(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}

/** Global unhandled error hook — call once in layout. */
export function installGlobalErrorHandler(sessionId: string, getLevel: () => number): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (ev) => {
    reportError({
      severity: 'crash',
      message: ev.message || 'Unhandled error',
      error: ev.error,
      level: getLevel(),
      sessionId,
      component: 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const msg = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    reportError({
      severity: 'crash',
      message: `Unhandled promise rejection: ${msg}`,
      error: ev.reason,
      level: getLevel(),
      sessionId,
      component: 'window.onunhandledrejection',
    });
  });
}
