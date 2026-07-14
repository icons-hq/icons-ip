import { NextResponse } from 'next/server';
import {
  isIndeterminateTossFailure,
  normalizeTossPayment,
  parseTossOrderId,
  verifyApprovedTossPayment,
  type ApprovedTossPaymentVerification,
  type TossOrderRef,
} from '@/lib/payments/toss';
import {
  cancelTossPayment,
  confirmTossPayment,
  fetchTossPayment,
  getTossConfig,
} from '@/lib/payments/toss-api';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

/* 결제 승인 서버 경로(#88) — successUrl 콜백의 {paymentKey, orderId, amount, paymentType}을 받아
 * 주문 검증 → 토스 승인 API 호출 → pending 결제 레코드 기록.
 * 승인 성공은 UX 반영용이고, 주문/예매의 최종 확정은 웹훅이 한다(ARCHITECTURE §9). */

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface ConfirmBody {
  paymentKey: string;
  orderId: string;
  amount: number;
  paymentType: unknown;
}

function parseConfirmBody(body: unknown): ConfirmBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const { paymentKey, orderId, amount, paymentType } = body as Record<string, unknown>;
  if (typeof paymentKey !== 'string' || !paymentKey || paymentKey.length > 200) return null;
  if (typeof orderId !== 'string' || !orderId) return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return null;
  return { paymentKey, orderId, amount, paymentType };
}

