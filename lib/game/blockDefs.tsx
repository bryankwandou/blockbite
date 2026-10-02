import React from 'react';

type BlockRender = (s?: number) => React.ReactElement;
interface BlockDef { id: string; render: BlockRender }
const block = (id: string, render: BlockRender): BlockDef => ({ id, render });

// ── CRYSTAL ──
const shard = block('shard', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><linearGradient id="shard-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#e9d5ff"/><stop offset="50%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#5b21b6"/>
    </linearGradient></defs>
    <polygon points="32,4 56,28 48,58 16,58 8,28" fill="url(#shard-g)" stroke="#c4b5fd" strokeWidth="1.5"/>
    <polygon points="32,4 32,58 8,28" fill="#ffffff" opacity="0.18"/>
    <line x1="32" y1="4" x2="32" y2="58" stroke="#f5f3ff" strokeWidth="1" opacity="0.6"/>
  </svg>
));
const geode = block('geode', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="26" fill="#3d1f5e" stroke="#2a1245" strokeWidth="2"/>
    <circle cx="32" cy="32" r="20" fill="#1a0a2e"/>
    {[0,60,120,180,240,300].map((a,i)=>{const x=32+Math.cos(a*Math.PI/180)*12,y=32+Math.sin(a*Math.PI/180)*12;return<polygon key={i} points={`${x},${y-5} ${x+4},${y+4} ${x-4},${y+4}`} fill="#a78bfa" stroke="#e9d5ff" strokeWidth="0.5"/>;})}
    <circle cx="32" cy="32" r="3" fill="#f5f3ff"/>
  </svg>
));
const amethyst = block('amethyst', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <polygon points="32,6 50,20 50,44 32,58 14,44 14,20" fill="#7c3aed" stroke="#c4b5fd" strokeWidth="1.5"/>
    <polygon points="32,6 50,20 32,32 14,20" fill="#a78bfa"/>
    <polygon points="32,6 32,32 14,20" fill="#e9d5ff" opacity="0.7"/>
  </svg>
));
const echo = block('echo', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="28" fill="none" stroke="#67e8f9" strokeWidth="1" opacity="0.4"/>
    <circle cx="32" cy="32" r="22" fill="none" stroke="#67e8f9" strokeWidth="1.5" opacity="0.6"/>
    <circle cx="32" cy="32" r="14" fill="#0e7490" stroke="#67e8f9" strokeWidth="2"/>
    <circle cx="32" cy="32" r="6" fill="#a5f3fc"/>
  </svg>
));
const rune = block('rune', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="6" y="6" width="52" height="52" rx="6" fill="#1f1d3a" stroke="#a78bfa" strokeWidth="2"/>
    <path d="M 20 18 L 32 14 L 44 18 L 44 46 L 32 50 L 20 46 Z" fill="none" stroke="#c4b5fd" strokeWidth="1.5"/>
    <line x1="32" y1="14" x2="32" y2="50" stroke="#e9d5ff" strokeWidth="1.2"/>
    <circle cx="32" cy="32" r="3" fill="#f0abfc"/>
  </svg>
));

