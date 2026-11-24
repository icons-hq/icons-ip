import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { loadGiftCheckoutOrder } from '@/lib/gifts-order.server';
import { NextResponse } from 'next/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import { scheduleApprovedOrderCancellation } from '@/lib/orders/cancellation-auto.server';
import {
  isOrderClaimType,
  normalizeRefundAccount,
  ORDER_CLAIM_BUYER_REASON_TYPES,
  type OrderClaimType,
} from '@/lib/orders/claims';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { normalizeOrderPartialReturnSelection } from '@/lib/orders/partial-return';
import { loadPartialReturnPolicy } from '@/lib/orders/partial-return.server';

/*
 * 클레임 접수(#252) — 취소·반품·교환.
 *
 * `/api/orders/[orderId]/cancel`은 취소 전용 레거시 진입점으로 남는다(이미 배포된
 * 화면과 테스트가 그 계약을 본다). 이 라우트는 세 유형을 모두 받고, 판정은 전부
 * `request_order_claim` 안에서 잠금 아래 다시 한다 — 여기서 하는 검증은 DB에 닿기
 * 전에 명백한 잘못된 입력을 거르는 것이지 게이트가 아니다.
 *
 * 환불계좌는 요청 본문으로 받아 service_role RPC로 바로 넘긴다. 앱은 값을 저장하지
 * 않고 로그에도 남기지 않는다.
 *
 * 부분 반품(ADR-0047): 반품에만 `items`(품목·수량)를 받는다. 스위치(DB partial_return_enabled)가 꺼져 있거나 읽지 못하면 `items`가
 * 든 요청은 예전과 같은 자리(본문 키 검사, 인증·주문 조회 전)에서 invalid_body로 거부한다 — 품목을 무시하고 주문 전체를 접수하지
 * 않는다. 켜져 있으면 DB가 잠금 아래 스위치를 다시 보고(그사이 꺼졌으면 partial_return_disabled → 같은 invalid_body), 고른 품목이
 * 남은 수량 전부면 주문 전체 반품으로 접수한다.
 *
 * 취소가 접수되면 응답을 보낸 뒤 서버가 결제사 전액 취소까지 이어서 실행한다
 * (scheduleApprovedOrderCancellation). 자동 승인된 취소는 곧바로, 결제 승인 확인 중에
 * 접수된 취소는 finalizer 판정을 기다렸다가 처리한다. 판정은 전부 DB가 다시 한다.
 */

/* 대기 창 40초 + 결제사 취소·조회(8초×3) + DB. after()는 이 예산 안에서 실행된다. */
export const maxDuration = 90;

/* 취소(발주확인 전)는 단순 변심만 받는다(10/27 회의 R7). 하자·오배송은 굿즈를 받은 뒤의
   일이라 반품·교환으로 받는다 — 허용 표는 ORDER_CLAIM_BUYER_REASON_TYPES 하나다. */
const CLAIM_REASONS: Record<OrderClaimType, Partial<Record<OrderWithdrawalReasonType, string>>> = {
  cancel: {
    change_of_mind: '사용자 주문 취소',
  },
  return: {
    change_of_mind: '단순 변심 반품',
    defect: '상품 하자·오배송 반품',
  },
  exchange: {
    change_of_mind: '단순 변심 교환',
    defect: '상품 하자·오배송 교환',
  },
};

function errorJson(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status });
}


interface OrderRow {
  id: string;
  user_id: string;
}

