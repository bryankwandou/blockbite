import type { MetadataRoute } from 'next';

const BASE = 'https://blockbite.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/', '/admin', '/waitlist/dashboard', '/partner', '/account', '/profile',
          '/settings', '/onboarding', '/r/', '/challenge/', '/play/',
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