// ── FROST ──
const ice = block('ice', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="6" y="6" width="52" height="52" rx="4" fill="#bae6fd" stroke="#0ea5e9" strokeWidth="1.5" opacity="0.85"/>
    <polygon points="6,6 58,6 58,30 6,58" fill="#e0f2fe" opacity="0.6"/>
    <line x1="14" y1="14" x2="22" y2="22" stroke="#ffffff" strokeWidth="1.2"/>
    <line x1="40" y1="14" x2="50" y2="24" stroke="#ffffff" strokeWidth="1.2"/>
  </svg>
));
const frost = block('frost', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#0c4a6e"/>
    {[[20,20],[44,20],[20,44],[44,44],[32,32]].map((p,i)=>(
      <g key={i} transform={`translate(${p[0]} ${p[1]})`}>
        <line x1="-6" y1="0" x2="6" y2="0" stroke="#bae6fd" strokeWidth="1.2"/>
        <line x1="0" y1="-6" x2="0" y2="6" stroke="#bae6fd" strokeWidth="1.2"/>
        <line x1="-4" y1="-4" x2="4" y2="4" stroke="#bae6fd" strokeWidth="1"/>
        <line x1="-4" y1="4" x2="4" y2="-4" stroke="#bae6fd" strokeWidth="1"/>
      </g>
    ))}
  </svg>
));
const glacier = block('glacier', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <polygon points="4,58 16,20 28,40 40,16 52,42 60,58" fill="#e0f2fe" stroke="#0ea5e9" strokeWidth="1.5"/>
    <polygon points="16,20 28,40 22,58 8,58" fill="#7dd3fc" opacity="0.6"/>
    <polygon points="40,16 52,42 46,58 32,58" fill="#7dd3fc" opacity="0.6"/>
  </svg>
));
const aurora = block('aurora', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><linearGradient id="aur-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#5eead4"/><stop offset="50%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#0c4a6e"/>
    </linearGradient></defs>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="url(#aur-g)"/>
    <path d="M 8 20 Q 24 12, 40 22 Q 56 32, 56 22" stroke="#f0fdfa" strokeWidth="2" fill="none" opacity="0.7"/>
    <path d="M 8 36 Q 28 28, 48 38 Q 56 42, 56 38" stroke="#bae6fd" strokeWidth="1.5" fill="none" opacity="0.6"/>
  </svg>
));
const snowflake = block('snowflake', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="28" fill="#1e3a5f" stroke="#bae6fd" strokeWidth="1.5"/>
    <g stroke="#f0f9ff" strokeWidth="1.5" strokeLinecap="round">
      {[0,60,120].map((a,i)=>{const r=a*Math.PI/180,x=Math.cos(r)*20,y=Math.sin(r)*20;return<line key={i} x1={32-x} y1={32-y} x2={32+x} y2={32+y}/>;})}
    </g>
  </svg>
));

// ── EMBER ──
const ember = block('ember', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><radialGradient id="emb-g" cx="50%" cy="60%" r="50%">
      <stop offset="0%" stopColor="#fef3c7"/><stop offset="50%" stopColor="#fb923c"/><stop offset="100%" stopColor="#7c2d12"/>
    </radialGradient></defs>
    <circle cx="32" cy="36" r="26" fill="url(#emb-g)"/>
    <path d="M 32 6 Q 22 20, 28 30 Q 18 30, 22 44 Q 32 38, 36 30 Q 46 28, 40 18 Q 36 12, 32 6 Z" fill="#fbbf24" opacity="0.85"/>
  </svg>
));
const magma = block('magma', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#1c0a08"/>
    <path d="M 6 20 Q 18 14, 30 22 Q 42 30, 58 22 L 58 36 Q 44 42, 30 36 Q 18 32, 6 38 Z" fill="#dc2626"/>
    <path d="M 8 26 Q 20 22, 32 28 Q 44 34, 56 28" stroke="#fbbf24" strokeWidth="1.5" fill="none" opacity="0.85"/>
  </svg>
));
const cinder = block('cinder', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <polygon points="32,4 50,16 56,38 42,58 22,58 8,38 14,16" fill="#3d1f15" stroke="#f97316" strokeWidth="2"/>
    <circle cx="32" cy="32" r="10" fill="#dc2626"/>
    <circle cx="32" cy="32" r="5" fill="#fbbf24"/>
  </svg>
));
const forge = block('forge', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="20" width="56" height="40" rx="3" fill="#1c0a08" stroke="#78350f" strokeWidth="2"/>
    <rect x="10" y="26" width="44" height="18" rx="2" fill="#dc2626"/>
    <rect x="10" y="26" width="44" height="6" fill="#fbbf24"/>
    {[14,22,30,38,46].map((x,i)=><line key={i} x1={x} y1="20" x2={x} y2="4" stroke="#fb923c" strokeWidth="1.5" opacity="0.7"/>)}
  </svg>
));
const phoenix = block('phoenix', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="28" fill="#7c2d12" stroke="#fbbf24" strokeWidth="2"/>
    <path d="M 32 12 Q 18 28, 22 42 Q 32 50, 42 42 Q 46 28, 32 12 Z" fill="#f97316"/>
    <path d="M 32 18 Q 26 30, 30 40 Q 32 44, 34 40 Q 38 30, 32 18 Z" fill="#fcd34d"/>
    <circle cx="32" cy="28" r="2" fill="#1c0a08"/>
  </svg>
));

