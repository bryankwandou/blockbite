/** Partner wallet sign-in (see lib/admin/http.ts authHandlers). */
import { authHandlers } from '@/lib/admin/http';

export const dynamic = 'force-dynamic';
const h = authHandlers('partner');
export const GET = h.GET;
export const POST = h.POST;
export const DELETE = h.DELETE;
