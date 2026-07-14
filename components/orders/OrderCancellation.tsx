'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  formatOrderDateTime,
  refundStatusLabel,
  type OrderCancellationRequestSummary,
  type OrderDetailStatus,
  type OrderRefundSummary,
} from '../../lib/orders';

export const LEGAL_WITHDRAWAL_NOTICE = '계약내용에 관한 서면을 받은 날부터 7일 이내 청약철회를 요청할 수 있습니다. 재화 공급이 더 늦으면 공급받거나 공급이 시작된 날부터 7일입니다. 상품 훼손·사용 등 법정 제한 사유가 있으면 제한될 수 있습니다.';
export const CANCELLATION_FAILURE_MESSAGE = '취소 요청을 처리하지 못했습니다. 주문 상태를 새로 확인한 뒤 다시 시도해주세요.';
const REFUND_TIMING_NOTICE = '결제 취소가 처리되어도 결제수단에 따라 환불 반영 시점이 다를 수 있습니다.';

type CancellationFetch = (
  input: string,
  init: { method: 'POST' },
) => Promise<Pick<Response, 'ok' | 'json'>>;

type CancellationSubmissionResult = 'requested' | 'canceled' | 'already_canceled' | false;

export async function submitOrderCancellation(
  orderId: string,
  fetcher: CancellationFetch = fetch,
): Promise<CancellationSubmissionResult> {
  const response = await fetcher(`/api/orders/${orderId}/cancel`, { method: 'POST' });
  if (!response.ok) return false;
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
  | (CancellationBasePresentation & { canCancel: true; actionLabel: string })
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
): CancellationPresentation {
  if (cancellationRequest && cancellationRequest.status !== 'rejected') {
    return requestPresentation(cancellationRequest);
  }
  const priorRejection = cancellationRequest?.status === 'rejected'
    ? cancellationRequest
    : null;

  if (status === 'pending') {
    return {
      canCancel: true,
      heading: priorRejection ? '주문 취소 재요청' : '결제 대기 주문 취소',
      body: priorRejection
        ? `이전 취소 요청이 거절됐습니다. ${priorRejection.decisionNote ? `${priorRejection.decisionNote} ` : ''}주문 상태가 바뀌지 않았다면 다시 요청할 수 있습니다.`
        : '결제 내역이 없는 주문은 즉시 취소됩니다. 결제 시도가 확인되면 청약철회 요청으로 접수해 안전하게 확인합니다.',
      actionLabel: priorRejection ? '다시 주문 취소 요청' : '주문 취소',
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
        : '배송 시작 전 주문입니다. 주문 취소와 결제 취소를 함께 요청합니다.',
      actionLabel: priorRejection ? '다시 청약철회 요청' : '청약철회 요청',
      ...(priorRejection ? {
        requestLabel: '이전 요청 거절',
        requestRequestedAt: priorRejection.requestedAt,
        ...(priorRejection.decidedAt ? { requestDecidedAt: priorRejection.decidedAt } : {}),
      } : {}),
    };
  }

  if (status === 'canceled') {
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

  return {
    canCancel: false,
    heading: '셀프 취소가 제한된 주문입니다',
    body: '배송이 시작됐거나 완료된 주문은 이 화면에서 취소할 수 없습니다. 고객센터에서 주문 상태와 처리 가능 여부를 확인해주세요.',
  };
}

interface OrderCancellationProps {
  orderId: string;
  status: OrderDetailStatus;
  refund: OrderRefundSummary | null;
  cancellationRequest: OrderCancellationRequestSummary | null;
}

type SubmissionState = 'idle' | 'confirming' | 'submitting' | 'requested' | 'success' | 'error';

export function OrderCancellation({ cancellationRequest, orderId, status, refund }: OrderCancellationProps) {
  const router = useRouter();
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const presentation = cancellationPresentation(status, refund, cancellationRequest);

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
      result = await submitOrderCancellation(orderId);
    } catch {
      result = false;
    }

    if (!result) {
      setSubmission('error');
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
              <strong>{status === 'pending' ? '이 주문을 취소할까요?' : '청약철회를 요청할까요?'}</strong>
              <p>{status === 'pending' ? '결제 내역이 없으면 즉시 취소하고, 내역이 있으면 청약철회 요청으로 접수합니다.' : '주문과 결제 취소 처리를 요청합니다.'}</p>
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
