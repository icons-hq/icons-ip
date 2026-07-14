'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  cancellationEligibility,
  type TicketCancellationStatus,
  type TicketOrderDetail,
} from '@/lib/ticketing';

type CancellationFetch = (
  input: string,
  init: { method: 'POST' },
) => Promise<Pick<Response, 'ok' | 'json'>>;

export type TicketCancellationSubmission =
  | 'canceled'
  | 'already_canceled'
  | 'processing'
  | 'reviewing'
  | false;

export async function submitTicketCancellation(
  ticketOrderId: string,
  fetcher: CancellationFetch = fetch,
): Promise<TicketCancellationSubmission> {
  const response = await fetcher(`/api/ticket-orders/${ticketOrderId}/cancel`, { method: 'POST' });
  if (!response.ok) return false;
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return false;
  const status = (body as { status?: unknown }).status;
  return status === 'canceled'
    || status === 'already_canceled'
    || status === 'processing'
    || status === 'reviewing'
    ? status
    : false;
}

interface TicketCancellationPresentation {
  canCancel: boolean;
  heading: string;
  body: string;
  actionLabel?: string;
}

export function ticketCancellationPresentation(
  order: TicketOrderDetail,
  now: number = Date.now(),
): TicketCancellationPresentation {
  switch (order.cancellationRequest?.status) {
    case 'requested':
      return {
        canCancel: false,
        heading: '취소 요청을 접수했어요',
        body: '결제와 티켓 상태를 확인하고 있습니다. 처리 중에는 QR을 사용할 수 없습니다.',
      };
    case 'processing':
      return {
        canCancel: false,
        heading: '결제 취소를 처리하고 있어요',
        body: '결제사의 최종 취소 결과를 다시 확인하고 있습니다. 잠시 후 페이지를 새로고침해주세요.',
      };
    case 'needs_review':
      return {
        canCancel: false,
        heading: '환불 결과를 확인하고 있어요',
        body: '불확실한 결제 결과를 안전하게 확인 중입니다. 중복 취소는 진행하지 않습니다.',
      };
    case 'completed':
      return {
        canCancel: false,
        heading: '취소·환불이 완료됐어요',
        body: '결제수단에 따라 환불 금액이 표시되는 시점은 다를 수 있습니다.',
      };
  }

  const eligibility = cancellationEligibility({
    status: order.status,
    startsAt: order.startsAt,
    ticketStatuses: order.tickets.map((ticket) => ticket.status),
    cancellationRequest: order.cancellationRequest,
  }, now);
  if (eligibility.canCancel) {
    const hasPayment = order.status === 'paid' || order.paymentStatus !== null;
    return {
      canCancel: true,
      heading: '예매 취소·환불',
      body: hasPayment
        ? '이벤트 시작 전 미사용 티켓 전체를 취소하고 결제 금액을 전액 환불합니다.'
        : '결제 내역이 없으면 예매를 즉시 취소하고, 승인된 결제가 확인되면 결제된 금액 전액을 환불합니다.',
      actionLabel: '예매 전체 취소',
    };
  }

  const blockedCopy = {
    schedule_unknown: '일정이 확정되지 않은 이벤트는 이 화면에서 취소할 수 없습니다. 고객센터에서 확인해주세요.',
    started: '이벤트 시작 시각이 지나 셀프 취소가 마감됐습니다.',
    used: '이미 사용했거나 환불된 티켓이 포함돼 셀프 취소할 수 없습니다.',
    active_request: '취소·환불 요청을 처리하고 있습니다.',
    not_cancelable: '이미 종료된 예매는 다시 취소할 수 없습니다.',
  }[eligibility.reason];
  return { canCancel: false, heading: '셀프 취소가 제한돼요', body: blockedCopy };
}

export type TicketCancellationSubmissionState =
  | 'idle'
  | 'confirming'
  | 'submitting'
  | 'processing'
  | 'success'
  | 'error';

export function ticketCancellationRetryAvailable(
  requestStatus: TicketCancellationStatus | null | undefined,
  submission: TicketCancellationSubmissionState,
) {
  return (requestStatus === 'requested'
      || requestStatus === 'processing'
      || requestStatus === 'needs_review')
    && submission !== 'submitting'
    && submission !== 'success';
}

const krw = (value: number) => `${value.toLocaleString('ko-KR')}원`;

