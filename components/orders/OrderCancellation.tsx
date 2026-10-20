'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  formatOrderDateTime,
  LEGAL_WITHDRAWAL_NOTICE,
  ORDER_WITHDRAWAL_DEADLINE_LABELS,
  ORDER_WITHDRAWAL_REASON_LABELS,
  refundStatusLabel,
  type OrderCancellationRequestSummary,
  type OrderDetailStatus,
  type OrderRefundSummary,
  type OrderWithdrawalReasonType,
} from '../../lib/orders';
import { orderClaimAvailability, type OrderClaimEligibility } from '@/lib/orders/claims';

export { LEGAL_WITHDRAWAL_NOTICE };
export const CANCELLATION_FAILURE_MESSAGE = '취소 요청을 처리하지 못했습니다. 주문 상태를 새로 확인한 뒤 다시 시도해주세요.';
const REFUND_TIMING_NOTICE = '결제 취소가 처리되어도 결제수단에 따라 환불 반영 시점이 다를 수 있습니다.';

type CancellationFetch = (
  input: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<Pick<Response, 'ok' | 'json'>>;

// 청약철회 기한은 사유에 따라 다르다(#189). 기한 판정 자체는 RPC가 하고 여기서는
// 사유만 전달한다. 값과 기한 문구는 어드민 콘솔과 공유한다(#196) — 다만 고객에게는
// 사유와 기한을 한 줄로 붙여 보여준다.
export const WITHDRAWAL_REASON_LABELS: Record<OrderWithdrawalReasonType, string> = {
  change_of_mind: `${ORDER_WITHDRAWAL_REASON_LABELS.change_of_mind} (${ORDER_WITHDRAWAL_DEADLINE_LABELS.change_of_mind})`,
  defect: `${ORDER_WITHDRAWAL_REASON_LABELS.defect} (${ORDER_WITHDRAWAL_DEADLINE_LABELS.defect})`,
};

export const DEADLINE_EXPIRED_MESSAGE = '청약철회 기한이 지난 주문입니다. 하자나 오배송이라면 고객센터로 문의해주세요.';
export const CANCELLATION_BLOCKED_MESSAGE = '주문 상태가 변경되어 취소를 신청할 수 없습니다. 취소는 발주확인 전, 반품은 배송 중부터 주문 전체를 직접 신청할 수 있습니다. 그 밖의 청약철회 의사표시는 1:1 문의로 알려주세요.';

type CancellationSubmissionResult =
  | 'requested'
  | 'canceled'
  | 'already_canceled'
  | 'deadline_expired'
  | 'not_cancelable'
  | false;

export async function submitOrderCancellation(
  orderId: string,
  reasonType: OrderWithdrawalReasonType,
  fetcher: CancellationFetch = fetch,
): Promise<CancellationSubmissionResult> {
  const response = await fetcher(`/api/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reasonType }),
  });
  if (!response.ok) {
    // 신청 조건의 변화는 재시도 안내 대신 사유를 알려야 한다.
    const failure: unknown = await response.json().catch(() => null);
    const code = (failure as { error?: { code?: unknown } } | null)?.error?.code;
    return code === 'deadline_expired' || code === 'not_cancelable' ? code : false;
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return false;
  const status = (body as { status?: unknown }).status;
  return status === 'requested' || status === 'canceled' || status === 'already_canceled'
    ? status
    : false;
}

interface CancellationBasePresentation {
  canCancel: boolean;
  heading: string;
  body: string;
  requestLabel?: string;
  requestRequestedAt?: string;
  requestDecidedAt?: string;
}

type CancellationPresentation =
  | (CancellationBasePresentation & {
      canCancel: true;
      actionLabel: string;
      confirmTitle: string;
      confirmBody: string;
    })
  | (CancellationBasePresentation & {
      canCancel: false;
      refundLabel?: string;
      refundCreatedAt?: string;
    });

function requestPresentation(
  request: OrderCancellationRequestSummary,
  orderStatus: OrderDetailStatus,
  refund: OrderRefundSummary | null,
): CancellationPresentation {
  switch (request.status) {
    case 'requested':
      /* 결제가 끝나기 전에 접수된 취소는 담당자가 아니라 결제 결과가 닫는다 — 승인되면
         자동 승인 후 결제 취소, 승인되지 않거나 결제 기한이 지나면 결제 없이 취소된다.
         "담당자가 검토 중"이라고 하면 일어나지 않을 일을 기다리게 된다(2026-10-12 QA-7). */
      if (orderStatus === 'pending') {
        return {
          canCancel: false,
          heading: '주문 취소 요청 접수',
          body: '결제 결과를 확인한 뒤 주문 취소를 마무리합니다. 결제가 완료되지 않으면 결제 기한이 지난 뒤 자동으로 취소되고 알림을 보내드려요.',
          requestLabel: '결제 확인 대기',
          requestRequestedAt: request.requestedAt,
        };
      }
      return {
        canCancel: false,
        heading: '청약철회 요청 접수',
        body: '요청을 접수했고 담당자가 검토 중입니다.',
        requestLabel: '검토 대기',
        requestRequestedAt: request.requestedAt,
      };
    case 'processing':
      return {
        canCancel: false,
        heading: '결제 취소 처리 중',
        body: '청약철회가 승인되어 결제 취소를 처리 중입니다.',
        requestLabel: '취소 처리 중',
        requestRequestedAt: request.requestedAt,
      };
    case 'needs_review':
      return {
        canCancel: false,
        heading: '결제 취소 확인 중',
        body: '결제 취소 결과를 안전하게 확인 중입니다. 중복 처리는 진행하지 않습니다.',
        requestLabel: '수동 확인 중',
        requestRequestedAt: request.requestedAt,
      };
    case 'rejected':
      return {
        canCancel: false,
        heading: '청약철회 요청 결과',
        body: `${request.decisionNote ? `${request.decisionNote} ` : ''}자세한 내용은 고객센터에서 확인해주세요.`,
        requestLabel: '요청 거절',
        requestRequestedAt: request.requestedAt,
        ...(request.decidedAt ? { requestDecidedAt: request.decidedAt } : {}),
      };
    case 'completed':
      /* 환불 원장이 없는 완료는 결제된 금액 없이 닫힌 취소다 — 결제 대기 주문의 즉시 취소,
         결제 기한·승인 거절로 결제 없이 닫힌 요청. "결제 취소 처리가 완료"라고 하면 없던
         결제를 취소했다고 말하게 된다(2026-10-12 브라우저 QA R2-3). */
      if (!refund) {
        return {
          canCancel: false,
          heading: '주문 취소 완료',
          body: '주문 취소가 완료됐습니다. 결제된 금액이 없어 결제 취소나 환불은 없습니다.',
          requestLabel: '처리 완료',
          requestRequestedAt: request.requestedAt,
          ...(request.decidedAt ? { requestDecidedAt: request.decidedAt } : {}),
        };
      }
      return {
        canCancel: false,
        heading: '취소·환불 처리 완료',
        body: '청약철회와 결제 취소 처리가 완료됐습니다.',
        requestLabel: '처리 완료',
        requestRequestedAt: request.requestedAt,
        ...(request.decidedAt ? { requestDecidedAt: request.decidedAt } : {}),
      };
  }
}

export function cancellationPresentation(
  status: OrderDetailStatus,
  refund: OrderRefundSummary | null,
  cancellationRequest: OrderCancellationRequestSummary | null = null,
  options: { deliveredAt?: string | null; at?: Date; eligibility?: OrderClaimEligibility | null } = {},
): CancellationPresentation {
  if (refund?.status === 'awaiting_transfer') {
    return {
      canCancel: false,
      heading: '환불 송금 대기',
      body: '주문은 취소됐으며 결제자 계좌로 환불 송금을 준비하고 있습니다. 실제 송금이 확인되면 환불 완료로 표시됩니다.',
      refundLabel: refundStatusLabel(refund.status), refundCreatedAt: refund.createdAt,
      ...(cancellationRequest ? { requestLabel: '송금 대기', requestRequestedAt: cancellationRequest.requestedAt } : {}),
    };
  }
  if (cancellationRequest && cancellationRequest.status !== 'rejected') {
    return requestPresentation(cancellationRequest, status, refund);
  }
  const priorClosedRequest = cancellationRequest?.status === 'rejected'
    ? cancellationRequest
    : null;

  const closedLabel = priorClosedRequest?.stage === 'withdrawn' ? '이전 요청 철회' : '이전 요청 거절';
  const closedNotice = priorClosedRequest?.stage === 'withdrawn' ? '고객 요청으로 이전 요청을 철회했습니다.' : '이전 취소 요청이 거절됐습니다.';
  const available = orderClaimAvailability({ orderStatus: status, hasActiveClaim: false,
    eligibility: options.eligibility }).find((entry) => entry.claimType === 'cancel')?.available;
  if (status !== 'canceled' && !available) {
    const statusBlocksCancellation = status !== 'pending' && status !== 'paid';
    return {
      canCancel: false,
      heading: '주문 취소 신청 안내',
      body: statusBlocksCancellation || options.eligibility
        ? '주문 취소는 발주확인 전에만 직접 신청할 수 있습니다. 배송 중부터 아래에서 주문 전체 반품을 신청할 수 있습니다. 그 밖의 청약철회 의사표시는 1:1 문의 또는 고객센터로 알려주세요.'
        : '신청 가능 여부를 확인할 수 없습니다. 주문을 새로고침하거나 1:1 문의로 알려주세요.',
      ...(priorClosedRequest ? { requestLabel: closedLabel, requestRequestedAt: priorClosedRequest.requestedAt,
        ...(priorClosedRequest.decidedAt ? { requestDecidedAt: priorClosedRequest.decidedAt } : {}) } : {}),
    };
  }

  if (status === 'pending') {
    return {
      canCancel: true,
      heading: priorClosedRequest ? '주문 취소 재요청' : '결제 대기 주문 취소',
      body: priorClosedRequest
        ? `${closedNotice} ${priorClosedRequest.decisionNote ? `${priorClosedRequest.decisionNote} ` : ''}주문 상태가 바뀌지 않았다면 다시 요청할 수 있습니다.`
        : '결제 내역이 없는 주문은 바로 취소됩니다. 결제 가능 시간이 남은 결제가 있으면 결제 결과를 확인한 뒤 취소를 마무리합니다.',
      actionLabel: priorClosedRequest ? '다시 주문 취소 요청' : '주문 취소',
      confirmTitle: '이 주문을 취소할까요?',
      confirmBody: '결제 내역이 없으면 바로 취소하고, 결제 가능 시간이 남은 결제가 있으면 결제 결과를 확인한 뒤 마무리합니다.',
      ...(priorClosedRequest ? {
        requestLabel: closedLabel,
        requestRequestedAt: priorClosedRequest.requestedAt,
        ...(priorClosedRequest.decidedAt ? { requestDecidedAt: priorClosedRequest.decidedAt } : {}),
      } : {}),
    };
  }

  if (['confirmed', 'shipping', 'delivered', 'done'].includes(status) && available) return { canCancel: true, heading: '주문 취소 검토 요청', body: '담당자가 주문제작·전달·디지털 파일 제공 상황과 요청 사유를 확인한 뒤 안내합니다.', actionLabel: '취소 검토 요청', confirmTitle: '주문 취소 검토를 요청할까요?', confirmBody: '주문 전체 취소 요청을 접수합니다. 제작 또는 파일 제공을 시작했더라도 자동 거절하지 않으며 담당자가 검토합니다.' };

  if (status === 'paid') {
    return {
      canCancel: true,
      heading: priorClosedRequest ? '청약철회 재요청' : '청약철회 요청',
      body: priorClosedRequest
        ? `${closedNotice} ${priorClosedRequest.decisionNote ? `${priorClosedRequest.decisionNote} ` : ''}주문 상태가 바뀌지 않았다면 다시 요청할 수 있습니다.`
        : '발주확인 전 주문입니다. 주문 취소와 결제 취소를 함께 요청합니다.',
      actionLabel: priorClosedRequest ? '다시 청약철회 요청' : '청약철회 요청',
      confirmTitle: '청약철회를 요청할까요?',
      confirmBody: '주문과 결제 취소 처리를 요청합니다.',
      ...(priorClosedRequest ? {
        requestLabel: closedLabel,
        requestRequestedAt: priorClosedRequest.requestedAt,
        ...(priorClosedRequest.decidedAt ? { requestDecidedAt: priorClosedRequest.decidedAt } : {}),
      } : {}),
    };
  }

  return {
    canCancel: false,
    heading: '취소·환불 상태',
    body: refund
      ? '주문은 취소됐고 환불 상태를 확인할 수 있어요.'
      : '주문이 취소됐습니다. 결제 내역이 있었다면 결제수단의 취소 반영 시점을 확인해주세요.',
    ...(refund
      ? { refundLabel: refundStatusLabel(refund.status), refundCreatedAt: refund.createdAt }
      : {}),
  };
}

interface OrderCancellationProps {
  orderId: string;
  status: OrderDetailStatus;
  refund: OrderRefundSummary | null;
  cancellationRequest: OrderCancellationRequestSummary | null;
  eligibility: OrderClaimEligibility | null;
  /** 기존 요청의 배송 시각. 직접 취소 허용 여부는 eligibility를 따른다. */
  deliveredAt: string | null;
}

type SubmissionState =
  | 'idle'
  | 'confirming'
  | 'submitting'
  | 'requested'
  | 'success'
  | 'expired'
  | 'blocked'
  | 'error';

export function OrderCancellation({
  cancellationRequest,
  eligibility,
  deliveredAt,
  orderId,
  status,
  refund,
}: OrderCancellationProps) {
  const router = useRouter();
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const presentation = cancellationPresentation(status, refund, cancellationRequest, { deliveredAt, eligibility });

  useEffect(() => {
    if (submission !== 'idle' || !shouldRestoreFocus.current) return;
    shouldRestoreFocus.current = false;
    openButtonRef.current?.focus();
  }, [submission]);

  function closeConfirmation() {
    shouldRestoreFocus.current = true;
    setSubmission('idle');
  }

  async function cancelOrder() {
    setSubmission('submitting');

    let result: CancellationSubmissionResult = false;
    try {
      result = await submitOrderCancellation(orderId, 'change_of_mind');
    } catch {
      result = false;
    }

    if (!result) {
      setSubmission('error');
      router.refresh();
      return;
    }

    if (result === 'deadline_expired') {
      setSubmission('expired');
      router.refresh();
      return;
    }

    if (result === 'not_cancelable') {
      setSubmission('blocked');
      router.refresh();
      return;
    }

    setSubmission(result === 'requested' ? 'requested' : 'success');
    router.refresh();
  }

  return (
    <section className="order-cancellation" aria-labelledby="order-cancellation-heading">
      <div className="order-cancellation-heading">
        <span className="checkout-step mono">CANCELLATION</span>
        <h2 id="order-cancellation-heading">{presentation.heading}</h2>
      </div>
      <p className="order-cancellation-body">{presentation.body}</p>

      {presentation.requestLabel && (
        <dl className="order-refund-summary" aria-label="청약철회 요청 상태">
          <div><dt>상태</dt><dd>{presentation.requestLabel}</dd></div>
          {presentation.requestRequestedAt && (
            <div><dt>요청 시각</dt><dd><time dateTime={presentation.requestRequestedAt}>{formatOrderDateTime(presentation.requestRequestedAt)}</time></dd></div>
          )}
          {presentation.requestDecidedAt && (
            <div><dt>승인·결정 시각</dt><dd><time dateTime={presentation.requestDecidedAt}>{formatOrderDateTime(presentation.requestDecidedAt)}</time></dd></div>
          )}
        </dl>
      )}

      {presentation.canCancel ? (
        <div className="order-cancellation-actions" aria-live="polite" aria-atomic="true">
          {submission === 'confirming' ? (
            <div className="order-cancellation-confirm">
              <strong>{presentation.confirmTitle}</strong>
              <p>{presentation.confirmBody}</p>
              <div>
                <button autoFocus className="btn btn-ghost" type="button" onClick={closeConfirmation}>돌아가기</button>
                <button className="btn order-cancellation-submit" type="button" onClick={() => void cancelOrder()}>{presentation.actionLabel}</button>
              </div>
            </div>
          ) : submission === 'submitting' ? (
            <p className="order-cancellation-feedback" role="status">취소 요청을 처리하고 있어요.</p>
          ) : submission === 'success' ? (
            <p className="order-cancellation-feedback order-cancellation-feedback--success" role="status">주문 취소 처리를 완료했습니다. 최신 상태를 불러오고 있어요.</p>
          ) : submission === 'requested' ? (
            <p className="order-cancellation-feedback order-cancellation-feedback--success" role="status">{status === 'pending' ? '주문 취소 요청' : '청약철회 요청'}을 접수했습니다. 최신 상태를 불러오고 있어요.</p>
          ) : submission === 'expired' ? (
            <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">{DEADLINE_EXPIRED_MESSAGE}</p>
          ) : submission === 'blocked' ? (
            <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">{CANCELLATION_BLOCKED_MESSAGE}</p>
          ) : (
            <>
              {submission === 'error' && <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">{CANCELLATION_FAILURE_MESSAGE}</p>}
              <button ref={openButtonRef} autoFocus={submission === 'error'} className="btn btn-ghost order-cancellation-open" type="button" onClick={() => setSubmission('confirming')}>{presentation.actionLabel}</button>
            </>
          )}
        </div>
      ) : 'refundLabel' in presentation && presentation.refundLabel ? (
        <dl className="order-refund-summary" aria-label="환불 처리 상태">
          <div><dt>상태</dt><dd>{presentation.refundLabel}</dd></div>
          {presentation.refundCreatedAt && (
            <div>
              <dt>요청 시각</dt>
              <dd><time dateTime={presentation.refundCreatedAt}>{formatOrderDateTime(presentation.refundCreatedAt)}</time></dd>
            </div>
          )}
        </dl>
      ) : null}

      <div className="order-cancellation-notice">
        <h3>청약철회 안내</h3>
        <p className="money-caption">{LEGAL_WITHDRAWAL_NOTICE}</p>
        <p className="money-caption">{REFUND_TIMING_NOTICE}</p>
      </div>
    </section>
  );
}
