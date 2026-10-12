import 'server-only';

import { after } from 'next/server';
import { createServiceClient } from '../supabase/service';
import {
  reconcileOrderCancellation,
  type CancellationReconciliationResult,
} from './cancellation-orchestrator.server';

/*
 * 고객이 연 취소를 서버가 곧바로 결제 취소까지 닫는다(2026-10-12 점검 REF-2·DB-2).
 *
 * 발주확인 전 변심 취소는 DB가 자동 승인(processing)한다. 그 뒤 결제사 취소를
 * 부르는 곳이 없으면 고객은 "결제 취소 처리를 시작합니다"를 받고도 카드 승인이 그대로
 * 남는다. 여기서 같은 오케스트레이터(토스 전액 취소 → fresh 조회 검증 → finalizer)를
 * 시스템 actor로 실행한다. 실패·모호 결과는 오케스트레이터가 needs_review로 남기고,
 * 운영자의 '처리 상태 확인'·'환불 완료 확정'이 같은 경로로 다시 시도한다.
 *
 * 응답은 기다리지 않는다(`after`). 취소 8초 + 조회 8초×2가 고객 화면을 붙잡으면
 * 같은 버튼을 다시 누르게 된다. 판정 근거는 전부 DB에서 다시 읽는다 — 호출자가 넘기는
 * 것은 주문 id 하나다.
 *
 * 결제 승인 응답을 기다리는 사이(attempt confirming)에 접수된 취소는 requested로
 * 남는다. 승인 결과가 오면 finalizer가 그 요청을 자동 승인(approved)하거나 결제 없이
 * 종결(declined)한다(20261012110100). 그 결과를 짧게 기다렸다가 승인됐으면 같은 경로로
 * 결제사 취소를 발행한다. 기다리는 창은 승인 라우트 최악 경로(≈34초 + DB)를 덮는다.
 */

/** 승인 라우트(maxDuration 60) 최악 경로 ≈ 34초 + DB를 덮는 대기 상한. */
export const CONFIRMING_ATTEMPT_WAIT_MS = 40_000;
const POLL_INTERVAL_MS = 1_500;

type ActiveRequestStatus = 'requested' | 'processing' | 'needs_review';

export interface SystemCancellationState {
  requestId: string;
  requestStatus: ActiveRequestStatus;
  attemptState: string | null;
}

export type SystemCancellationOutcome =
  | { status: 'skipped'; reason: 'no_active_cancel' | 'awaiting_staff' | 'needs_review' }
  | { status: 'reconciled'; requestId: string; result: CancellationReconciliationResult }
  | { status: 'failed' };

export interface SystemCancellationDependencies {
  loadState(orderId: string): Promise<SystemCancellationState | null>;
  reconcile(requestId: string): Promise<CancellationReconciliationResult>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const ACTIVE_STATUSES = new Set<ActiveRequestStatus>(['requested', 'processing', 'needs_review']);

function createDefaultDependencies(): SystemCancellationDependencies {
  const service = createServiceClient();
  return {
    async loadState(orderId) {
      // 활성 요청은 주문당 하나다(order_cancellation_requests_one_active_idx).
      const { data: requestData, error: requestError } = await service
        .from('order_cancellation_requests')
        .select('id,status,claim_type')
        .eq('order_id', orderId)
        .in('status', [...ACTIVE_STATUSES])
        .maybeSingle();
      if (requestError) throw new Error('cancellation request lookup failed');
      if (!requestData) return null;
      const request = requestData as Record<string, unknown>;
      if (
        typeof request.id !== 'string'
        || typeof request.status !== 'string'
        || !ACTIVE_STATUSES.has(request.status as ActiveRequestStatus)
      ) {
        throw new Error('invalid cancellation request state');
      }
      // 시스템 경로는 취소만 닫는다. 반품·교환은 회수 확인이 선행하는 staff 절차다.
      if (request.claim_type !== 'cancel') return null;

      const { data: attemptData, error: attemptError } = await service
        .from('payment_attempts')
        .select('state')
        .eq('purpose', 'order')
        .eq('ref_id', orderId)
        .order('id', { ascending: true })
        .limit(1);
      if (attemptError) throw new Error('payment attempt lookup failed');
      const attempt = (attemptData ?? [])[0] as Record<string, unknown> | undefined;

      return {
        requestId: request.id,
        requestStatus: request.status as ActiveRequestStatus,
        attemptState: typeof attempt?.state === 'string' ? attempt.state : null,
      };
    },
    reconcile(requestId) {
      return reconcileOrderCancellation({ requestId, actorId: null });
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

/**
 * 주문의 활성 취소 요청이 승인(processing) 상태면 결제사 전액 취소까지 실행한다.
 *
 * - processing: 시스템 actor로 오케스트레이터를 실행한다.
 * - requested + 결제 승인 확인 중(confirming): `awaitConfirmingAttemptMs` 동안
 *   finalizer의 판정을 기다린다. 그 밖의 requested는 staff 판단 대기다.
 * - needs_review: 사람이 원인을 본 뒤 재시도한다. 시스템이 다시 돌리지 않는다.
 */
export async function issueApprovedOrderCancellation(
  orderId: string,
  options: { awaitConfirmingAttemptMs?: number; pollIntervalMs?: number } = {},
  providedDependencies?: SystemCancellationDependencies,
): Promise<SystemCancellationOutcome> {
  try {
    const dependencies = providedDependencies ?? createDefaultDependencies();
    const deadline = dependencies.now() + Math.max(0, options.awaitConfirmingAttemptMs ?? 0);
    const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? POLL_INTERVAL_MS);

    for (;;) {
      const state = await dependencies.loadState(orderId);
      if (!state) return { status: 'skipped', reason: 'no_active_cancel' };
      if (state.requestStatus === 'processing') {
        const result = await dependencies.reconcile(state.requestId);
        if (!result.ok) {
          console.error(`[orders/cancellation] system reconciliation needs review (request:${state.requestId}): ${result.code}`);
        }
        return { status: 'reconciled', requestId: state.requestId, result };
      }
      if (state.requestStatus === 'needs_review') return { status: 'skipped', reason: 'needs_review' };
      if (state.attemptState !== 'confirming' || dependencies.now() >= deadline) {
        return { status: 'skipped', reason: 'awaiting_staff' };
      }
      await dependencies.sleep(pollIntervalMs);
    }
  } catch {
    console.error(`[orders/cancellation] system reconciliation failed (order:${orderId})`);
    return { status: 'failed' };
  }
}

/**
 * 응답을 보낸 뒤 `issueApprovedOrderCancellation`을 실행하도록 예약한다.
 *
 * `after`는 라우트의 maxDuration 안에서 끝까지 실행된다(Next.js `after` 문서 Duration).
 * 호출 라우트는 대기 창 + 결제사 취소·조회 시간을 덮는 maxDuration을 선언해야 한다.
 */
export function scheduleApprovedOrderCancellation(orderId: string) {
  after(async () => {
    await issueApprovedOrderCancellation(orderId, {
      awaitConfirmingAttemptMs: CONFIRMING_ATTEMPT_WAIT_MS,
    });
  });
}
