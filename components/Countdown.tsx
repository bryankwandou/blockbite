'use client';

import { useEffect, useState } from 'react';
import { PERIOD_END } from '@/lib/game/constants';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function getTimeLeft(end: Date): TimeLeft {
  const diff = Math.max(0, end.getTime() - Date.now());
  return {
    days:    Math.floor(diff / 86400000),
    hours:   Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

interface CountdownProps {
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export default function Countdown({ size = 'md', showLabel = true }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(getTimeLeft(PERIOD_END));
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const tl = getTimeLeft(PERIOD_END);
      setTimeLeft(tl);
      setUrgent(tl.days === 0 && tl.hours < 6);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');
  const fontSize = size === 'lg' ? 36 : size === 'md' ? 24 : 16;
  const labelSize = size === 'lg' ? 11 : 9;

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
    }}>
      {showLabel && (
        <span style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: 12,
          fontWeight: 600,
          color: urgent ? '#FF3366' : '#8888BB',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          animation: urgent ? 'countdownPulse 1s infinite' : 'none',
        }}>
          {urgent ? 'ENDING SOON' : 'Period Ends In'}
        </span>
      )}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        {[
          { value: timeLeft.days, label: 'D' },
          { value: timeLeft.hours, label: 'H' },
          { value: timeLeft.minutes, label: 'M' },
          { value: timeLeft.seconds, label: 'S' },
        ].map((unit, i) => (
          <span key={unit.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}>
              <span style={{
                fontFamily: "'Orbitron', monospace",
                fontSize,
                fontWeight: 800,
                color: urgent ? '#FF3366' : '#00F5FF',
                textShadow: urgent
                  ? '0 0 20px rgba(255,51,102,0.6)'
                  : '0 0 20px rgba(0,245,255,0.5)',
                minWidth: fontSize * 1.6,
                textAlign: 'center',
                lineHeight: 1,
              }}>
                {pad(unit.value)}
              </span>
              <span style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontSize: labelSize,
                color: '#55557A',
                fontWeight: 600,
                letterSpacing: '0.06em',
              }}>
                {unit.label}
              </span>
            </span>
            {i < 3 && (
              <span style={{
                fontFamily: "'Orbitron', monospace",
                fontSize,
                fontWeight: 800,
                color: urgent ? '#FF3366' : '#33337A',
                marginTop: -8,
              }}>:</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