// ── VERDANT ──
const leaf = block('leaf', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <path d="M 32 6 Q 12 20, 14 40 Q 16 56, 32 58 Q 48 56, 50 40 Q 52 20, 32 6 Z" fill="#22c55e" stroke="#166534" strokeWidth="1.5"/>
    <path d="M 32 6 L 32 58" stroke="#166534" strokeWidth="1.5"/>
  </svg>
));
const mushroom = block('mushroom', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="26" y="32" width="12" height="24" rx="3" fill="#fef3c7" stroke="#a8a29e" strokeWidth="1"/>
    <ellipse cx="32" cy="30" rx="24" ry="18" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.5"/>
    <circle cx="22" cy="24" r="3" fill="#fef3c7"/>
    <circle cx="38" cy="20" r="3" fill="#fef3c7"/>
    <circle cx="42" cy="32" r="2.5" fill="#fef3c7"/>
  </svg>
));
const pollen = block('pollen', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="26" fill="#166534" stroke="#86efac" strokeWidth="1.5"/>
    {[[32,16],[48,32],[32,48],[16,32],[22,22],[42,22],[42,42],[22,42]].map((p,i)=>(
      <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#fef08a" stroke="#facc15" strokeWidth="0.6"/>
    ))}
    <circle cx="32" cy="32" r="5" fill="#fbbf24"/>
  </svg>
));
const vine = block('vine', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#14352a"/>
    <path d="M 10 8 Q 28 24, 12 40 Q 28 50, 56 30" stroke="#22c55e" strokeWidth="3" fill="none"/>
    <path d="M 8 30 Q 24 14, 40 30 Q 56 46, 60 56" stroke="#16a34a" strokeWidth="2.5" fill="none"/>
  </svg>
));
const bloom = block('bloom', (s = 64) => {
  const petals = [0,72,144,216,288].map((a,i)=>{
    const r=a*Math.PI/180,x=32+Math.cos(r-Math.PI/2)*14,y=32+Math.sin(r-Math.PI/2)*14;
    return <ellipse key={i} cx={x} cy={y} rx="10" ry="14" fill="#f472b6" stroke="#be185d" strokeWidth="1" transform={`rotate(${a} ${x} ${y})`}/>;
  });
  return (
    <svg viewBox="0 0 64 64" width={s} height={s}>
      {petals}
      <circle cx="32" cy="32" r="9" fill="#fef08a" stroke="#f59e0b" strokeWidth="1.2"/>
      <circle cx="32" cy="32" r="4" fill="#f59e0b"/>
    </svg>
  );
});

// ── TIDE ──
const pearl = block('pearl', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><radialGradient id="prl-g" cx="38%" cy="38%" r="55%">
      <stop offset="0%" stopColor="#ffffff"/><stop offset="60%" stopColor="#a5f3fc"/><stop offset="100%" stopColor="#0e7490"/>
    </radialGradient></defs>
    <circle cx="32" cy="32" r="26" fill="url(#prl-g)" stroke="#67e8f9" strokeWidth="1.5"/>
    <ellipse cx="22" cy="22" rx="6" ry="4" fill="#ffffff" opacity="0.7"/>
  </svg>
));
const coral = block('coral', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#0c2540"/>
    <path d="M 32 56 L 32 30 M 32 40 L 22 28 M 32 36 L 42 26 M 32 30 L 16 22 M 32 30 L 48 22" stroke="#ec4899" strokeWidth="3" strokeLinecap="round" fill="none"/>
    {[[22,28],[42,26],[16,22],[48,22],[32,30]].map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#f472b6"/>)}
  </svg>
));
const tide = block('tide', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#075985"/>
    <path d="M 4 24 Q 16 16, 32 24 Q 48 32, 60 24 L 60 36 Q 48 28, 32 36 Q 16 44, 4 36 Z" fill="#22d3ee"/>
    <path d="M 4 40 Q 16 32, 32 40 Q 48 48, 60 40 L 60 60 L 4 60 Z" fill="#0ea5e9" opacity="0.85"/>
  </svg>
));
const kraken = block('kraken', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#0c1f3a"/>
    <circle cx="32" cy="28" r="14" fill="#7c3aed" stroke="#c4b5fd" strokeWidth="1.2"/>
    {[8,20,32,44,56].map((x,i)=><path key={i} d={`M ${x} 36 Q ${x+(i%2?4:-4)} 48, ${x} 58`} stroke="#a78bfa" strokeWidth="2.5" fill="none" strokeLinecap="round"/>)}
    <circle cx="28" cy="26" r="2" fill="#fef08a"/>
    <circle cx="36" cy="26" r="2" fill="#fef08a"/>
  </svg>
));
const bubble = block('bubble', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="26" fill="none" stroke="#67e8f9" strokeWidth="2" opacity="0.7"/>
    <circle cx="32" cy="32" r="20" fill="#0e7490" opacity="0.4" stroke="#a5f3fc" strokeWidth="1"/>
    <ellipse cx="22" cy="22" rx="8" ry="5" fill="#a5f3fc" opacity="0.6"/>
    <circle cx="20" cy="20" r="3" fill="#ffffff" opacity="0.85"/>
  </svg>
));

