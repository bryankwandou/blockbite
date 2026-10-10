/**
 * POST /api/partnership-lead
 * Receives B2B partnership applications from /partnership.
 *
 * Storage: writes to Supabase `partnership_leads` table if env vars are
 * configured. Falls back to a small in-memory ring buffer otherwise so
 * the form never hard-fails — the warmest deployment captures leads even
 * before the table exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getIP, rateLimit } from '@/lib/rate-limit';
import { jsonObject } from '@/lib/http/body';
import { dbAddLead, waitlistDbConfigured } from '@/lib/waitlist/db';

interface Lead {
  email:   string;
  project: string;
  notes?:  string;
  ts:      number;
}

const MEM_LEADS: Lead[] = [];
const MAX_MEM = 200;

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`lead:${getIP(req)}`, 5, 60_000).catch(() => null);
  if (rl && !rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  let body: { email?: string; project?: string; notes?: string };
  const parsed = await jsonObject<typeof body>(req);
  if (!parsed) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  body = parsed;

  if (!body || typeof body !== 'object' || [body.email, body.project].some((v) => typeof v !== 'string') ||
      (body.notes !== undefined && typeof body.notes !== 'string')) {
    return NextResponse.json({ error: 'Invalid fields' }, { status: 400 });
  }
  const email   = (body.email ?? '').trim().toLowerCase();
  const project = (body.project ?? '').trim();
  const notes   = (body.notes ?? '').trim().slice(0, 2000);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  if (!project || project.length > 200) {
    return NextResponse.json({ error: 'Project name required (max 200 chars)' }, { status: 400 });
  }

  // Try Supabase first
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/partnership_leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ email, project, notes: notes || null }),
      });
      if (res.status === 200 || res.status === 201 || res.status === 204) {
        return NextResponse.json({ ok: true, source: 'supabase' });
      }
      if (res.status === 409) {
        return NextResponse.json({ ok: true, already: true, source: 'supabase' }, { status: 409 });
      }
      // Fall through to memory on any other Supabase error
    } catch { /* fall through */ }
  }

  // Postgres when Supabase is absent or failed
  if (waitlistDbConfigured() && (await dbAddLead({ email, project, notes: notes || null }))) {
    return NextResponse.json({ ok: true, source: 'postgres' });
  }

  // In-memory fallback (always succeeds, ring buffer)
  if (!MEM_LEADS.find((l) => l.email === email && l.project === project)) {
    MEM_LEADS.unshift({ email, project, notes: notes || undefined, ts: Date.now() });
    if (MEM_LEADS.length > MAX_MEM) MEM_LEADS.length = MAX_MEM;
  }
  return NextResponse.json({ ok: true, source: 'memory' });
}
