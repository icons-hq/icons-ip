import { NextResponse } from 'next/server';
import {
  buildTossOrderId,
  decideWebhookAction,
  mapConfirmRpcError,
  normalizeTossPayment,
  parseWebhookEvent,
  verifyTossCancellationState,
  type NormalizedTossPayment,
  type TossOrderRef,
} from '@/lib/payments/toss';
import { cancelTossPayment, fetchTossPayment, getTossConfig } from '@/lib/payments/toss-api';
import { checkoutPaymentsEnabled } from '@/lib/payments/checkout-availability';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';

/* 토스페이먼츠 웹훅 수신부(#88) — 주문/예매 확정의 단일 진실원.
 * 결제 웹훅에는 서명이 없다(서명 헤더는 지급대행 웹훅 전용). 그래서 payload를 신뢰하지 않고
 * paymentKey만 취해 시크릿 키로 결제 조회 API를 재호출한 응답을 진실로 삼는다.
 * 응답 규약: 토스는 10초 내 200만 성공으로 취급하고, 4xx/5xx 구분 없이 200이 아니면
 * 최대 7회 재전송(지수 백오프)한다. 4xx는 비토스 발신(위조·스캐너)에 대한 정확한 신호로
 * 쓰며 — 토스 정식 이벤트가 4xx 경로에 떨어지는 경우(키·MID 불일치 같은 설정 오류)는
 * 재전송 소진·실패 이메일로 운영에 노출되는 의도된 동작이다.
 * 중복 전송 멱등성은 idempotency_key=paymentKey와 확정 RPC의 멱등 규칙이 보장한다. */

type ServiceClient = ReturnType<typeof createServiceClient>;

function received(detail?: string) {
  return NextResponse.json({ received: true, ...(detail ? { detail } : {}) });
}

function errorJson(status: number, code: string) {
  return NextResponse.json({ error: { code } }, { status });
}

