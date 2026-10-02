import { NextResponse } from 'next/server';

const BUNDLES: Record<string, Record<string, string>> = {
  en: {
    nav_home: 'Home', nav_play: 'Play', nav_map: 'Map',
    nav_shop: 'Shop', nav_leader: 'Leaderboard', nav_profile: 'Profile',
    nav_admin: 'Admin', nav_history: 'History', nav_claim: 'Claim',
    settings_title: 'Settings', language: 'Language', theme: 'Theme',
    dark: 'Dark', light: 'Light',
    sound: 'Sound Effects', music: 'Background Music',
    motion: 'Reduce Motion', notif: 'Notifications',
    rpc: 'RPC Endpoint', disconnect: 'Disconnect Wallet', connect: 'Connect Wallet',
    tickets: 'Tickets', level: 'Level', claimed: 'Claimed', vault: 'Vault',
    no_data: 'No data', backend_off: 'Backend offline',
    empty_lb: 'No entries yet. Connect wallet to appear.',
    empty_hist: 'No history yet.',
    join_waitlist: 'Join Waitlist',
    waitlist_note: 'No spam. Unsubscribe anytime.',
    waitlist_success: "You're on the list! We'll notify you when BlockBite launches.",
  },
  id: {
    nav_home: 'Beranda', nav_play: 'Main', nav_map: 'Peta',
    nav_shop: 'Toko', nav_leader: 'Papan Skor', nav_profile: 'Profil',
    nav_admin: 'Admin', nav_history: 'Riwayat', nav_claim: 'Klaim',
    settings_title: 'Pengaturan', language: 'Bahasa', theme: 'Tema',
    dark: 'Gelap', light: 'Terang',
    sound: 'Efek Suara', music: 'Musik Latar',
    motion: 'Kurangi Animasi', notif: 'Notifikasi',
    rpc: 'Endpoint RPC', disconnect: 'Putuskan Wallet', connect: 'Hubungkan Wallet',
    tickets: 'Tiket', level: 'Level', claimed: 'Diklaim', vault: 'Vault',
    no_data: 'Tidak ada data', backend_off: 'Backend offline',
    empty_lb: 'Belum ada data. Hubungkan wallet.',
    empty_hist: 'Belum ada riwayat.',
    join_waitlist: 'Daftar Waitlist',
    waitlist_note: 'Tanpa spam. Bisa berhenti kapan saja.',
    waitlist_success: 'Kamu sudah terdaftar! Kami akan notifikasi saat BlockBite meluncur.',
  },
};

export async function GET(
  _req: Request,
  { params }: { params: { lang: string } },
) {
  const lang = params.lang === 'id' ? 'id' : 'en';

  // Try KV override (designers can hot-edit without redeploy)
  try {
    const { kv } = await import('@vercel/kv');
    const override = await kv.get<Record<string, string>>(`blockbite:i18n:${lang}`);
    if (override) return NextResponse.json(override);
  } catch { /* fallback */ }

  return NextResponse.json(BUNDLES[lang]);
}
