import { NextRequest } from 'next/server';
import { getGlobal, ZERO_STATE } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  let initial = ZERO_STATE;
  try {
    initial = await getGlobal();
  } catch { /* use zero */ }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial snapshot
      controller.enqueue(encoder.encode(
        `event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`,
      ));
      // Heartbeat every 25s to keep connection alive within Vercel's 30s timeout
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(':hb\n\n')); }
        catch { clearInterval(hb); }
      }, 25_000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
