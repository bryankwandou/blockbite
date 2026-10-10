import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { deviceClass, recordPageView, referrerHost } from '@/lib/admin/telemetry';

/**
 * 1. Redirects uppercase variants of known routes (/SHOP, /Leaderboard/x …) to
 *    the lowercase path with a 308. Only paths that actually contain uppercase
 *    letters are touched, so this can never loop.
 * 2. Records a page view into adm_pageviews without delaying the response
 *    (event.waitUntil). No raw IP is stored; see lib/admin/telemetry.ts.
 */
const ROUTES = new Set([
  'partnership', 'quests', 'leaderboard', 'shop', 'guide', 'map', 'profile', 'waitlist',
  'game', 'play', 'claim', 'ranked', 'how-to-play', 'settings', 'admin', 'partner',
]);

export function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;
  const first = pathname.split('/')[1] ?? '';
  if (first !== first.toLowerCase() && ROUTES.has(first.toLowerCase())) {
    const url = req.nextUrl.clone();
    url.pathname = `/${first.toLowerCase()}${pathname.slice(first.length + 1)}`;
    return NextResponse.redirect(url, 308);
  }

  const prefetch = req.headers.get('next-router-prefetch') || req.headers.get('purpose') === 'prefetch'
    || req.headers.get('x-middleware-prefetch');
  if (req.method === 'GET' && !prefetch) {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
    event.waitUntil(
      recordPageView({
        path: pathname,
        country: req.headers.get('x-vercel-ip-country'),
        referrer: referrerHost(req.headers.get('referer'), req.nextUrl.hostname),
        device: deviceClass(req.headers.get('user-agent') ?? ''),
        ip,
      }).catch(() => { /* telemetry must never break a page */ }),
    );
  }
  return NextResponse.next();
}

export const config = {
  // `\\.` so the regex sees an escaped dot: a single `\.` in a JS string is
  // just `.`, which excluded every path and the redirect never ran.
  // Excludes api, _next and any static file (path with a dot).
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
