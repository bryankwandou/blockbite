import { ImageResponse } from 'next/og';

export const alt = 'BlockBite · An 8×8 block puzzle on Solana. One board a day, best score wins.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const cells = Array.from({ length: 24 }, (_, i) => i);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          justifyContent: 'center', padding: '0 96px',
          background: 'linear-gradient(180deg, #1e1b4b 0%, #08081a 100%)', color: '#fff',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', width: 360, marginBottom: 40 }}>
          {cells.map((i) => (
            <div
              key={i}
              style={{
                width: 48, height: 48, margin: 6, borderRadius: 10,
                background: i % 5 === 0 ? '#5eead4' : i % 3 === 0 ? '#a78bfa' : '#1f1f3a',
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 112, fontWeight: 800, color: '#a78bfa', letterSpacing: -2 }}>BlockBite</div>
        <div style={{ fontSize: 44, marginTop: 12 }}>One board a day. Best score wins.</div>
        <div style={{ fontSize: 30, marginTop: 20, color: '#94a3b8' }}>8×8 block puzzle on Solana · Free Adventure mode</div>
      </div>
    ),
    { ...size },
  );
}
