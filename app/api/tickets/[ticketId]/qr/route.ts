import { NextResponse } from 'next/server';
import { toBuffer } from 'qrcode';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { normalizeTicketReference } from '@/lib/ticketing';

interface TicketQrRow {
  id: string;
  ticket_order_id: string;
  status: string;
  qr_token: string | null;
  ticket_orders: { user_id: string; status: string } | Array<{ user_id: string; status: string }>;
}

const ACTIVE_CANCELLATION_STATUSES = ['requested', 'processing', 'needs_review'];

function errorJson(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status });
}

function ticketOrder(row: TicketQrRow) {
  return Array.isArray(row.ticket_orders) ? row.ticket_orders[0] : row.ticket_orders;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticketId: string }> },
) {
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return errorJson(503, 'not_configured');
  }

  const { ticketId: rawTicketId } = await context.params;
  const ticketId = normalizeTicketReference(rawTicketId);
  if (!ticketId) return errorJson(404, 'not_found');

  const auth = await getCurrentAuthState();
  if (!auth.user) return errorJson(401, 'auth_required');
  if (!isOnboarded(auth.profile, auth.user.email)) return errorJson(403, 'onboarding_required');

  const service = createServiceClient();
  const { data, error } = await service
    .from('tickets')
    .select('id,ticket_order_id,status,qr_token,ticket_orders!inner(user_id,status)')
    .eq('id', ticketId)
    .eq('ticket_orders.user_id', auth.user.id)
    .maybeSingle<TicketQrRow>();

  if (error) {
    console.error('[tickets/qr] ticket lookup failed');
    return errorJson(502, 'qr_unavailable');
  }
  const order = data ? ticketOrder(data) : null;
  if (
    !data
    || !order
    || order.user_id !== auth.user.id
    || order.status !== 'paid'
    || data.status !== 'valid'
    || typeof data.qr_token !== 'string'
    || !data.qr_token
    || data.qr_token.length > 512
  ) {
    return errorJson(404, 'not_found');
  }

  const { data: cancellation, error: cancellationError } = await service
    .from('ticket_cancellation_requests')
    .select('id')
    .eq('ticket_order_id', data.ticket_order_id)
    .in('status', ACTIVE_CANCELLATION_STATUSES)
    .limit(1)
    .maybeSingle();

  if (cancellationError) {
    console.error('[tickets/qr] cancellation lookup failed');
    return errorJson(502, 'qr_unavailable');
  }
  if (cancellation) return errorJson(404, 'not_found');

  try {
    const png = await toBuffer(data.qr_token, {
      type: 'png',
      width: 288,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#05050AFF', light: '#FFFFFFFF' },
    });

    return new Response(Uint8Array.from(png), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Type': 'image/png',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    console.error('[tickets/qr] QR rendering failed');
    return errorJson(500, 'qr_unavailable');
  }
}
