'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ReferralPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    if (code) {
      // Store the referral code so it can be attributed when wallet connects
      localStorage.setItem('bb_referrer_code', code);
    }
    // Redirect to home immediately
    router.replace('/');
  }, [code, router]);

  return null;
}