function verificationError(verification: Exclude<ApprovedTossPaymentVerification, { ok: true }>) {
  if (verification.reason === 'unsupported_payment_method') {
    console.error('[payments/confirm] unsupported payment method was approved; manual intervention required');
    return errorJson(
      502,
      'unsupported_payment_method',
      '지원하지 않는 결제수단이 승인되었습니다. 고객센터에 문의해주세요.',
    );
  }
  if (verification.reason === 'unsupported_payment_contract') {
    console.error('[payments/confirm] unsupported payment contract was approved; manual intervention required');
    return errorJson(
      502,
      'unsupported_payment_contract',
      '지원하지 않는 결제 조건이 승인되었습니다. 고객센터에 문의해주세요.',
    );
  }
  console.error('[payments/confirm] provider response did not match the requested payment');
  return errorJson(
    502,
    'provider_response_mismatch',
    '결제 승인 결과를 확인하지 못했습니다. 고객센터에 문의해주세요.',
  );
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
  if (body.paymentType !== 'NORMAL') {
    return errorJson(400, 'invalid_payment_type', '지원하지 않는 결제 유형입니다.');
  }

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

  const recordPayment = (raw: unknown) =>
    service.from('payments').upsert(
      {
        user_id: user.id,
        purpose: ref.purpose,
        ref_id: ref.refId,
        amount: body.amount,
        status: 'pending',
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
  const recordPendingEvidence = async (raw: unknown) => {
    const [{ error: recordError }, { error: healError }] = await Promise.all([
      recordPayment(raw),
      healFailedRecord(raw),
    ]);
    if (recordError || healError) {
      // 승인은 이미 끝났으므로 실패로 오인시키지 않는다 — 확정은 웹훅이 이어간다.
      console.error(
        `[payments/confirm] failed to record pending payment: ${recordError?.message ?? healError?.message}`,
      );
      return false;
    }
    return true;
  };
  const recordCanceledEvidence = async (raw: unknown) => {
    const canceledPayment = {
      user_id: user.id,
      purpose: ref.purpose,
      ref_id: ref.refId,
      amount: body.amount,
      status: 'canceled' as const,
      payment_key: body.paymentKey,
      idempotency_key: body.paymentKey,
      raw,
    };
    const [{ error: insertError }, { error: updateError }] = await Promise.all([
      service.from('payments').upsert(canceledPayment, {
        onConflict: 'idempotency_key',
        ignoreDuplicates: true,
      }),
      service
        .from('payments')
        .update({ status: 'canceled', raw })
        .eq('idempotency_key', body.paymentKey)
        .eq('status', 'pending'),
    ]);
    if (insertError || updateError) {
      console.error(
        `[payments/confirm] failed to record canceled payment: ${insertError?.message ?? updateError?.message}`,
      );
      return false;
    }
    return true;
  };

  const paymentRequest = {
    paymentKey: body.paymentKey,
    orderId: body.orderId,
    amount: body.amount,
  };
  const confirmed = await confirmTossPayment(paymentRequest);
  let approvedBody: unknown;
  if (!confirmed.ok) {
    // 이미 승인된 paymentKey 재시도도 조회 응답을 원 요청과 대조한 뒤에만 성공으로 취급한다.
    if (confirmed.code === 'ALREADY_PROCESSED_PAYMENT') {
      const fetched = await fetchTossPayment(body.paymentKey);
      if (!fetched.ok) {
        return errorJson(
          502,
          'provider_response_mismatch',
          '결제 승인 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
        );
      }
      approvedBody = fetched.body;
    } else {
      // 네트워크 단절·토스 5xx·멱등 처리 중(409)은 토스 측 승인 성공 가능성이 남는다.
      const indeterminate = isIndeterminateTossFailure(confirmed);
      return errorJson(
        indeterminate ? 502 : 400,
        indeterminate ? 'payment_approval_unknown' : 'payment_approval_failed',
        indeterminate
          ? '결제 승인 결과를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'
          : '결제를 승인하지 못했습니다. 결제 정보를 확인하고 다시 시도해주세요.',
      );
    }
  } else {
    approvedBody = confirmed.body;
  }

  const verification = verifyApprovedTossPayment(approvedBody, paymentRequest);
  if (!verification.ok) {
    const normalizedPayment = normalizeTossPayment(approvedBody);
    if (
      verification.reason === 'unsupported_payment_method'
      && normalizedPayment?.method === '가상계좌'
      && normalizedPayment.status === 'WAITING_FOR_DEPOSIT'
    ) {
      const canceled = await cancelTossPayment(body.paymentKey, 'ICONS 미지원 가상계좌 자동 취소');
      if (!canceled.ok && canceled.code !== 'ALREADY_CANCELED_PAYMENT') {
        await recordPendingEvidence(approvedBody);
        console.error(`[payments/confirm] virtual-account auto-cancel failed: ${canceled.code}`);
        return errorJson(
          502,
          'auto_cancel_failed',
          '지원하지 않는 결제수단을 정리하지 못했습니다. 잠시 후 다시 시도해주세요.',
        );
      }

      const recorded = await recordCanceledEvidence(approvedBody);
      const { error: localCancelError } = ref.purpose === 'order'
        ? await service.rpc('cancel_order_with_provider_evidence', {
            p_order_id: ref.refId,
            p_reason: '미지원 가상계좌 자동 취소',
            p_provider_payment_keys: [body.paymentKey],
          })
        : await service.rpc('refund_ticket_order', {
            p_ticket_order_id: ref.refId,
            p_reason: '미지원 가상계좌 자동 취소',
          });
      if (localCancelError) {
        console.error(`[payments/confirm] local checkout cancel failed: ${localCancelError.message}`);
        return errorJson(
          502,
          'local_cancel_failed',
          '결제수단은 취소됐지만 주문 정리를 확인하지 못했습니다. 고객센터에 문의해주세요.',
        );
      }
      if (!recorded) {
        return errorJson(
          502,
          'payment_record_failed',
          '결제수단은 취소됐지만 처리 기록을 확인하지 못했습니다. 고객센터에 문의해주세요.',
        );
      }
      return errorJson(
        409,
        'unsupported_payment_method_canceled',
        '지원하지 않는 결제수단이 취소되었습니다. 주문을 다시 생성해주세요.',
      );
    }

    // 승인 완료 사실은 잃지 않는다. 자동 취소 계약이 없는 결제는 pending으로 보존해
    // 만료 정리가 주문을 먼저 취소하지 못하게 하고 운영 오류로 명시적으로 노출한다.
    if (verification.reason !== 'provider_response_mismatch') {
      const recorded = await recordPendingEvidence(approvedBody);
      if (!recorded) {
        return errorJson(
          502,
          'payment_record_failed',
          '결제 승인 기록을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
        );
      }
    }
    return verificationError(verification);
  }

  // 승인 성공 — 확정은 웹훅 몫이므로 pending으로만 기록한다.
  const recorded = await recordPendingEvidence(approvedBody);
  if (!recorded) {
    return errorJson(
      502,
      'payment_record_failed',
      '결제 승인 기록을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
    );
  }

  return NextResponse.json({ status: 'approved' });
}
