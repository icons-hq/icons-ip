import { NextResponse } from 'next/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

const CANCEL_REASON = '사용자 주문 취소';

interface OrderRow {
  id: string;
  user_id: string;
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
    .select('id,user_id')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle<OrderRow>();

  if (orderError) {
    console.error('[orders/cancel] order lookup failed');
    return errorJson(502, 'cancel_failed');
  }
  if (!orderData) return errorJson(404, 'not_found');

  const service = createServiceClient();
  const { data, error } = await service.rpc('request_order_cancellation', {
    p_order_id: orderId,
    p_reason: CANCEL_REASON,
    p_user_id: user.id,
  });
  if (error) {
    console.error('[orders/cancel] cancellation request failed');
    return errorJson(502, 'cancel_failed');
  }

  if (data === 'not_found') return errorJson(404, 'not_found');
  if (data === 'not_cancelable') return errorJson(409, 'not_cancelable');
  if (data === 'completed') return NextResponse.json({ status: 'canceled' });
  if (data === 'already_canceled') return NextResponse.json({ status: 'already_canceled' });
  if (data === 'requested') {
    return NextResponse.json({ status: 'requested' }, { status: 202 });
  }
  if (data === 'already_requested') return NextResponse.json({ status: 'requested' });

  console.error('[orders/cancel] unexpected cancellation request result');
  return errorJson(502, 'cancel_failed');
}
