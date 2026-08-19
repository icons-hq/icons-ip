import { NextResponse } from 'next/server';
import { normalizeOrderReference } from '@/lib/checkout';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import { isOrderClaimType, normalizeRefundAccount, type OrderClaimType } from '@/lib/orders/claims';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

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
 */

const CLAIM_REASONS: Record<OrderClaimType, Record<OrderWithdrawalReasonType, string>> = {
  cancel: {
    change_of_mind: '사용자 주문 취소',
    defect: '상품 하자·오배송 취소',
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

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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
  if (!body || typeof body !== 'object') return errorJson(400, 'invalid_body');

  const payload = body as Record<string, unknown>;
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

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,user_id')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle<OrderRow>();

  if (orderError) {
    console.error('[orders/claims] order lookup failed');
    return errorJson(502, 'claim_failed');
  }
  if (!orderData) return errorJson(404, 'not_found');

  const service = createServiceClient();
  const { data, error } = await service.rpc('request_order_claim', {
    p_account_holder: account.value?.accountHolder ?? null,
    p_account_number: account.value?.accountNumber ?? null,
    p_bank_name: account.value?.bankName ?? null,
    p_claim_type: claimType,
    p_order_id: orderId,
    p_reason: CLAIM_REASONS[claimType][reasonType],
    p_reason_type: reasonType,
    p_user_id: user.id,
  });
  if (error) {
    console.error('[orders/claims] claim request failed');
    return errorJson(502, 'claim_failed');
  }

  if (data === 'not_found') return errorJson(404, 'not_found');
  if (data === 'not_cancelable' || data === 'not_claimable') {
    return errorJson(409, 'not_claimable');
  }
  if (data === 'deadline_expired') return errorJson(409, 'deadline_expired');
  if (data === 'already_canceled') return NextResponse.json({ status: 'already_canceled' });
  if (data === 'already_requested') return NextResponse.json({ status: 'requested' });
  if (data === 'completed') return NextResponse.json({ status: 'canceled' });
  if (data === 'auto_approved') {
    return NextResponse.json({ status: 'auto_approved' }, { status: 202 });
  }
  if (data === 'requested') return NextResponse.json({ status: 'requested' }, { status: 202 });

  console.error('[orders/claims] unexpected claim request result');
  return errorJson(502, 'claim_failed');
}