export async function POST(
  request: Request,
  context: RouteContext<'/api/orders/[orderId]/claims'>,
) {
  if (!isSameOriginRequest(request)) return errorJson(403, 'forbidden');

  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return errorJson(503, 'not_configured');
  }

  const { orderId: rawOrderId } = await context.params;
  const orderId = normalizeOrderReference(rawOrderId);
  if (!orderId) return errorJson(404, 'not_found');

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorJson(400, 'invalid_body');

  const payload = body as Record<string, unknown>;
  // Never silently ignore a requested item, quantity or partial amount and
  // refund everything: only `items` (partial return, ADR-0047) is accepted,
  // only for returns and only while the switch is on — off (or unreadable),
  // the key fails here exactly as before the switch existed.
  const allowedKeys = new Set(['claimType', 'reasonType', 'accountHolder', 'accountNumber', 'bankName', 'items']);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) return errorJson(400, 'invalid_body');
  // 형식이 맞는 반품 품목만 공개 스위치를 한 번 읽는다 — 형식 밖이면 DB에 닿지 않고, 꺼져 있으면(읽지 못하면) 예전 자리의 invalid_body다.
  let items: ReturnType<typeof normalizeOrderPartialReturnSelection> = null;
  if (Object.hasOwn(payload, 'items')) {
    items = payload.claimType === 'return' ? normalizeOrderPartialReturnSelection(payload.items) : null;
    if (!items || !(await loadPartialReturnPolicy()).enabled) return errorJson(400, 'invalid_body');
  }
  const claimType = payload.claimType;
  if (!isOrderClaimType(claimType)) return errorJson(400, 'invalid_claim_type');

  /* 사유를 생략한 요청은 기한이 가장 짧은 단순 변심으로 본다. 기본값이 관대한
     쪽이면 폼을 비우는 것만으로 3개월 기한을 얻는다(#189의 판단을 계승한다). */
  const rawReasonType = payload.reasonType;
  let reasonType: OrderWithdrawalReasonType = 'change_of_mind';
  if (rawReasonType !== undefined && rawReasonType !== null) {
    if (typeof rawReasonType !== 'string' || !isOrderWithdrawalReasonType(rawReasonType)) {
      return errorJson(400, 'invalid_reason_type');
    }
    reasonType = rawReasonType;
  }
  const reason = CLAIM_REASONS[claimType][reasonType];
  if (!ORDER_CLAIM_BUYER_REASON_TYPES[claimType].includes(reasonType) || !reason) {
    return errorJson(400, 'invalid_reason_type');
  }

  const account = normalizeRefundAccount({
    accountHolder: typeof payload.accountHolder === 'string' ? payload.accountHolder : null,
    accountNumber: typeof payload.accountNumber === 'string' ? payload.accountNumber : null,
    bankName: typeof payload.bankName === 'string' ? payload.bankName : null,
  });
  if (!account.ok) return errorJson(400, 'invalid_refund_account');

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return errorJson(401, 'auth_required');

  // The gift payer receives a redacted projection; raw order RLS is closed.
  let giftOrder;
  try { giftOrder = await loadGiftCheckoutOrder(user.id, orderId); }
  catch { return errorJson(502, 'claim_failed'); }
  if (giftOrder.kind === 'unavailable') return errorJson(404, 'not_found');
  if (giftOrder.kind === 'ordinary') {
    const { data: orderData, error: orderError } = await supabase.from('orders').select('id,user_id').eq('id', orderId).eq('user_id', user.id).maybeSingle<OrderRow>();
    if (orderError) return errorJson(502, 'claim_failed');
    if (!orderData) return errorJson(404, 'not_found');
  }

  const service = createServiceClient();
  const { data, error } = items
    ? await service.rpc('request_order_partial_return', {
      p_account_holder: account.value?.accountHolder ?? null,
      p_account_number: account.value?.accountNumber ?? null,
      p_bank_name: account.value?.bankName ?? null,
      p_items: items,
      p_order_id: orderId,
      p_reason: reason,
      p_reason_type: reasonType,
      p_user_id: user.id,
    })
    : await service.rpc('request_order_claim', {
      p_account_holder: account.value?.accountHolder ?? null,
      p_account_number: account.value?.accountNumber ?? null,
      p_bank_name: account.value?.bankName ?? null,
      p_claim_type: claimType,
      p_order_id: orderId,
      p_reason: reason,
      p_reason_type: reasonType,
      p_user_id: user.id,
    });
  if (error) {
    // 입금된 가상계좌 주문은 환급 계좌를 결제사에 그대로 보낼 수 있어야 받는다(DB 판정, 20261125110000) — 계좌를 고쳐 다시 신청한다.
    if (error.message === 'invalid_virtual_account_refund_account') return errorJson(400, 'invalid_refund_account');
    console.error('[orders/claims] claim request failed');
    return errorJson(502, 'claim_failed');
  }

  /* 스위치가 꺼져 있으면 품목을 보낸 요청은 지금과 같은 거절이다. */
  if (data === 'partial_return_disabled') return errorJson(400, 'invalid_body');
  if (data === 'partial_return_unavailable' || data === 'partial_return_item_unavailable') return errorJson(409, data);

  if (data === 'not_found') return errorJson(404, 'not_found');
  if (data === 'not_cancelable' || data === 'not_claimable') {
    return errorJson(409, 'not_claimable');
  }
  if (data === 'deadline_expired') return errorJson(409, 'deadline_expired');
  if (data === 'already_canceled') return NextResponse.json({ status: 'already_canceled' });
  if (data === 'already_requested') return NextResponse.json({ status: 'requested' });
  if (data === 'completed') return NextResponse.json({ status: 'canceled' });
  if (data === 'auto_approved') {
    scheduleApprovedOrderCancellation(orderId);
    return NextResponse.json({ status: 'auto_approved' }, { status: 202 });
  }
  if (data === 'requested') {
    if (claimType === 'cancel') scheduleApprovedOrderCancellation(orderId);
    return NextResponse.json({ status: 'requested' }, { status: 202 });
  }

  console.error('[orders/claims] unexpected claim request result');
  return errorJson(502, 'claim_failed');
}
