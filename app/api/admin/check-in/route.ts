import { NextResponse } from 'next/server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import {
  normalizeTicketQrToken,
  parseTicketCheckInRpcResult,
} from '@/lib/ticket-check-in';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
} as const;

function jsonResponse(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function errorResponse(status: number, code: string) {
  return jsonResponse(status, { error: { code } });
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function parseBody(body: unknown) {
  if (
    typeof body !== 'object'
    || body === null
    || Array.isArray(body)
    || Object.keys(body).length !== 1
    || !Object.hasOwn(body, 'qrToken')
  ) {
    return null;
  }

  return normalizeTicketQrToken((body as { qrToken?: unknown }).qrToken);
}

function mapRpcError(error: { code?: unknown; message?: unknown }) {
  if (error.code === '23514' && error.message === 'ticket cancellation in progress') {
    return errorResponse(409, 'cancellation_in_progress');
  }
  if (
    error.code === '42501'
    || (error.code === '23514' && error.message === 'invalid qr token')
    || error.message === 'invalid ticket'
    || error.message === 'forbidden'
  ) {
    return errorResponse(404, 'not_found');
  }
  return errorResponse(502, 'check_in_failed');
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return errorResponse(403, 'forbidden');
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return errorResponse(503, 'not_configured');
  }

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return errorResponse(502, 'check_in_failed');
  }
  if (!auth.isConfigured) return errorResponse(503, 'not_configured');
  if (!auth.user) return errorResponse(401, 'auth_required');
  if (!auth.isStaff) return errorResponse(404, 'not_found');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(404, 'not_found');
  }
  const qrToken = parseBody(body);
  if (!qrToken) return errorResponse(404, 'not_found');

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('check_in_ticket', {
      p_staff_id: auth.user.id,
      p_qr_token: qrToken,
    });
    if (error) return mapRpcError(error);

    const result = parseTicketCheckInRpcResult(data);
    if (!result) return errorResponse(502, 'check_in_failed');
    if (result.result === 'not_found') return errorResponse(404, 'not_found');
    return jsonResponse(200, result);
  } catch {
    return errorResponse(502, 'check_in_failed');
  }
}
