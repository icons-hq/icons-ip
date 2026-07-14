import { NextResponse } from 'next/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { cancelTossPayment, getTossConfig } from '@/lib/payments/toss-api';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

const CANCEL_REASON = '사용자 주문 취소';

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
}

interface ActivePaymentRow {
  id: string;
  status: 'pending' | 'paid';
  payment_key: string | null;
}

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

export async function POST(
  request: Request,
  context: RouteContext<'/api/orders/[orderId]/cancel'>,
) {
  if (!isSameOriginRequest(request)) return errorJson(403, 'forbidden');

  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return errorJson(503, 'not_configured');
  }

  const { orderId: rawOrderId } = await context.params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) return errorJson(404, 'not_found');

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return errorJson(401, 'auth_required');

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,user_id,status')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle<OrderRow>();

  if (orderError) {
    console.error('[orders/cancel] order lookup failed');
    return errorJson(502, 'cancel_failed');
  }
  if (!orderData) return errorJson(404, 'not_found');
  const wasCanceled = orderData.status === 'canceled';
  if (orderData.status !== 'pending' && orderData.status !== 'paid' && !wasCanceled) {
    return errorJson(409, 'not_cancelable');
  }

  const service = createServiceClient();
  const { data: paymentData, error: paymentError } = await service
    .from('payments')
    .select('id,status,payment_key')
    .eq('user_id', user.id)
    .eq('purpose', 'order')
    .eq('ref_id', orderId)
    .in('status', ['pending', 'paid']);

  if (paymentError) {
    console.error('[orders/cancel] active payment lookup failed');
    return errorJson(502, 'cancel_failed');
  }

  const activePayments = (paymentData ?? []) as ActivePaymentRow[];
  if (activePayments.some((payment) => typeof payment.payment_key !== 'string' || !payment.payment_key)) {
    return errorJson(502, 'payment_evidence_invalid');
  }

  const paymentKeys = activePayments.map((payment) => payment.payment_key as string);
  if (paymentKeys.length > 0) {
    if (!getTossConfig().isConfigured) return errorJson(503, 'not_configured');

    for (const paymentKey of paymentKeys) {
      const canceled = await cancelTossPayment(paymentKey, CANCEL_REASON);
      if (!canceled.ok && canceled.code !== 'ALREADY_CANCELED_PAYMENT') {
        console.error('[orders/cancel] provider cancellation failed');
        return errorJson(502, 'provider_cancel_failed');
      }
    }
  }

  const { error: cancelError } = await service.rpc('cancel_order_with_provider_evidence', {
    p_order_id: orderId,
    p_reason: CANCEL_REASON,
    p_provider_payment_keys: paymentKeys,
  });
  if (cancelError) {
    console.error('[orders/cancel] local cancellation failed');
    return errorJson(502, 'cancel_failed');
  }

  return NextResponse.json({ status: wasCanceled ? 'already_canceled' : 'canceled' });
}