/** 결제를 종결 상태로 기록 — 승인 경로가 남긴 pending 행이 있으면 갱신, 없으면 추적용으로 신규 기록. */
async function recordTerminalPayment(
  service: ServiceClient,
  ref: TossOrderRef,
  payment: NormalizedTossPayment,
  status: 'canceled' | 'failed',
  raw: unknown,
) {
  const { data: existing, error: lookupError } = await service
    .from('payments')
    .select('id,status')
    .eq('idempotency_key', payment.paymentKey)
    .maybeSingle();
  if (lookupError) {
    console.error(`[webhooks/tosspayments] terminal payment lookup failed: ${lookupError.message}`);
    return false;
  }

  if (existing) {
    if (existing.status === 'pending') {
      const { error } = await service
        .from('payments')
        .update({ status, raw })
        .eq('id', existing.id)
        .eq('status', 'pending');
      if (error) {
        console.error(`[webhooks/tosspayments] terminal payment update failed: ${error.message}`);
        return false;
      }
    }
    return true;
  }

  const table = ref.purpose === 'order' ? 'orders' : 'ticket_orders';
  const { data: target, error: targetError } = await service
    .from(table)
    .select('user_id')
    .eq('id', ref.refId)
    .maybeSingle();
  if (targetError) {
    console.error(`[webhooks/tosspayments] terminal target lookup failed: ${targetError.message}`);
    return false;
  }
  if (!target) return true;

  const { error: insertError } = await service.from('payments').upsert(
    {
      user_id: (target as { user_id: string }).user_id,
      purpose: ref.purpose,
      ref_id: ref.refId,
      amount: payment.totalAmount,
      status,
      payment_key: payment.paymentKey,
      idempotency_key: payment.paymentKey,
      raw,
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  );
  if (insertError) {
    console.error(`[webhooks/tosspayments] terminal payment insert failed: ${insertError.message}`);
    return false;
  }
  return true;
}

/** DONE → 확정 RPC. 만료 등 확정 불가면 돈이 재고를 따라가도록 토스 결제를 자동 취소한다. */
async function applyConfirm(
  service: ServiceClient,
  ref: TossOrderRef,
  payment: NormalizedTossPayment,
  raw: unknown,
) {
  const { error } =
    ref.purpose === 'order'
      ? await service.rpc('confirm_order_payment', {
          p_idempotency_key: payment.paymentKey,
          p_order_id: ref.refId,
          p_payment_key: payment.paymentKey,
          p_amount: payment.totalAmount,
          p_raw: raw,
        })
      : await service.rpc('confirm_ticket_payment', {
          p_idempotency_key: payment.paymentKey,
          p_ticket_order_id: ref.refId,
          p_payment_key: payment.paymentKey,
          p_amount: payment.totalAmount,
          p_raw: raw,
        });
  if (!error) return received();

  if (mapConfirmRpcError(error.message) === 'retryable') {
    console.error(`[webhooks/tosspayments] confirm failed (retryable): ${error.message}`);
    return errorJson(500, 'confirm_failed');
  }

  const canceled = await cancelTossPayment(payment.paymentKey, 'ICONS 주문 만료 자동 취소');
  if (!canceled.ok && canceled.code !== 'ALREADY_CANCELED_PAYMENT') {
    console.error(`[webhooks/tosspayments] auto-cancel failed: ${canceled.code} ${canceled.message}`);
    return errorJson(500, 'auto_cancel_failed');
  }
  if (!await recordTerminalPayment(service, ref, payment, 'canceled', raw)) {
    return errorJson(500, 'terminal_record_failed');
  }
  return received('unfulfillable_payment_canceled');
}

/** CANCELED → 토스 쪽 취소(콘솔 취소 등)를 우리 주문·재고·환불 기록에 반영. */
async function applyReflectCancel(
  service: ServiceClient,
  ref: TossOrderRef,
  payment: NormalizedTossPayment,
  raw: unknown,
) {
  const { data: existing, error } = await service
    .from('payments')
    .select('id,status,amount,purpose,ref_id,payment_key,idempotency_key')
    .eq('idempotency_key', payment.paymentKey)
    .maybeSingle();
  if (error) {
    console.error(`[webhooks/tosspayments] payment lookup failed: ${error.message}`);
    return errorJson(500, 'lookup_failed');
  }

  const table = ref.purpose === 'order' ? 'orders' : 'ticket_orders';
  const { data: target, error: targetError } = await service
    .from(table)
    .select('status,total')
    .eq('id', ref.refId)
    .maybeSingle();
  if (targetError) {
    console.error(`[webhooks/tosspayments] canceled target lookup failed: ${targetError.message}`);
    return errorJson(500, 'lookup_failed');
  }
  if (!target) return received('no_local_target');

  if (ref.purpose === 'ticket') {
    const targetTotal = (target as { total?: unknown }).total;
    const localPayment = existing as {
      amount?: unknown;
      purpose?: unknown;
      ref_id?: unknown;
      payment_key?: unknown;
      idempotency_key?: unknown;
    } | null;
    const localEvidenceMatches = !localPayment || (
      localPayment.purpose === 'ticket'
      && localPayment.ref_id === ref.refId
      && localPayment.payment_key === payment.paymentKey
      && localPayment.idempotency_key === payment.paymentKey
      && localPayment.amount === targetTotal
    );
    const verification = typeof targetTotal === 'number' && Number.isSafeInteger(targetTotal) && targetTotal > 0
      ? verifyTossCancellationState(raw, {
          paymentKey: payment.paymentKey,
          orderId: buildTossOrderId('ticket', ref.refId),
          amount: targetTotal,
        })
      : null;
    if (!localEvidenceMatches || !verification?.ok || verification.state !== 'fully_canceled') {
      console.error('[webhooks/tosspayments] invalid ticket cancellation evidence');
      return errorJson(500, 'ticket_cancel_evidence_invalid');
    }
    if (!payment.method || payment.method === '가상계좌') {
      console.error('[webhooks/tosspayments] unsupported ticket cancellation payment method');
      return errorJson(500, 'unsupported_ticket_payment_method');
    }
  }

  // 조회된 CANCELED 결제가 로컬에 없으면 provider terminal 증거부터 복구한다.
  // 그래야 이어지는 RPC가 환불 장부까지 같은 트랜잭션에서 정합화할 수 있다.
  if (!existing && !await recordTerminalPayment(service, ref, payment, 'canceled', raw)) {
    return errorJson(500, 'terminal_record_failed');
  }

  if (
    target.status === 'pending'
    || target.status === 'paid'
    || target.status === 'canceled'
  ) {
    const { error: rpcError } = ref.purpose === 'order'
      ? await service.rpc('cancel_order_with_provider_evidence', {
          p_order_id: ref.refId,
          p_reason: '토스 결제 취소 웹훅 반영',
          p_provider_payment_keys: [payment.paymentKey],
        })
      : await service.rpc('refund_ticket_order_with_provider_evidence', {
          p_ticket_order_id: ref.refId,
          p_reason: '토스 결제 취소 웹훅 반영',
          p_provider_payment_key: payment.paymentKey,
          p_provider_raw: raw,
          p_refund_confirmed: true,
        });
    if (rpcError) {
      console.error(`[webhooks/tosspayments] canceled checkout close failed: ${rpcError.message}`);
      return errorJson(500, 'cancel_reflect_failed');
    }
  } else if (target.status !== 'canceled') {
    console.error(`[webhooks/tosspayments] canceled payment has non-cancelable target status: ${target.status}`);
    return errorJson(500, 'cancel_reflect_failed');
  }

  if (!existing) {
    return received();
  }

  if (existing.status === 'pending' || existing.status === 'canceled' || existing.status === 'failed') {
    const { error: updateError } = await service
      .from('payments')
      .update({ status: 'canceled', raw })
      .eq('id', existing.id)
      .eq('status', existing.status);
    if (updateError) {
      console.error(`[webhooks/tosspayments] canceled payment record failed: ${updateError.message}`);
      return errorJson(500, 'cancel_record_failed');
    }
  }
  return received();
}

/** 입금 전 미지원 가상계좌는 토스에서 먼저 닫고, 그 뒤 로컬 선점을 원복한다. */
async function applyCancelUnsupported(
  service: ServiceClient,
  ref: TossOrderRef,
  payment: NormalizedTossPayment,
  raw: unknown,
) {
  const canceled = await cancelTossPayment(payment.paymentKey, 'ICONS 미지원 가상계좌 자동 취소');
  if (!canceled.ok && canceled.code !== 'ALREADY_CANCELED_PAYMENT') {
    console.error(`[webhooks/tosspayments] virtual-account auto-cancel failed: ${canceled.code}`);
    return errorJson(500, 'auto_cancel_failed');
  }

  // provider가 먼저 닫힌 뒤에는 canceled 증거를 남겨 expiry sweep이 pending 행에 막히지 않게 한다.
  const recorded = await recordTerminalPayment(service, ref, payment, 'canceled', raw);
  const { error } = ref.purpose === 'order'
    ? await service.rpc('cancel_order_with_provider_evidence', {
        p_order_id: ref.refId,
        p_reason: '미지원 가상계좌 자동 취소',
        p_provider_payment_keys: [payment.paymentKey],
      })
    : await service.rpc('refund_ticket_order_with_provider_evidence', {
        p_ticket_order_id: ref.refId,
        p_reason: '미지원 가상계좌 자동 취소',
        p_provider_payment_key: payment.paymentKey,
      });
  if (error) {
    console.error(`[webhooks/tosspayments] local checkout cancel failed: ${error.message}`);
    return errorJson(500, 'local_cancel_failed');
  }
  if (!recorded) return errorJson(500, 'terminal_record_failed');
  return received('unsupported_payment_canceled');
}

/** ABORTED·EXPIRED → 승인 경로가 남긴 pending 기록만 실패로 닫는다(없으면 반영할 것 없음). */
async function applyRecordFailure(service: ServiceClient, payment: NormalizedTossPayment, raw: unknown) {
  const { error } = await service
    .from('payments')
    .update({ status: 'failed', raw })
    .eq('idempotency_key', payment.paymentKey)
    .eq('status', 'pending');
  if (error) {
    console.error(`[webhooks/tosspayments] failure record failed: ${error.message}`);
    return errorJson(500, 'failure_record_failed');
  }
  return received();
}

async function productionTestReviewerAllowed(service: ServiceClient, ref: TossOrderRef) {
  const table = ref.purpose === 'order' ? 'orders' : 'ticket_orders';
  const { data: target, error } = await service
    .from(table)
    .select('user_id')
    .eq('id', ref.refId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load ${table} reviewer: ${error.message}`);
  if (!target) return false;

  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('role,suspended_at')
    .eq('id', (target as { user_id: string }).user_id)
    .maybeSingle();
  if (profileError) throw new Error(`Failed to load reviewer profile: ${profileError.message}`);
  const reviewer = profile as { role: string | null; suspended_at: string | null } | null;
  return checkoutPaymentsEnabled(Boolean(
    reviewer
    && !reviewer.suspended_at
    && (reviewer.role === 'staff' || reviewer.role === 'admin'),
  ));
}

async function rejectUnapprovedProductionTestPayment(
  service: ServiceClient,
  ref: TossOrderRef,
  payment: NormalizedTossPayment,
) {
  const canceled = await cancelTossPayment(payment.paymentKey, 'ICONS 승인 계정 외 테스트 결제 자동 취소');
  if (!canceled.ok && canceled.code !== 'ALREADY_CANCELED_PAYMENT') {
    console.error(`[webhooks/tosspayments] unapproved test payment auto-cancel failed: ${canceled.code}`);
    return errorJson(500, 'auto_cancel_failed');
  }
  const canceledResult = canceled.ok ? canceled : await fetchTossPayment(payment.paymentKey);
  if (!canceledResult.ok) {
    console.error(`[webhooks/tosspayments] canceled test payment verification failed: ${canceledResult.code}`);
    return errorJson(500, 'auto_cancel_verification_failed');
  }
  const canceledPayment = normalizeTossPayment(canceledResult.body);
  if (!canceledPayment || canceledPayment.status !== 'CANCELED') {
    console.error('[webhooks/tosspayments] unapproved test payment cancellation shape invalid');
    return errorJson(500, 'auto_cancel_verification_failed');
  }
  return applyReflectCancel(service, ref, canceledPayment, canceledResult.body);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'invalid_json');
  }

  const event = parseWebhookEvent(body);
  if (event.kind === 'invalid') return errorJson(400, 'invalid_event');
  if (event.kind === 'other') return received(`unhandled_event:${event.eventType}`);

  if (!getTossConfig().isConfigured || !getServiceRoleConfig().isConfigured) {
    return errorJson(503, 'not_configured');
  }

  const verified = await fetchTossPayment(event.paymentKey);
  if (!verified.ok) {
    // 조회 불가 = 우리 상점 결제가 아니거나 위조. 400도 토스 재전송은 막지 못하지만,
    // 진짜 토스 이벤트가 여기 떨어졌다면(키·MID 불일치) 실패 알림으로 노출되는 게 맞다.
    if (verified.status === 404 || verified.status === 400) return errorJson(400, 'unknown_payment');
    console.error(`[webhooks/tosspayments] verify fetch failed: ${verified.code} ${verified.message}`);
    return errorJson(502, 'verify_failed');
  }

  const payment = normalizeTossPayment(verified.body);
  if (!payment) {
    console.error('[webhooks/tosspayments] unexpected payment shape from inquiry API');
    return errorJson(500, 'unexpected_payment_shape');
  }
  if (payment.paymentKey !== event.paymentKey) {
    console.error('[webhooks/tosspayments] provider payment identity mismatch');
    return errorJson(500, 'provider_response_mismatch');
  }

  const action = decideWebhookAction(payment);
  if (action.kind === 'ignore') return received(action.reason);
  if (action.kind === 'unsupported') {
    console.error(`[webhooks/tosspayments] unsupported status: ${payment.status} (${payment.paymentKey})`);
    return errorJson(500, 'unsupported_status');
  }

  const service = createServiceClient();
  if (action.kind === 'confirm') {
    try {
      if (!await productionTestReviewerAllowed(service, action.ref)) {
        return rejectUnapprovedProductionTestPayment(service, action.ref, payment);
      }
    } catch (error) {
      console.error(`[webhooks/tosspayments] reviewer lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return errorJson(500, 'reviewer_lookup_failed');
    }
    return applyConfirm(service, action.ref, payment, verified.body);
  }
  if (action.kind === 'reflect_cancel') return applyReflectCancel(service, action.ref, payment, verified.body);
  if (action.kind === 'cancel_unsupported') {
    return applyCancelUnsupported(service, action.ref, payment, verified.body);
  }
  return applyRecordFailure(service, payment, verified.body);
}
