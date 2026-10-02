'use client';

import Navbar from '@/components/Navbar';
import RankedCanvas from '@/components/game/RankedCanvas';

export default function RankedPage() {
  return (
    <>
      <Navbar />
      <main style={{ minHeight: '100vh', padding: '88px 16px 48px', background: 'var(--ds-bg)', color: 'var(--ds-text)', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          <RankedCanvas />
        </div>
      </main>
    </>
  );
}
