import { randomUUID } from 'node:crypto';
import { scheduleApprovedOrderCancellation } from '@/lib/orders/cancellation-auto.server';
import {
  GoodsPaymentReconciliationInProgressError,
} from '@/lib/payments/goods-checkout';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import { paymentProviderConfigured } from '@/lib/payments/runtime-gateway';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { TicketPaymentReconciliationInProgressError } from '@/lib/payments/ticket-checkout';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';
import type { ConfirmOutcome } from '@/lib/payments/gateway';
import {
  TossWebhookInvalidError,
  parseTossWebhook,
  tossWebhookCaseRef,
} from '@/lib/payments/toss-webhook.server';

interface WebhookAttemptRow {
  readonly id: string;
  readonly purpose: 'order' | 'ticket';
  readonly state: string;
  /**
   * 굿즈 attempt면 주문 id(`payment_attempts.ref_id`, nullable 컬럼) — 승인 뒤 취소 예약의
   * 대상이다. 없으면 예약하지 않는다(재정합 판정에는 쓰지 않는 값이라 5xx로 올리지 않는다).
   */
  readonly refId: string | null;
}

/*
 * 응답 뒤(`after`) 결제사 취소 예약이 쓰는 예산. 웹훅 재정합(paymentKey 조회 + orderId 조회 +
 * 허용 밖 수단 취소·확인 조회, 각 8초)에 더해, 승인 결과로 자동 승인된 취소의 토스 전액 취소
 * (취소 8초 + 조회 8초×2) + DB가 같은 함수 시간 안에서 돈다(Next.js `after` — route의
 * maxDuration 안에서 실행). 클레임 라우트와 같은 90초다.
 */
export const maxDuration = 90;

/**
 * reconcile seam(goods·ticket checkout의 `reconcilePayment`)이 돌려주는 판정 중
 * 라우트가 읽는 축만 남긴 구조 타입. attemptId·provider·evidence는 원장의 몫이고
 * 웹훅 응답 본문으로는 나가지 않는다 — 여기서는 재전송을 더 받을지만 정한다.
 */
type WebhookReconcileResult = Pick<ConfirmOutcome, 'outcome'>;

/**
 * reconcile seam 입력. `providerPaymentKeyHint`는 서명 없는 본문의 paymentKey라 확정
 * 근거가 아니다 — 게이트웨이가 paymentKey 조회 응답이 attempt(주문·상점 MID)와 일치할
 * 때만 쓰고, 아니면 버리고 orderId 조회로 판정한다.
 */
interface WebhookReconcileInput {
  readonly attemptId: string;
  readonly caseRef: string;
  readonly providerPaymentKeyHint?: string;
}

interface TossWebhookHandlerDependencies {
  readonly available: () => boolean;
  readonly loadAttempt: (providerOrderId: string) => Promise<WebhookAttemptRow | null>;
  readonly reconcileGoods: (input: WebhookReconcileInput) => Promise<WebhookReconcileResult>;
  readonly reconcileTicket: (input: WebhookReconcileInput) => Promise<WebhookReconcileResult>;
  /**
   * 굿즈 결제가 재정합으로 승인된 뒤, 그 주문에 승인(processing)된 취소가 있으면 결제사 전액
   * 취소를 응답 뒤에 실행하도록 예약한다(`scheduleApprovedOrderCancellation`). 활성 취소가
   * 없거나 Korpay·무통장이면 no-op이다.
   */
  readonly scheduleOrderCancellation: (orderId: string) => void;
  readonly createCaseRefFallback?: () => string;
}

const RECONCILABLE_STATES = new Set(['confirming', 'unknown', 'needs_review']);

function acknowledged() {
  return Response.json({ received: true }, { status: 200 });
}

