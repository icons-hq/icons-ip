import 'server-only';

import { after } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { reconcileOrderCancellation } from './cancellation-orchestrator.server';

/*
 * 가상계좌 환불 재시도(ADR-0049 결정 5, 2026-11-23 보강).
 *
 * 입금된 가상계좌 주문의 취소가 환급 계좌 때문에 결제확인필요(provider_refund_account_required·provider_refund_account_invalid)로 멈췄을 때,
 * 구매자가 주문 상세에서 계좌를 입력·수정하면 서버가 같은 요청에서 환불을 다시 시도한다.
 *  - DB(service_begin_virtual_account_refund_retry)가 잠금 아래 대상인지 다시 보고 결제확인필요 → 처리 중으로 되돌린다(시스템 actor).
 *  - 응답을 보낸 뒤 취소 오케스트레이터가 결제사 환불(조회 재검증 + DB 멱등 finalizer)을 다시 부른다. 계좌가 바뀌었으므로 멱등키도 다르다.
 *  - 반품은 시스템 actor로 환불하지 않는다(취소만 허용하는 DB 규칙). DB가 계좌 입력 때 운영 알림을 올렸고, 운영자가 [상태 다시 확인]을
 *    누르면 같은 오케스트레이터가 이 계좌로 환불한다.
 */

/**
 * started = 처리 중으로 되돌려 응답 뒤 환불을 다시 부른다 / operator_required = 반품(운영자) / account_missing = 쓸 계좌 없음 /
 * account_invalid = 입력한 계좌를 결제사에 그대로 보낼 수 없어 부르지 않는다(구매자가 계좌를 바꿔야 한다 — DB 판정 하나를 앱 계좌 고르기와
 * 같이 쓴다) / not_applicable = 대상 아님 / failed = DB 호출 실패.
 */
export type VirtualAccountRefundRetryOutcome =
  | 'started' | 'operator_required' | 'account_missing' | 'account_invalid' | 'not_applicable' | 'failed';

const OUTCOMES = new Set<VirtualAccountRefundRetryOutcome>(['started', 'operator_required', 'account_missing', 'account_invalid', 'not_applicable']);

export interface VirtualAccountRefundRetryDependencies {
  begin(requestId: string): Promise<VirtualAccountRefundRetryOutcome>;
  schedule(task: () => Promise<void>): void;
  reconcile(requestId: string): Promise<unknown>;
}

function defaultDependencies(): VirtualAccountRefundRetryDependencies {
  return {
    async begin(requestId) {
      const { data, error } = await createServiceClient().rpc('service_begin_virtual_account_refund_retry', { p_request_id: requestId });
      if (error || typeof data !== 'string' || !OUTCOMES.has(data as VirtualAccountRefundRetryOutcome)) return 'failed';
      return data as VirtualAccountRefundRetryOutcome;
    },
    schedule: (task) => after(task),
    reconcile: (requestId) => reconcileOrderCancellation({ requestId, actorId: null }),
  };
}

/**
 * 계좌를 저장한 뒤 부른다. 대상이면 처리 중으로 되돌리고 응답 뒤에 환불을 다시 시도한다. 어느 단계가 실패해도 저장 결과는 그대로다
 * — 요청은 결제확인필요로 남고, 구매자 화면의 [이 계좌로 환불 다시 요청]이나 운영자 [상태 다시 확인]이 같은 길을 다시 연다.
 */
export async function retryVirtualAccountRefund(
  requestId: string,
  dependencies: VirtualAccountRefundRetryDependencies = defaultDependencies(),
): Promise<VirtualAccountRefundRetryOutcome> {
  let outcome: VirtualAccountRefundRetryOutcome;
  try {
    outcome = await dependencies.begin(requestId);
  } catch {
    return 'failed';
  }
  if (outcome === 'started') {
    dependencies.schedule(async () => {
      try {
        await dependencies.reconcile(requestId);
      } catch {
        console.error('[orders/virtual-account-refund-retry] refund retry failed');
      }
    });
  }
  return outcome;
}
