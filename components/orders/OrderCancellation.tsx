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
export const CANCELLATION_BLOCKED_MESSAGE = '주문 상태가 변경되어 취소를 신청할 수 없습니다. 취소는 발주확인 전, 반품은 주문의 모든 굿즈가 배송 완료된 뒤에 직접 신청할 수 있습니다. 그 밖의 청약철회 의사표시는 1:1 문의로 알려주세요.';

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

function requestPresentation(request: OrderCancellationRequestSummary): CancellationPresentation {
  switch (request.status) {
    case 'requested':
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
  if (cancellationRequest && cancellationRequest.status !== 'rejected') {
    return requestPresentation(cancellationRequest);
  }
  const priorRejection = cancellationRequest?.status === 'rejected'
    ? cancellationRequest
    : null;

  const available = orderClaimAvailability({ orderStatus: status, hasActiveClaim: false,
    eligibility: options.eligibility }).find((entry) => entry.claimType === 'cancel')?.available;
  if (status !== 'canceled' && !available) {
    const statusBlocksCancellation = status !== 'pending' && status !== 'paid';
    return {
      canCancel: false,
      heading: '주문 취소 신청 안내',
      body: statusBlocksCancellation || options.eligibility
        ? '주문 취소는 발주확인 전에만 직접 신청할 수 있습니다. 주문의 모든 굿즈가 배송 완료된 뒤에는 아래에서 반품을 신청해주세요. 그 밖의 청약철회 의사표시는 1:1 문의 또는 고객센터로 알려주세요.'
        : '신청 가능 여부를 확인할 수 없습니다. 주문을 새로고침하거나 1:1 문의로 알려주세요.',
      ...(priorRejection ? { requestLabel: '이전 요청 거절', requestRequestedAt: priorRejection.requestedAt,
        ...(priorRejection.decidedAt ? { requestDecidedAt: priorRejection.decidedAt } : {}) } : {}),
    };
  }

  if (status === 'pending') {
    return {
      canCancel: true,
      heading: priorRejection ? '주문 취소 재요청' : '결제 대기 주문 취소',
      body: priorRejection
        ? `이전 취소 요청이 거절됐습니다. ${priorRejection.decisionNote ? `${priorRejection.decisionNote} ` : ''}주문 상태가 바뀌지 않았다면 다시 요청할 수 있습니다.`
        : '결제 내역이 없는 주문은 즉시 취소됩니다. 결제 시도가 확인되면 청약철회 요청으로 접수해 안전하게 확인합니다.',
      actionLabel: priorRejection ? '다시 주문 취소 요청' : '주문 취소',
      confirmTitle: '이 주문을 취소할까요?',
      confirmBody: '결제 내역이 없으면 즉시 취소하고, 내역이 있으면 청약철회 요청으로 접수합니다.',
      ...(priorRejection ? {
        requestLabel: '이전 요청 거절',
        requestRequestedAt: priorRejection.requestedAt,
        ...(priorRejection.decidedAt ? { requestDecidedAt: priorRejection.decidedAt } : {}),
      } : {}),
    };
  }

  if (status === 'paid') {
    return {
      canCancel: true,
      heading: priorRejection ? '청약철회 재요청' : '청약철회 요청',
      body: priorRejection
        ? `이전 청약철회 요청이 거절됐습니다. ${priorRejection.decisionNote ? `${priorRejection.decisionNote} ` : ''}주문 상태가 바뀌지 않았다면 다시 요청할 수 있습니다.`
        : '발주확인 전 주문입니다. 주문 취소와 결제 취소를 함께 요청합니다.',
      actionLabel: priorRejection ? '다시 청약철회 요청' : '청약철회 요청',
      confirmTitle: '청약철회를 요청할까요?',
      confirmBody: '주문과 결제 취소 처리를 요청합니다.',
      ...(priorRejection ? {
        requestLabel: '이전 요청 거절',
        requestRequestedAt: priorRejection.requestedAt,
        ...(priorRejection.decidedAt ? { requestDecidedAt: priorRejection.decidedAt } : {}),
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
            <div><dt>처리 시각</dt><dd><time dateTime={presentation.requestDecidedAt}>{formatOrderDateTime(presentation.requestDecidedAt)}</time></dd></div>
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
            <p className="order-cancellation-feedback order-cancellation-feedback--success" role="status">청약철회 요청을 접수했습니다. 최신 상태를 불러오고 있어요.</p>
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
