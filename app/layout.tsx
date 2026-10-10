import type { Metadata } from 'next';
import '../styles/globals.css';
import './globals.css';
import '../styles/themes.css';
import AppWalletProvider from "@/components/AppWalletProvider";
import { AppProvider } from '@/lib/useApp';
import { LOCALES } from '@/lib/i18n/locales';
import { Suspense } from 'react';
import { GFX_INIT_SCRIPT } from '@/lib/gfx';
import MusicController from '@/components/audio/MusicController';
import PwaRegister from '@/components/PwaRegister';
import { PageTracker } from '@/components/PageTracker';
import { WalletTracker } from '@/components/WalletTracker';
import SkipLink from '@/components/SkipLink';

export const metadata: Metadata = {
  metadataBase: new URL('https://blockbite.vercel.app'),
  title: 'BlockBite · Block puzzle on Solana',
  description: 'An 8×8 block puzzle on Solana. Adventure mode is free. Daily Ranked: one board per UTC day, every try deals its own pieces, 1 USDC per try, best of 3 counts.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'BlockBite', statusBarStyle: 'black-translucent' },
  keywords: ['BlockBite', 'block puzzle', 'Solana', 'USDC', 'daily puzzle', 'skill game', 'arcade'],
  openGraph: {
    title: 'BlockBite · One board a day. Best score wins.',
    description: 'An 8×8 block puzzle on Solana. Free Adventure mode, plus a daily ranked board: same start for everyone, own pieces every try.',
    type: 'website',
    url: 'https://blockbite.vercel.app',
    siteName: 'BlockBite',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BlockBite · Block puzzle on Solana',
    description: 'One board a day. Every try deals its own pieces. Adventure mode is free.',
  },
};

// Language → text direction, taken from the locale list so it never drifts.
const DIRS: Record<string, string> = Object.fromEntries(LOCALES.map((l) => [l.code, l.dir]));

// Runs before first paint and before hydration, so theme, lang and dir are right
// even if a page's React tree fails to hydrate. Honors ?theme= and ?lang=.
const INIT_SCRIPT = `(function(){try{
var d=document.documentElement,q=new URLSearchParams(location.search),dirs=${JSON.stringify(DIRS)};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
var tp=q.get('theme');if(tp==='light'||tp==='dark'||tp==='system'){ls('bb:theme',tp)}
var th=ls('bb:theme');if(th!=='light'&&th!=='dark'){th=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
d.setAttribute('data-theme',th);d.style.colorScheme=th;
var lp=q.get('lang'),lang=null;
if(lp&&dirs[lp]){lang=lp;ls('bb:lang',lp)}
if(!lang){var s=ls('bb:lang');if(s&&dirs[s])lang=s}
if(!lang){var nl=(navigator.languages||[navigator.language||'en']);for(var i=0;i<nl.length&&!lang;i++){var t=String(nl[i]||'').toLowerCase(),b=t.split('-')[0];
if(b==='zh')lang=/tw|hk|mo|hant/.test(t)?'zh-Hant':'zh-Hans';else if(b==='tl')lang='fil';else if(b==='iw')lang='he';else if(dirs[b])lang=b}}
lang=lang||'en';d.setAttribute('lang',lang);d.setAttribute('dir',dirs[lang]||'ltr');
var rm=ls('bb:reduce-motion');if(rm==='1')d.setAttribute('data-reduce-motion','true');
var pl=ls('bb:palette');if(pl&&/^(c:)?[a-z]{3,10}(-[0-9]{1,3}-[0-4])?$/.test(pl)){d.setAttribute('data-palette',pl.replace('c:','').split('-')[0]);if(pl.indexOf('c:')===0){var cs='';['light','dark'].forEach(function(m){var v=ls('bb:pv-'+m);if(v&&/^(--[a-z0-9-]{2,12}:#[0-9a-f]{6};){1,24}$/.test(v))cs+="html:root[data-theme='"+m+"'][data-palette]{"+v+"}"});var st=document.createElement('style');st.id='bb-palette-custom';st.textContent=cs;document.head.appendChild(st)}}
}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0a1a" />
        {/* Theme and language initialization: must run before paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
        {/* Graphics level (data-gfx) before first paint */}
        <script dangerouslySetInnerHTML={{ __html: GFX_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bungee&family=Orbitron:wght@500;700;900&family=Space+Grotesk:wght@400;500;600;700;800;900&family=Montserrat:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
        {/* favicon is auto-injected from app/icon.png by Next.js Metadata Files convention */}
      </head>
      <body>
        <SkipLink />
        <AppProvider>
          <AppWalletProvider>
            {children}
            <Suspense fallback={null}><MusicController /></Suspense>
            <PwaRegister />
            <WalletTracker />
          </AppWalletProvider>
        </AppProvider>
        <PageTracker />
      </body>
    </html>
  );
}