export function TicketCancellation({ order, now }: { order: TicketOrderDetail; now?: number }) {
  const router = useRouter();
  const [submission, setSubmission] = useState<TicketCancellationSubmissionState>('idle');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const presentation = ticketCancellationPresentation(order, now);
  const hasReconcileRequest = order.cancellationRequest?.status === 'requested'
    || order.cancellationRequest?.status === 'needs_review'
    || order.cancellationRequest?.status === 'processing';
  const retryAvailable = ticketCancellationRetryAvailable(
    order.cancellationRequest?.status,
    submission,
  );
  const hasKnownPayment = order.status === 'paid'
    || order.paymentStatus !== null
    || order.cancellationRequest !== null;

  useEffect(() => {
    if (submission !== 'idle' || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [submission]);

  function closeConfirmation() {
    restoreFocusRef.current = true;
    setSubmission('idle');
  }

  async function cancelBooking() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmission('submitting');

    let result: TicketCancellationSubmission = false;
    try {
      result = await submitTicketCancellation(order.id);
    } catch {
      result = false;
    } finally {
      submittingRef.current = false;
    }

    if (!result) {
      setSubmission('error');
      router.refresh();
      return;
    }

    setSubmission(result === 'processing' || result === 'reviewing' ? 'processing' : 'success');
    router.refresh();
  }

  return (
    <section className="ticket-cancellation" aria-labelledby="ticket-cancellation-heading">
      <div className="ticket-cancellation-heading">
        <span className="checkout-step mono">CANCELLATION</span>
        <h2 id="ticket-cancellation-heading">{presentation.heading}</h2>
      </div>
      <p className="ticket-cancellation-body">{presentation.body}</p>

      {(presentation.canCancel || order.cancellationRequest) && (
        <dl className="ticket-refund-policy" aria-label="예매 취소 환불 정책">
          <div><dt>취소 범위</dt><dd>예매 전체</dd></div>
          <div><dt>취소 수수료</dt><dd>{krw(order.cancellationRequest?.feeAmount ?? 0)}</dd></div>
          <div>
            <dt>환불 금액</dt>
            <dd>{hasKnownPayment ? `${krw(order.cancellationRequest?.refundAmount ?? order.total)} 전액 환불` : '결제 내역 없음 · 결제된 금액 전액'}</dd>
          </div>
        </dl>
      )}

      {presentation.canCancel && (
        <div className="ticket-cancellation-actions" aria-live="polite" aria-atomic="true">
          {submission === 'confirming' ? (
            <div aria-labelledby="ticket-cancellation-confirm-heading" aria-modal="true" className="ticket-cancellation-confirm" role="dialog">
              <strong id="ticket-cancellation-confirm-heading">예매 전체를 취소할까요?</strong>
              <p>티켓 {order.qty}장을 모두 취소합니다. 일부 수량만 취소할 수는 없습니다.</p>
              <div>
                <button autoFocus className="btn btn-ghost" onClick={closeConfirmation} type="button">돌아가기</button>
                <button className="btn ticket-cancellation-submit" onClick={() => void cancelBooking()} type="button">{presentation.actionLabel}</button>
              </div>
            </div>
          ) : submission === 'submitting' ? (
            <p className="ticket-cancellation-feedback" role="status">취소 가능 여부와 결제 상태를 확인하고 있어요.</p>
          ) : submission === 'processing' ? (
            <p className="ticket-cancellation-feedback ticket-cancellation-feedback--success" role="status">취소 요청을 접수했습니다. 환불 결과를 확인하고 있어요.</p>
          ) : submission === 'success' ? (
            <p className="ticket-cancellation-feedback ticket-cancellation-feedback--success" role="status">예매 취소가 완료됐습니다. 최신 상태를 불러오고 있어요.</p>
          ) : (
            <>
              {submission === 'error' && (
                <p className="ticket-cancellation-feedback ticket-cancellation-feedback--error" role="alert">취소 요청을 처리하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.</p>
              )}
              <button
                autoFocus={submission === 'error'}
                className="btn btn-ghost ticket-cancellation-open"
                onClick={() => setSubmission('confirming')}
                ref={triggerRef}
                type="button"
              >
                {presentation.actionLabel}
              </button>
            </>
          )}
        </div>
      )}

      {hasReconcileRequest && (
        <div className="ticket-cancellation-actions" aria-live="polite" aria-atomic="true">
          {submission === 'submitting' ? (
            <p className="ticket-cancellation-feedback" role="status">환불 상태를 다시 확인하고 있어요.</p>
          ) : submission === 'processing' ? (
            <>
              <p className="ticket-cancellation-feedback ticket-cancellation-feedback--success" role="status">재확인을 요청했습니다. 환불 결과를 확인하고 있어요.</p>
              {retryAvailable && (
                <button
                  className="btn btn-ghost ticket-cancellation-open"
                  onClick={() => void cancelBooking()}
                  type="button"
                >
                  환불 상태 다시 확인
                </button>
              )}
            </>
          ) : submission === 'success' ? (
            <p className="ticket-cancellation-feedback ticket-cancellation-feedback--success" role="status">취소·환불이 완료됐습니다. 최신 상태를 불러오고 있어요.</p>
          ) : (
            <>
              {submission === 'error' && (
                <p className="ticket-cancellation-feedback ticket-cancellation-feedback--error" role="alert">환불 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.</p>
              )}
              <button
                autoFocus={submission === 'error'}
                className="btn btn-ghost ticket-cancellation-open"
                onClick={() => void cancelBooking()}
                type="button"
              >
                환불 상태 다시 확인
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