/**
 * 토스 웹훅(같은 URL에 문서 기반 재작성 — #390). 웹훅은 확정의 진실원이 아니라
 * 재정합 트리거다: 본문에서 orderId(대상 attempt)와 paymentKey(조회 힌트)만 읽어 해당
 * attempt를 조회 API 기반 reconcile seam에 태우고, 반영은 전부 DB 멱등 finalizer가 한다.
 * 종결된 attempt에 대한 웹훅(중복 수신·상태 역전 신호)은 no-op 200이다 — 원장을
 * 웹훅으로 되돌리는 경로는 존재하지 않는다. 웹훅은 상점아이디(MID)별로 등록·전송되므로
 * (공식문서 41 /guides/v2/webhook) 개발자센터에서 MID iconsi0xvd(테스트 모드 ticonsi0xvd)에
 * 등록한다.
 */
export function createTossWebhookHandler({
  available,
  loadAttempt,
  reconcileGoods,
  reconcileTicket,
  scheduleOrderCancellation,
  createCaseRefFallback = randomUUID,
}: TossWebhookHandlerDependencies) {
  return async function handleTossWebhook(request: Request) {
    if (!available()) {
      // 자격 증명·service 미구성 — 재전송(최대 7회)이 복구 후 재시도하게 한다.
      return Response.json({ error: 'unavailable' }, { status: 503 });
    }

    let parsed;
    try {
      parsed = await parseTossWebhook(request);
    } catch (error) {
      if (error instanceof TossWebhookInvalidError) {
        return Response.json({ error: 'invalid_webhook' }, { status: 400 });
      }
      throw error;
    }
    if (parsed.kind !== 'payment_status_changed') return acknowledged();

    let attempt: WebhookAttemptRow | null;
    try {
      attempt = await loadAttempt(parsed.providerOrderId);
    } catch {
      // 조회 실패는 부재가 아니다. 일시 DB 장애를 200으로 닫으면 굿즈의 유일한
      // 자동 복구 경로(재전송)가 그대로 끊긴다 — 5xx로 남겨 다시 받는다.
      return Response.json({ error: 'attempt_lookup_failed' }, { status: 500 });
    }
    // 미지 식별자는 재전송해도 처리할 것이 없다 — 우리 원장의 결제가 아니다.
    if (!attempt) return acknowledged();
    // prepared는 TTL 스윕 소관이고, 종결 상태는 웹훅이 건드릴 수 없다(멱등).
    if (!RECONCILABLE_STATES.has(attempt.state)) return acknowledged();

    const caseRef = tossWebhookCaseRef(request, createCaseRefFallback);
    if (!caseRef) return acknowledged();

    const reconcileInput: WebhookReconcileInput = {
      attemptId: attempt.id,
      caseRef,
      ...(parsed.providerPaymentKeyHint
        ? { providerPaymentKeyHint: parsed.providerPaymentKeyHint }
        : {}),
    };
    let result: WebhookReconcileResult;
    try {
      result = attempt.purpose === 'order'
        ? await reconcileGoods(reconcileInput)
        : await reconcileTicket(reconcileInput);
    } catch (error) {
      if (
        error instanceof GoodsPaymentReconciliationInProgressError
        || error instanceof TicketPaymentReconciliationInProgressError
      ) {
        // 다른 처리자(confirm 핸들러·내부 reconcile)가 claim 리스를 쥐고 있다. 여기서
        // 200을 주면 토스는 다시 보내지 않는다 — 문서 41(웹훅 재전송 정책): "200 응답을
        // 보내지 않고 최초의 웹훅 전송이 실패하면 최대 7회(최초 전송으로부터 3일
        // 19시간 후)까지 웹훅을 재전송합니다", 재전송 간격은 1·4·16·64·256·1024·4096분
        // (누적 +1·+5·+21·+85분…). 원 처리자가 승인 뒤 finalize 전에 죽으면 attempt는
        // confirming으로 남고 크론도 없다. claim 리스는 10분(supabase/migrations/
        // 20260901110000_goods_payment_reconciliation.sql — in_progress 판정 :192-208,
        // claim_expires_at :278)이라 503으로 남기면 3회차(+21분)부터의 재전송이 리스
        // 만료 뒤 회수한다. 정상 결제에서 confirm 처리 중 도착한 DONE 웹훅이 1~2회 더
        // 오는 비용은 감수한다 — 종결된 attempt에는 멱등 no-op 200이다.
        return Response.json({ error: 'reconciliation_in_progress' }, { status: 503 });
      }
      // 재정합 실패 — 재전송이 다시 시도하도록 5xx로 남긴다.
      return Response.json({ error: 'reconciliation_failed' }, { status: 500 });
    }

    if (attempt.purpose === 'order' && result.outcome === 'approved' && attempt.refId) {
      /*
       * 승인 결과가 늦게 확정된 결제(confirm 시한 초과 → unknown → 웹훅 재정합)에 그 사이
       * 접수된 취소가 있으면 finalizer가 요청을 자동 승인(processing)하고 구매자에게 "결제
       * 취소 처리를 시작합니다"를 보낸다. 여기서 예약하지 않으면 결제사 취소를 발행하는 곳이
       * 없어 카드 승인이 살아 있는 채 처리중으로 남는다. 예약은 응답 뒤에 돌아 10초 응답
       * 예산과 ack에 영향이 없고, 예약 실패도 ack를 바꾸지 않는다(그 건은 운영자의 '환불 완료
       * 확정'이 같은 경로로 닫는다).
       */
      try {
        scheduleOrderCancellation(attempt.refId);
      } catch {
        console.error(`[webhooks/tosspayments] order cancellation scheduling failed (attempt:${attempt.id})`);
      }
    }

    if (result.outcome === 'unknown') {
      // 조회 API의 일시 실패(타임아웃·5xx·시한 내 404)는 throw가 아니라 unknown으로
      // resolve된다. 여기서 200을 주면 이 스택의 유일한 자동 재시도 경로를 스스로
      // 끊는 것이다. 어댑터가 만료+45분 이후의 부재는 declined로 종결하므로, 재전송을
      // 계속 태우면 unknown은 시간이 지나 반드시 터미널로 수렴한다.
      return Response.json({ error: 'reconciliation_unsettled' }, { status: 500 });
    }
    // needs_review(신원 불일치·설정 오류)는 재시도해도 같은 결과라 사람이 볼 몫이고,
    // 터미널(approved·declined·canceled)은 이미 확정이다 — 둘 다 200 ack로 닫는다.
    return acknowledged();
  };
}

