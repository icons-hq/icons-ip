'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  formatOrderDateTime,
  ORDER_WITHDRAWAL_REASON_LABELS,
  ORDER_WITHDRAWAL_REASON_TYPES,
  type OrderCancellationRequestSummary,
  type OrderDetailStatus,
  type OrderWithdrawalReasonType,
} from '@/lib/orders';
import {
  ORDER_CLAIM_INTAKE_NOTICES,
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_TYPE_LABELS,
  normalizeRefundAccount,
  orderClaimAvailability,
  orderClaimReferenceLabel,
  type OrderClaimType,
} from '@/lib/orders/claims';

/*
 * 반품·교환 접수와 클레임 진행 상태(#252).
 *
 * 취소(청약철회)는 기존 `OrderCancellation`이 계속 담당한다. 이 컴포넌트는 배송이
 * 끝난 뒤에만 열리는 두 유형을 받고, 유형과 무관하게 진행 중인 클레임의 단계를
 * 보여준다.
 *
 * 진행 안내는 반드시 `stage`에서 나온다. `status`는 레거시 투영이라 수거 중인
 * 반품도 `requested`로 보이고, 그 값으로 문구를 고르면 이미 굿즈를 반송한 구매자가
 * "아직 접수만 됐다"고 읽는다.
 */

export const CLAIM_FAILURE_MESSAGE = '요청을 접수하지 못했습니다. 주문 상태를 새로 확인한 뒤 다시 시도해주세요.';
export const CLAIM_DEADLINE_MESSAGE = '신청 기한이 지난 주문입니다. 하자나 오배송이라면 1:1 문의로 알려주세요.';
export const CLAIM_NOT_AVAILABLE_MESSAGE = '지금은 신청할 수 없는 주문입니다. 최신 상태를 확인해주세요.';

type ClaimFetch = (
  input: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<Pick<Response, 'ok' | 'json'>>;

type ClaimSubmissionResult =
  | 'requested'
  | 'auto_approved'
  | 'canceled'
  | 'already_canceled'
  | 'deadline_expired'
  | 'not_claimable'
  | false;

export async function submitOrderClaim(
  orderId: string,
  input: {
    claimType: OrderClaimType;
    reasonType: OrderWithdrawalReasonType;
    bankName?: string;
    accountNumber?: string;
    accountHolder?: string;
  },
  fetcher: ClaimFetch = fetch,
): Promise<ClaimSubmissionResult> {
  const response = await fetcher(`/api/orders/${orderId}/claims`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    /* 기한 초과와 접수 불가는 실패가 아니라 결과다. 재시도 안내 대신 사유를 말한다. */
    const failure: unknown = await response.json().catch(() => null);
    const code = (failure as { error?: { code?: unknown } } | null)?.error?.code;
    if (code === 'deadline_expired') return 'deadline_expired';
    if (code === 'not_claimable') return 'not_claimable';
    return false;
  }

  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') return false;
  const status = (body as { status?: unknown }).status;
  return status === 'requested'
    || status === 'auto_approved'
    || status === 'canceled'
    || status === 'already_canceled'
    ? status
    : false;
}

/** 단계별 구매자 안내. 유형에 따라 다음에 할 일이 다르다. */
export function claimStageNotice(claim: OrderCancellationRequestSummary): string {
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claim.claimType];
  switch (claim.stage) {
    case 'requested':
      return `${typeLabel} 요청을 접수했습니다. 담당자가 확인한 뒤 다음 단계를 안내합니다.`;
    case 'in_review':
      return `${typeLabel} 요청을 검토하고 있습니다.`;
    case 'collecting':
      return '요청이 승인됐습니다. 안내받은 방법으로 굿즈를 반송해주세요.';
    case 'collected':
      return claim.claimType === 'exchange'
        ? '반송하신 굿즈가 입고됐습니다. 교환 상품 재출고를 준비하고 있습니다.'
        : '반송하신 굿즈가 입고됐습니다. 영업일 기준 3일 이내에 환급 절차를 진행합니다.';
    case 'on_hold':
      /* 보류 사유는 hold_reason이고 그 칸은 구매자에게 grant하지 않는다(운영 메모).
         decisionNote는 승인 시 비워지므로 여기서 읽으면 언제나 fallback만 나갔다.
         사유는 보류 시점의 알림 본문으로 이미 전달된다. */
      return '처리가 보류됐습니다. 보류 사유는 알림으로 안내해드렸습니다. 추가로 궁금한 점은 1:1 문의로 알려주세요.';
    case 'processing':
      return '환급 절차를 진행하고 있습니다. 결제수단에 따라 반영 시점이 다를 수 있습니다.';
    case 'needs_review':
      return '결제 취소 결과를 안전하게 확인하고 있습니다. 중복 처리는 진행하지 않습니다.';
    case 'completed':
      return claim.claimType === 'exchange'
        ? '교환 상품을 재출고했습니다.'
        : '환급 처리가 완료됐습니다.';
    case 'rejected':
      return `요청이 거절됐습니다. ${claim.decisionNote ?? '자세한 내용은 1:1 문의로 확인해주세요.'}`;
  }
}

