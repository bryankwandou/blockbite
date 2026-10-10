'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ReferralPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    // Store the referral code so it can be attributed when wallet connects.
    // Only a wallet-shaped code is kept, and blocked/full storage must not
    // stop the redirect.
    if (code && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(code)) {
      try { localStorage.setItem('bb_referrer_code', code); } catch { /* storage blocked */ }
    }
    // Redirect to home immediately
    router.replace('/');
  }, [code, router]);

  return null;
}
