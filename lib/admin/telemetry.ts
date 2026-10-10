/**
 * Page-view recording, edge-safe (used by middleware.ts).
 * Stores no raw IP: visitor = sha256(ip | UTC day | secret), truncated.
 */

import { neon } from '@neondatabase/serverless';
import { PAGEVIEWS_DDL, SCHEMA, dbUrl } from './db';

let created: Promise<unknown> | null = null;

export function deviceClass(ua: string): string {
  if (!ua) return 'unknown';
  if (/bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(ua)) return 'bot';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function referrerHost(ref: string | null, ownHost: string): string | null {
  if (!ref) return null;
  try {
    const h = new URL(ref).hostname;
    return h && h !== ownHost ? h.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export async function visitorHash(ip: string, day: string): Promise<string> {
  const salt = process.env.ADMIN_SESSION_SECRET ?? process.env.RANKED_SECRET ?? 'blockbite';
  const data = new TextEncoder().encode(`${ip}|${day}|${salt}`) as Uint8Array<ArrayBuffer>;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recordPageView(v: {
  path: string; country: string | null; referrer: string | null; device: string; ip: string;
}): Promise<void> {
  const url = dbUrl();
  if (!url) return;
  const sql = neon(url);
  const visitor = await visitorHash(v.ip, new Date().toISOString().slice(0, 10));
  await (created ??= sql.query(PAGEVIEWS_DDL(SCHEMA)).catch((e) => { created = null; throw e; }));
  await sql.query(
    `INSERT INTO ${SCHEMA}.adm_pageviews (path, country, referrer, device, visitor) VALUES ($1, $2, $3, $4, $5)`,
    [v.path.slice(0, 200), v.country?.slice(0, 8) ?? null, v.referrer, v.device, visitor],
  );
}
