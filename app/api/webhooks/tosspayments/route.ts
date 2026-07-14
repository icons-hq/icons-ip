import { NextResponse } from 'next/server';
import {
  decideWebhookAction,
  mapConfirmRpcError,
  normalizeTossPayment,
  parseWebhookEvent,
  type NormalizedTossPayment,
  type TossOrderRef,
} from '@/lib/payments/toss';
import { cancelTossPayment, fetchTossPayment, getTossConfig } from '@/lib/payments/toss-api';
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
  const { data: existing } = await service
    .from('payments')
    .select('id,status')
    .eq('idempotency_key', payment.paymentKey)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'pending') {
      await service.from('payments').update({ status, raw }).eq('id', existing.id).eq('status', 'pending');
    }
    return;
  }

  const table = ref.purpose === 'order' ? 'orders' : 'ticket_orders';
  const { data: target } = await service.from(table).select('user_id').eq('id', ref.refId).maybeSingle();
  if (!target) return;

  await service.from('payments').upsert(
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
  await recordTerminalPayment(service, ref, payment, 'canceled', raw);
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
    .select('id,status')
    .eq('idempotency_key', payment.paymentKey)
    .maybeSingle();
  if (error) {
    console.error(`[webhooks/tosspayments] payment lookup failed: ${error.message}`);
    return errorJson(500, 'lookup_failed');
  }
  if (!existing) return received('no_local_payment');

  if (existing.status === 'paid') {
    const { error: rpcError } =
      ref.purpose === 'order'
        ? await service.rpc('cancel_order', { p_order_id: ref.refId, p_reason: '토스 결제 취소 웹훅 반영' })
        : await service.rpc('refund_ticket_order', {
            p_ticket_order_id: ref.refId,
            p_reason: '토스 결제 취소 웹훅 반영',
          });
    if (rpcError) {
      console.error(`[webhooks/tosspayments] cancel reflect failed: ${rpcError.message}`);
      return errorJson(500, 'cancel_reflect_failed');
    }
    return received();
  }

  if (existing.status === 'pending') {
    await service.from('payments').update({ status: 'canceled', raw }).eq('id', existing.id).eq('status', 'pending');
  }
  return received();
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

  const action = decideWebhookAction(payment);
  if (action.kind === 'ignore') return received(action.reason);
  if (action.kind === 'unsupported') {
    console.error(`[webhooks/tosspayments] unsupported status: ${payment.status} (${payment.paymentKey})`);
    return errorJson(500, 'unsupported_status');
  }

  const service = createServiceClient();
  if (action.kind === 'confirm') return applyConfirm(service, action.ref, payment, verified.body);
  if (action.kind === 'reflect_cancel') return applyReflectCancel(service, action.ref, payment, verified.body);
  return applyRecordFailure(service, payment, verified.body);
}