async function loadTossAttempt(providerOrderId: string): Promise<WebhookAttemptRow | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('payment_attempts')
    .select('id,purpose,state,ref_id')
    .eq('provider', 'toss')
    .eq('provider_order_id', providerOrderId)
    .maybeSingle();
  // 조회 오류와 행 부재를 합치지 않는다 — 합치면 일시 장애가 "미지 orderId"와 같은
  // 200 ack로 끝나 재전송이 멈춘다. null은 오직 "우리 원장에 없다"만 뜻한다.
  if (error) throw new Error(`toss_webhook_attempt_lookup_failed:${error.code ?? 'unknown'}`);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || (row.purpose !== 'order' && row.purpose !== 'ticket')
    || typeof row.state !== 'string'
  ) {
    // 행은 있는데 형태가 계약과 다르면 "우리 결제가 아니다"가 아니라 원장 데이터
    // 이상이다. 200으로 삼키면 관측도 복구도 없이 사라지므로 조회 실패와 같은
    // 축으로 올려 5xx·재전송에 맡긴다.
    throw new Error('toss_webhook_attempt_row_invalid');
  }
  return {
    id: row.id,
    purpose: row.purpose,
    state: row.state,
    refId: typeof row.ref_id === 'string' ? row.ref_id : null,
  };
}

export const POST = createTossWebhookHandler({
  // 굿즈·티켓 공통 수신부라 purpose별 파사드 대신 판정 요소(service role +
  // toss 자격 증명)를 직접 조합한다.
  available: () => getServiceRoleConfig().isConfigured && paymentProviderConfigured('toss'),
  loadAttempt: loadTossAttempt,
  reconcileGoods: (input) => createRuntimeGoodsPaymentCheckout('toss').reconcilePayment(input),
  reconcileTicket: (input) => createRuntimeTicketPaymentCheckout('toss').reconcilePayment(input),
  scheduleOrderCancellation: scheduleApprovedOrderCancellation,
});