type SubmissionState = 'idle' | 'form' | 'submitting' | 'done' | 'expired' | 'blocked' | 'error';

export function OrderClaimRequest({
  claim,
  orderId,
  status,
}: {
  claim: OrderCancellationRequestSummary | null;
  orderId: string;
  status: OrderDetailStatus;
}) {
  const router = useRouter();
  const [submission, setSubmission] = useState<SubmissionState>('idle');
  const [claimType, setClaimType] = useState<OrderClaimType>('return');
  const [reasonType, setReasonType] = useState<OrderWithdrawalReasonType>('change_of_mind');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);

  const activeClaim = claim && claim.stage !== 'rejected' && claim.stage !== 'completed'
    ? claim
    : null;
  /* 접수 가능 판정은 lib/orders/claims.ts 하나만 본다. 화면이 자기 규칙을 따로
     들고 있으면 DB가 거절하는 요청에 버튼이 열려 있게 된다. */
  const availability = orderClaimAvailability({
    hasActiveClaim: Boolean(activeClaim),
    orderStatus: status,
  });
  const canRequest = availability
    .some((entry) => entry.claimType === claimType && entry.available);
  const blockedReason = availability
    .find((entry) => entry.claimType === 'return')?.blockedReason ?? null;

  async function submit() {
    const account = normalizeRefundAccount({ accountHolder, accountNumber, bankName });
    if (!account.ok) {
      setAccountError(account.error);
      return;
    }
    /* 반품은 환불로 끝난다. 계좌를 받아 두면 카드 접수가 막혔을 때 송금으로
       전환할 수 있고, 무통장 주문(#256)에서는 유일한 경로가 된다. */
    setAccountError(null);
    setSubmission('submitting');

    let result: ClaimSubmissionResult = false;
    try {
      result = await submitOrderClaim(orderId, {
        accountHolder: account.value?.accountHolder,
        accountNumber: account.value?.accountNumber,
        bankName: account.value?.bankName,
        claimType,
        reasonType,
      });
    } catch {
      result = false;
    }

    if (result === 'deadline_expired') setSubmission('expired');
    else if (result === 'not_claimable') setSubmission('blocked');
    else if (!result) setSubmission('error');
    else setSubmission('done');

    router.refresh();
  }

  return (
    <section aria-labelledby="order-claim-heading" className="order-cancellation">
      <div className="order-cancellation-heading">
        <span className="checkout-step mono">CLAIM</span>
        <h2 id="order-claim-heading">반품·교환 신청</h2>
      </div>

      {claim ? (
        <dl aria-label="클레임 진행 상태" className="order-refund-summary">
          <div>
            <dt>클레임번호</dt>
            <dd className="mono">{orderClaimReferenceLabel(claim.reference)}</dd>
          </div>
          <div>
            <dt>유형</dt>
            <dd>{ORDER_CLAIM_TYPE_LABELS[claim.claimType]}</dd>
          </div>
          <div>
            <dt>진행 상태</dt>
            <dd>{ORDER_CLAIM_STAGE_LABELS[claim.stage]}</dd>
          </div>
          <div>
            <dt>접수 시각</dt>
            <dd>
              <time dateTime={claim.requestedAt}>{formatOrderDateTime(claim.requestedAt)}</time>
            </dd>
          </div>
          {claim.reshipTrackingNumber ? (
            <div>
              <dt>재출고 운송장</dt>
              <dd className="mono">
                {claim.reshipCarrier} {claim.reshipTrackingNumber}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {claim ? <p className="order-cancellation-body">{claimStageNotice(claim)}</p> : null}

      {canRequest ? (
        submission === 'form' ? (
          <div className="order-cancellation-confirm">
            <fieldset className="order-cancellation-reason">
              <legend>신청 유형</legend>
              {(['return', 'exchange'] as const).map((value) => (
                <label key={value}>
                  <input
                    checked={claimType === value}
                    name="order-claim-type"
                    onChange={() => setClaimType(value)}
                    type="radio"
                    value={value}
                  />
                  {ORDER_CLAIM_TYPE_LABELS[value]}
                </label>
              ))}
            </fieldset>
            <p className="money-caption">{ORDER_CLAIM_INTAKE_NOTICES[claimType]}</p>

            <fieldset className="order-cancellation-reason">
              <legend>신청 사유</legend>
              {ORDER_WITHDRAWAL_REASON_TYPES.map((value) => (
                <label key={value}>
                  <input
                    checked={reasonType === value}
                    name="order-claim-reason-type"
                    onChange={() => setReasonType(value)}
                    type="radio"
                    value={value}
                  />
                  {ORDER_WITHDRAWAL_REASON_LABELS[value]}
                </label>
              ))}
            </fieldset>

            {claimType === 'return' ? (
              <fieldset className="order-cancellation-reason">
                <legend>환불계좌 (선택)</legend>
                <p className="money-caption">
                  결제수단으로 환급하지 못하는 경우에만 사용합니다. 입력하신 계좌는 마스킹해
                  보관하고, 환급 완료 30일 뒤 원문을 파기합니다.
                </p>
                <label htmlFor="order-claim-bank">
                  <span>은행</span>
                  <input
                    id="order-claim-bank"
                    maxLength={40}
                    onChange={(event) => setBankName(event.target.value)}
                    type="text"
                    value={bankName}
                  />
                </label>
                <label htmlFor="order-claim-account">
                  <span>계좌번호</span>
                  <input
                    id="order-claim-account"
                    inputMode="numeric"
                    maxLength={30}
                    onChange={(event) => setAccountNumber(event.target.value)}
                    type="text"
                    value={accountNumber}
                  />
                </label>
                <label htmlFor="order-claim-holder">
                  <span>예금주</span>
                  <input
                    id="order-claim-holder"
                    maxLength={40}
                    onChange={(event) => setAccountHolder(event.target.value)}
                    type="text"
                    value={accountHolder}
                  />
                </label>
                {accountError ? (
                  <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">
                    {accountError}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            <div>
              <button className="btn btn-ghost" onClick={() => setSubmission('idle')} type="button">
                돌아가기
              </button>
              <button
                className="btn order-cancellation-submit"
                onClick={() => void submit()}
                type="button"
              >
                {ORDER_CLAIM_TYPE_LABELS[claimType]} 신청
              </button>
            </div>
          </div>
        ) : (
          <div aria-atomic="true" aria-live="polite" className="order-cancellation-actions">
            {submission === 'submitting' ? (
              <p className="order-cancellation-feedback" role="status">요청을 접수하고 있어요.</p>
            ) : submission === 'done' ? (
              <p className="order-cancellation-feedback order-cancellation-feedback--success" role="status">
                요청을 접수했습니다. 최신 상태를 불러오고 있어요.
              </p>
            ) : (
              <>
                {submission === 'expired' ? (
                  <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">
                    {CLAIM_DEADLINE_MESSAGE}
                  </p>
                ) : null}
                {submission === 'blocked' ? (
                  <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">
                    {CLAIM_NOT_AVAILABLE_MESSAGE}
                  </p>
                ) : null}
                {submission === 'error' ? (
                  <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">
                    {CLAIM_FAILURE_MESSAGE}
                  </p>
                ) : null}
                <button
                  className="btn btn-ghost order-cancellation-open"
                  onClick={() => setSubmission('form')}
                  type="button"
                >
                  반품·교환 신청
                </button>
              </>
            )}
          </div>
        )
      ) : (
        <p className="order-cancellation-body">
          {blockedReason ?? '반품·교환은 배송이 완료된 뒤에 신청할 수 있습니다.'}
        </p>
      )}
    </section>
  );
}
