import { NextResponse } from 'next/server';
import { parseTossOrderId, type TossOrderRef } from '@/lib/payments/toss';
import { confirmTossPayment, getTossConfig } from '@/lib/payments/toss-api';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

/* 결제 승인 서버 경로(#88) — successUrl 콜백의 {paymentKey, orderId, amount}를 받아
 * 주문 검증 → 토스 승인 API 호출 → pending 결제 레코드 기록.
 * 승인 성공은 UX 반영용이고, 주문/예매의 최종 확정은 웹훅이 한다(ARCHITECTURE §9). */

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface ConfirmBody {
  paymentKey: string;
  orderId: string;
  amount: number;
}

function parseConfirmBody(body: unknown): ConfirmBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const { paymentKey, orderId, amount } = body as Record<string, unknown>;
  if (typeof paymentKey !== 'string' || !paymentKey || paymentKey.length > 200) return null;
  if (typeof orderId !== 'string' || !orderId) return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return null;
  return { paymentKey, orderId, amount };
}

/** 본인 소유 pending 대상 조회 — RLS(본인 읽기)에 더해 user_id를 명시 대조한다. */
async function loadPayableTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ref: TossOrderRef,
  userId: string,
) {
  const table = ref.purpose === 'order' ? 'orders' : 'ticket_orders';
  const { data, error } = await supabase
    .from(table)
    .select('id,user_id,status,total,expires_at')
    .eq('id', ref.refId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
  return data as { id: string; user_id: string; status: string; total: number; expires_at: string | null } | null;
}

export async function POST(request: Request) {
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured || !getTossConfig().isConfigured) {
    return errorJson(503, 'not_configured', '결제 환경이 구성되지 않았습니다.');
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return errorJson(401, 'auth_required', '로그인이 필요합니다.');

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, 'invalid_body', '요청 본문이 JSON이 아닙니다.');
  }
  const body = parseConfirmBody(rawBody);
  if (!body) return errorJson(400, 'invalid_body', 'paymentKey·orderId·amount가 필요합니다.');

  const ref = parseTossOrderId(body.orderId);
  if (!ref) return errorJson(400, 'invalid_order_id', '주문 식별자 형식이 올바르지 않습니다.');

  const target = await loadPayableTarget(supabase, ref, user.id);
  if (!target) return errorJson(404, 'not_found', '주문을 찾을 수 없습니다.');

  const service = createServiceClient();

  if (target.status !== 'pending') {
    // 웹훅이 먼저 확정을 끝낸 재시도라면 성공으로 응답한다(콜백 페이지 새로고침 등).
    const { data: paid } = await service
      .from('payments')
      .select('status')
      .eq('idempotency_key', body.paymentKey)
      .eq('status', 'paid')
      .maybeSingle();
    if (target.status === 'paid' && paid) return NextResponse.json({ status: 'already_confirmed' });
    return errorJson(409, 'not_payable', '결제할 수 없는 주문 상태입니다.');
  }
  if (target.expires_at !== null && Date.parse(target.expires_at) <= Date.now()) {
    return errorJson(409, 'expired', '결제 유효 시간이 지났습니다. 주문을 다시 생성해 주세요.');
  }
  // 토스 공식 필수 절차: 승인 전에 콜백 amount와 서버에 저장된 주문 금액을 대조한다.
  if (body.amount !== target.total) {
    console.error(`[payments/confirm] amount mismatch: ${ref.purpose} ${ref.refId}`);
    return errorJson(400, 'amount_mismatch', '결제 금액이 주문 금액과 일치하지 않습니다.');
  }

  const recordPayment = (status: 'pending' | 'failed', raw: unknown) =>
    service.from('payments').upsert(
      {
        user_id: user.id,
        purpose: ref.purpose,
        ref_id: ref.refId,
        amount: body.amount,
        status,
        payment_key: body.paymentKey,
        idempotency_key: body.paymentKey,
        raw,
      },
      // 웹훅이 먼저 확정한 paid 행을 절대 덮지 않는다.
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  // 이전 시도가 남긴 stale failed 행 치유 — 웹훅 확정이 'payment not payable'로 막히지 않게.
  const healFailedRecord = (raw: unknown) =>
    service
      .from('payments')
      .update({ status: 'pending', raw })
      .eq('idempotency_key', body.paymentKey)
      .eq('status', 'failed');

  const confirmed = await confirmTossPayment(body);
  if (!confirmed.ok) {
    // 이미 승인된 paymentKey 재시도 — 웹훅 확정 여부와 무관하게 승인 자체는 성공 상태다.
    if (confirmed.code === 'ALREADY_PROCESSED_PAYMENT') {
      await recordPayment('pending', { source: 'confirm_retry', code: confirmed.code });
      await healFailedRecord({ source: 'confirm_retry', code: confirmed.code });
      return NextResponse.json({ status: 'approved' });
    }
    // 네트워크 단절·토스 5xx는 토스 측 승인 성공 가능성이 남는다 — failed로 단정하지 않는다.
    const ambiguous = confirmed.status === 0 || confirmed.status >= 500;
    if (!ambiguous) {
      await recordPayment('failed', {
        source: 'confirm_api_error',
        code: confirmed.code,
        message: confirmed.message,
      });
    }
    return errorJson(ambiguous ? 502 : 400, confirmed.code, confirmed.message);
  }

  // 승인 성공 — 확정은 웹훅 몫이므로 pending으로만 기록한다.
  const [{ error: recordError }, { error: healError }] = await Promise.all([
    recordPayment('pending', confirmed.body),
    healFailedRecord(confirmed.body),
  ]);
  if (recordError || healError) {
    // 승인은 이미 끝났으므로 실패로 오인시키지 않는다 — 확정은 웹훅이 이어간다.
    console.error(
      `[payments/confirm] failed to record pending payment: ${recordError?.message ?? healError?.message}`,
    );
  }

  return NextResponse.json({ status: 'approved' });
}
