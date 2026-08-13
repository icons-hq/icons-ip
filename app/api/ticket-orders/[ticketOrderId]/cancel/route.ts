import { NextResponse } from 'next/server';
import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { normalizeTicketReference } from '@/lib/ticketing';
import { reconcileTicketCancellation } from '@/lib/ticketing/cancellation-orchestrator.server';
import {
  TicketPaymentContractError,
  TicketRefundInProgressError,
} from '@/lib/payments/ticket-checkout';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';

interface TicketOrderRow {
  id: string;
  user_id: string;
  status: string;
}

interface TicketCancellationRouteContext {
  params: Promise<{ ticketOrderId: string }>;
}

type RequestResult =
  | 'requested'
  | 'processing'
  | 'needs_review'
  | 'completed'
  | 'already_canceled'
  | 'not_found'
  | 'not_cancelable'
  | 'policy_closed';

interface CancellationRequestRow {
  request_id: string | null;
  result: RequestResult;
}

const REQUEST_RESULTS = new Set<RequestResult>([
  'requested',
  'processing',
  'needs_review',
  'completed',
  'already_canceled',
  'not_found',
  'not_cancelable',
  'policy_closed',
]);

function errorJson(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status });
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

function parseRequestRow(data: unknown): CancellationRequestRow | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown> | null;
  if (!row || typeof row.result !== 'string' || !REQUEST_RESULTS.has(row.result as RequestResult)) {
    return null;
  }
  if (row.request_id !== null && typeof row.request_id !== 'string') return null;
  return {
    request_id: row.request_id as string | null,
    result: row.result as RequestResult,
  };
}

export async function POST(
  request: Request,
  context: TicketCancellationRouteContext,
) {
  if (!isSameOriginRequest(request)) return errorJson(403, 'forbidden');
  if (
    !getSupabaseConfig().isConfigured
    || !getServiceRoleConfig().isConfigured
  ) {
    return errorJson(503, 'not_configured');
  }

  const { ticketOrderId: rawTicketOrderId } = await context.params;
  const ticketOrderId = normalizeTicketReference(rawTicketOrderId);
  if (!ticketOrderId) return errorJson(404, 'not_found');

  let auth: Awaited<ReturnType<typeof getCurrentAuthState>>;
  try {
    auth = await getCurrentAuthState();
  } catch {
    return errorJson(502, 'cancel_failed');
  }
  if (!auth.isConfigured) return errorJson(503, 'not_configured');
  if (!auth.user) return errorJson(401, 'auth_required');
  if (!isOnboarded(auth.profile, auth.user.email)) {
    return errorJson(409, 'onboarding_required');
  }

  let orderData: TicketOrderRow | null;
  try {
    const supabase = await createClient();
    const result = await supabase
      .from('ticket_orders')
      .select('id,user_id,status')
      .eq('id', ticketOrderId)
      .eq('user_id', auth.user.id)
      .maybeSingle<TicketOrderRow>();

    if (result.error) return errorJson(502, 'cancel_failed');
    orderData = result.data;
  } catch {
    return errorJson(502, 'cancel_failed');
  }
  if (
    !orderData
    || normalizeTicketReference(orderData.id) !== ticketOrderId
    || orderData.user_id !== auth.user.id
  ) {
    return errorJson(404, 'not_found');
  }

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return errorJson(502, 'cancel_failed');
  }

  let requestRow: CancellationRequestRow | null;
  try {
    const { data, error } = await service.rpc('request_ticket_cancellation', {
      p_ticket_order_id: ticketOrderId,
      p_user_id: auth.user.id,
    });
    if (error) return errorJson(502, 'cancel_failed');
    requestRow = parseRequestRow(data);
  } catch {
    return errorJson(502, 'cancel_failed');
  }
  if (!requestRow) return errorJson(502, 'cancel_failed');

  switch (requestRow.result) {
    case 'not_found':
      return errorJson(404, 'not_found');
    case 'not_cancelable':
      return errorJson(409, 'not_cancelable');
    case 'policy_closed':
      return errorJson(409, 'policy_closed');
    case 'completed':
      return NextResponse.json({ status: 'canceled' });
    case 'already_canceled':
      return NextResponse.json({ status: 'already_canceled' });
  }

  const requestId = normalizeTicketReference(requestRow.request_id);
  if (!requestId) return errorJson(502, 'cancel_failed');

  try {
    const refund = await createRuntimeTicketPaymentCheckout().refund({
      requestId,
      userId: auth.user.id,
      reason: '사용자 티켓 예매 취소',
    });
    return refund.outcome === 'approved'
      ? NextResponse.json({ status: 'canceled' })
      : NextResponse.json({ status: 'reviewing' }, { status: 202 });
  } catch (error) {
    if (error instanceof TicketRefundInProgressError) {
      return NextResponse.json({ status: 'processing' }, { status: 202 });
    }
    if (!(error instanceof TicketPaymentContractError) || error.code !== 'legacy_payment') {
      return NextResponse.json({ status: 'reviewing' }, { status: 202 });
    }
  }

  // Existing Toss rows remain known-only. The provider-neutral repository
  // explicitly returns `legacy_payment`; only then may the old reconciler run.
  const attemptToken = crypto.randomUUID();

  let beginResult: unknown;
  try {
    const { data, error } = await service.rpc('begin_ticket_cancellation_reconcile', {
      p_request_id: requestId,
      p_user_id: auth.user.id,
      p_attempt_token: attemptToken,
    });
    if (error) return errorJson(502, 'cancel_failed');
    beginResult = data;
  } catch {
    return errorJson(502, 'cancel_failed');
  }

  if (beginResult === 'in_progress') {
    return NextResponse.json({ status: 'processing' }, { status: 202 });
  }
  if (beginResult === 'completed') {
    return NextResponse.json({ status: 'canceled' });
  }
  if (beginResult !== 'processing') return errorJson(502, 'cancel_failed');

  try {
    const result = await reconcileTicketCancellation({
      requestId,
      userId: auth.user.id,
      attemptToken,
    });
    return result.ok
      ? NextResponse.json({ status: 'canceled' })
      : NextResponse.json({ status: 'reviewing' }, { status: 202 });
  } catch {
    return NextResponse.json({ status: 'reviewing' }, { status: 202 });
  }
}