// ── DUNES ──
const sand = block('sand', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#fbbf24"/>
    <path d="M 4 20 Q 20 12, 32 20 Q 44 28, 60 20" stroke="#d97706" strokeWidth="1" fill="none"/>
    <path d="M 4 32 Q 20 24, 32 32 Q 44 40, 60 32" stroke="#d97706" strokeWidth="1" fill="none"/>
    <path d="M 4 44 Q 20 36, 32 44 Q 44 52, 60 44" stroke="#d97706" strokeWidth="1" fill="none"/>
  </svg>
));
const glyph = block('glyph', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="2" fill="#3f2613" stroke="#fcd34d" strokeWidth="1.5"/>
    <path d="M 20 18 L 44 18 M 32 18 L 32 36 M 24 28 L 40 28 M 24 44 L 40 44 M 28 36 L 28 44 M 36 36 L 36 44" stroke="#fef3c7" strokeWidth="1.8" fill="none"/>
  </svg>
));
const scarab = block('scarab', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <ellipse cx="32" cy="36" rx="20" ry="22" fill="#1c1917" stroke="#fbbf24" strokeWidth="1.5"/>
    <ellipse cx="32" cy="20" rx="10" ry="7" fill="#fbbf24"/>
    <path d="M 12 26 L 22 32 M 12 36 L 22 38 M 52 26 L 42 32 M 52 36 L 42 38" stroke="#1c1917" strokeWidth="1.5"/>
    <circle cx="28" cy="20" r="1.5" fill="#1c1917"/>
    <circle cx="36" cy="20" r="1.5" fill="#1c1917"/>
  </svg>
));
const mirage = block('mirage', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><linearGradient id="mir-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#fef3c7"/><stop offset="50%" stopColor="#fcd34d" stopOpacity="0.5"/><stop offset="100%" stopColor="#fef3c7" stopOpacity="0"/>
    </linearGradient></defs>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="url(#mir-g)"/>
    <circle cx="32" cy="32" r="6" fill="none" stroke="#fbbf24" strokeWidth="1.5"/>
    <circle cx="32" cy="32" r="12" fill="none" stroke="#fbbf24" strokeWidth="1" opacity="0.5"/>
  </svg>
));
const sunstone = block('sunstone', (s = 64) => {
  const rays = Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,x1=32+Math.cos(a)*14,y1=32+Math.sin(a)*14,x2=32+Math.cos(a)*28,y2=32+Math.sin(a)*28;return<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fbbf24" strokeWidth="2"/>;});
  return <svg viewBox="0 0 64 64" width={s} height={s}>{rays}<circle cx="32" cy="32" r="14" fill="#fcd34d" stroke="#f59e0b" strokeWidth="2"/><circle cx="32" cy="32" r="6" fill="#fef3c7"/></svg>;
});

// ── VOIDLINE ──
const voidBlock = block('void', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><radialGradient id="void-g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#000000"/><stop offset="70%" stopColor="#1e1b4b"/><stop offset="100%" stopColor="#a855f7"/>
    </radialGradient></defs>
    <circle cx="32" cy="32" r="28" fill="url(#void-g)" stroke="#c084fc" strokeWidth="1.5"/>
    <circle cx="32" cy="32" r="10" fill="#000000"/>
  </svg>
));
const singularity = block('singularity', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="28" fill="#1e1b4b"/>
    {[28,22,16,10].map((r,i)=><circle key={i} cx="32" cy="32" r={r} fill="none" stroke="#c084fc" strokeWidth="0.8" opacity={0.3+i*0.18}/>)}
    <circle cx="32" cy="32" r="4" fill="#f0abfc"/>
    <circle cx="32" cy="32" r="2" fill="#ffffff"/>
  </svg>
));
const rift = block('rift', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#0a0028"/>
    <path d="M 32 4 L 24 16 L 36 28 L 22 38 L 38 50 L 28 60" stroke="#f0abfc" strokeWidth="3" fill="none" strokeLinejoin="miter"/>
    <path d="M 32 4 L 24 16 L 36 28 L 22 38 L 38 50 L 28 60" stroke="#ffffff" strokeWidth="1" fill="none"/>
  </svg>
));
const sigil = block('sigil', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#1a0f3a" stroke="#c084fc" strokeWidth="1.5"/>
    <polygon points="32,12 52,32 32,52 12,32" fill="none" stroke="#a855f7" strokeWidth="1.5"/>
    <polygon points="32,18 46,32 32,46 18,32" fill="none" stroke="#f0abfc" strokeWidth="1"/>
    <circle cx="32" cy="32" r="6" fill="#c084fc"/>
    {[[32,12],[52,32],[32,52],[12,32]].map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="2" fill="#f0abfc"/>)}
  </svg>
));
const eclipse = block('eclipse', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <circle cx="32" cy="32" r="24" fill="#fbbf24"/>
    <circle cx="38" cy="32" r="22" fill="#0a0028"/>
    {[0,60,120,180,240,300].map((a,i)=>{const r=a*Math.PI/180,x=32+Math.cos(r)*28,y=32+Math.sin(r)*28;return<circle key={i} cx={x} cy={y} r="1.5" fill="#fef3c7"/>;})}</svg>
));

