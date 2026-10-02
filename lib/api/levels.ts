export async function startLevel(level: number, player: string): Promise<{ seed: string }> {
  try {
    const res = await fetch(`/api/levels/${level}?player=${encodeURIComponent(player)}`);
    if (res.ok) return res.json();
  } catch { /* fall through */ }
  return { seed: String(level * 2654435761) };
}

export async function submitScore(payload: {
  level: number;
  score: number;
  message: string;
  signature: string;
}): Promise<void> {
  try {
    await fetch('/api/score/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* non-fatal */ }
}
