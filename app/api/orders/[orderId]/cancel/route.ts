import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { loadGiftCheckoutOrder } from '@/lib/gifts-order.server';
import { NextResponse } from 'next/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { isOrderWithdrawalReasonType } from '@/lib/orders';
import { ORDER_CLAIM_BUYER_REASON_TYPES } from '@/lib/orders/claims';
import { scheduleApprovedOrderCancellation } from '@/lib/orders/cancellation-auto.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

// 취소(발주확인 전)는 단순 변심만 받는다(10/27 회의 R7). 하자·오배송은 굿즈를 받은 뒤의 일이라
// 반품·교환으로 받는다 — 고객 화면은 원래 단순 변심만 보냈고, 열려 있던 API 입력을 닫는다.
// 값 자체는 RPC가 다시 검증하지만, 허용 밖 입력은 DB에 닿기 전에 막는다.
type CancelReasonType = 'change_of_mind';
const CANCEL_REASONS: Record<CancelReasonType, string> = {
  change_of_mind: '사용자 주문 취소',
};

function isCancelReasonType(value: string): value is CancelReasonType {
  return isOrderWithdrawalReasonType(value) && (ORDER_CLAIM_BUYER_REASON_TYPES.cancel as readonly string[]).includes(value)
    && Object.prototype.hasOwnProperty.call(CANCEL_REASONS, value);
}

/*
 * request_order_cancellation은 자동 승인을 'requested'로 접어 돌려준다(레거시 응답 계약).
 * 그래서 이 라우트는 승인 여부를 묻지 않고 접수 뒤 서버 경로를 예약한다 — 승인된
 * 취소면 결제사 전액 취소를 실행하고, 아니면 아무것도 하지 않는다(DB가 다시 판정).
 * 대기 창 40초 + 결제사 취소·조회(8초×3) + DB를 덮는 예산이다.
 */
export const maxDuration = 90;

interface OrderRow {
  id: string;
  user_id: string;
}

// 사유를 생략한 요청은 기한이 가장 짧은 단순 변심으로 본다. 기본값이 관대한
// 쪽이면 폼을 비우는 것만으로 3개월 기한을 얻는다.
async function readReasonType(request: Request): Promise<CancelReasonType | null> {
  const rawBody = await request.text().catch(() => null);
  if (rawBody === null) return null;
  if (!rawBody.trim()) return 'change_of_mind'; // Deployed legacy callers send no body.
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  // Unknown fields must not turn a partial-cancel request into a full cancel.
  if (Array.isArray(body) || Object.keys(body).some((key) => key !== 'reasonType')) return null;

  const reasonType = (body as { reasonType?: unknown }).reasonType;
  if (reasonType === undefined || reasonType === null) return 'change_of_mind';
  if (typeof reasonType !== 'string' || !isCancelReasonType(reasonType)) return null;
  return reasonType;
}

function errorJson(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status });
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

  const reasonType = await readReasonType(request);
  if (!reasonType) return errorJson(400, 'invalid_reason_type');

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return errorJson(401, 'auth_required');

  // The gift payer receives a redacted projection; raw order RLS is closed.
  let giftOrder;
  try { giftOrder = await loadGiftCheckoutOrder(user.id, orderId); }
  catch { return errorJson(502, 'cancel_failed'); }
  if (giftOrder.kind === 'unavailable') return errorJson(404, 'not_found');
  if (giftOrder.kind === 'ordinary') {
    const { data: orderData, error: orderError } = await supabase.from('orders').select('id,user_id').eq('id', orderId).eq('user_id', user.id).maybeSingle<OrderRow>();
    if (orderError) return errorJson(502, 'cancel_failed');
    if (!orderData) return errorJson(404, 'not_found');
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('request_order_cancellation', {
    p_order_id: orderId,
    p_reason: CANCEL_REASONS[reasonType],
    p_reason_type: reasonType,
    p_user_id: user.id,
  });
  if (error) {
    console.error('[orders/cancel] cancellation request failed');
    return errorJson(502, 'cancel_failed');
  }

  if (data === 'not_found') return errorJson(404, 'not_found');
  if (data === 'not_cancelable') return errorJson(409, 'not_cancelable');
  if (data === 'deadline_expired') return errorJson(409, 'deadline_expired');
  if (data === 'completed') return NextResponse.json({ status: 'canceled' });
  if (data === 'already_canceled') return NextResponse.json({ status: 'already_canceled' });
  if (data === 'requested') {
    scheduleApprovedOrderCancellation(orderId);
    return NextResponse.json({ status: 'requested' }, { status: 202 });
  }
  if (data === 'already_requested') return NextResponse.json({ status: 'requested' });

  console.error('[orders/cancel] unexpected cancellation request result');
  return errorJson(502, 'cancel_failed');
}