// ── APEX ──
const apexBlock = block('apex', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><linearGradient id="apx-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#fef3c7"/><stop offset="50%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#7c2d12"/>
    </linearGradient></defs>
    <polygon points="32,4 56,28 48,58 16,58 8,28" fill="url(#apx-g)" stroke="#ffffff" strokeWidth="1.5"/>
    <polygon points="32,12 46,28 32,40 18,28" fill="#ffffff" opacity="0.4"/>
    <text x="32" y="38" textAnchor="middle" fontSize="16" fontWeight="900" fill="#7c2d12">A</text>
  </svg>
));
const halo = block('halo', (s = 64) => {
  const ticks = Array.from({length:12},(_,i)=>{const a=i*Math.PI/6,x1=32+Math.cos(a)*26,y1=32+Math.sin(a)*26,x2=32+Math.cos(a)*32,y2=32+Math.sin(a)*32;return<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fbbf24" strokeWidth="1.2"/>;});
  return(
    <svg viewBox="0 0 64 64" width={s} height={s}>
      <circle cx="32" cy="32" r="26" fill="none" stroke="#fbbf24" strokeWidth="2"/>
      <circle cx="32" cy="32" r="12" fill="#fef3c7"/>
      <circle cx="32" cy="32" r="6" fill="#ffffff"/>
      {ticks}
    </svg>
  );
});
const judgement = block('judgement', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="4" fill="#2a0e3a" stroke="#fbbf24" strokeWidth="1.5"/>
    <line x1="32" y1="8" x2="32" y2="56" stroke="#fef3c7" strokeWidth="2"/>
    <line x1="14" y1="20" x2="50" y2="20" stroke="#fef3c7" strokeWidth="2"/>
    <polygon cx="32" cy="32" points="14,20 8,32 20,32" fill="none" stroke="#fbbf24" strokeWidth="1.5"/>
    <polygon cx="32" cy="32" points="50,20 44,32 56,32" fill="none" stroke="#fbbf24" strokeWidth="1.5"/>
  </svg>
));
const covenant = block('covenant', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="#1a0524" stroke="#fbbf24" strokeWidth="1.5"/>
    <polygon points="32,12 56,28 48,52 16,52 8,28" fill="none" stroke="#fbbf24" strokeWidth="1"/>
    <circle cx="32" cy="32" r="6" fill="#fbbf24"/>
  </svg>
));
const ascend = block('ascend', (s = 64) => (
  <svg viewBox="0 0 64 64" width={s} height={s}>
    <defs><linearGradient id="asc-g" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stopColor="#7c2d12"/><stop offset="100%" stopColor="#ffffff"/>
    </linearGradient></defs>
    <rect x="4" y="4" width="56" height="56" rx="6" fill="url(#asc-g)"/>
    <polygon points="32,8 44,24 38,24 38,40 26,40 26,24 20,24" fill="#ffffff" opacity="0.95"/>
    <line x1="14" y1="50" x2="50" y2="50" stroke="#fbbf24" strokeWidth="2"/>
  </svg>
));

export const BLOCK_DEFS: Record<string, BlockDef> = {
  shard, geode, amethyst, echo, rune,
  ice, frost, glacier, aurora, snowflake,
  ember, magma, cinder, forge, phoenix,
  leaf, mushroom, pollen, vine, bloom,
  pearl, coral, tide, kraken, bubble,
  sand, glyph, scarab, mirage, sunstone,
  void: voidBlock, singularity, rift, sigil, eclipse,
  apex: apexBlock, halo, judgement, covenant, ascend,
};
