'use client';

import { useActionState } from 'react';
import { resendOrderEmailAction, type AdminOrderActionState } from '@/app/admin/order-actions';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';

/* 트랜잭션 메일 발송 이력(#180 범위 5).
 *
 * 발송이 실패해도 주문은 확정된다(결제 확정의 진실원은 토스 웹훅이다). 그래서 실패는
 * 조용하다 — 이 화면이 없으면 구매자가 계약내용 서면을 못 받은 사실을 아무도 모른다.
 * 실패 목록을 보여주고 다시 보내는 것이 이 화면의 전부다. */

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

function formatAttemptedAt(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '시각 기록 없음' : dateTimeFormatter.format(new Date(parsed));
}

function statusLabel(status: EmailDeliveryRecord['status']) {
  if (status === 'failed') return '발송 실패';
  if (status === 'pending') return '발송 확인 중';
  return '발송 완료';
}

function ResendForm({ delivery }: { delivery: EmailDeliveryRecord }) {
  const [state, action, pending] = useActionState(resendOrderEmailAction, EMPTY_ACTION_STATE);

  return (
    <form action={action} className="col" style={{ gap: 6 }}>
      <input name="dedupeKey" type="hidden" value={delivery.dedupeKey} />
      <button className="btn btn-sm" disabled={pending} type="submit">
        {pending ? '보내는 중' : '다시 보내기'}
      </button>
      {state.errors?.form ? (
        <span role="alert" style={{ fontSize: 12 }}>{state.errors.form}</span>
      ) : null}
      {state.message ? (
        <span className="muted" role="status" style={{ fontSize: 12 }}>{state.message}</span>
      ) : null}
    </form>
  );
}

export function EmailDeliverySection({ deliveries }: { deliveries: EmailDeliveryRecord[] }) {
  return (
    <section className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        주문 확인·배송 시작·문의 답변 메일의 발송 이력입니다. 주문 확인 메일은 전자상거래법상
        계약내용에 관한 서면이라 실패한 건은 반드시 다시 보내야 합니다. 이미 발송된 건은 다시
        보내도 중복 발송되지 않습니다.
      </p>

      {!deliveries.length ? (
        <div className="card col" role="status" style={{ borderRadius: 10, gap: 6, padding: 18 }}>
          <strong>다시 보낼 메일이 없습니다.</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            실패했거나 결과를 확인하지 못한 발송이 생기면 여기에 쌓입니다.
          </span>
        </div>
      ) : (
        <ul className="col" style={{ gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
          {deliveries.map((delivery) => (
            <li
              className="card col"
              key={delivery.dedupeKey}
              style={{ borderRadius: 10, gap: 8, padding: 16 }}
            >
              <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                <strong>{delivery.templateLabel}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {statusLabel(delivery.status)} · {delivery.attemptCount}회 시도
                </span>
              </div>
              <span style={{ fontSize: 13 }}>{delivery.subject}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                받는 사람 {delivery.recipient} · 마지막 시도 {formatAttemptedAt(delivery.claimedAt)}
              </span>
              {delivery.orderId ? (
                <span className="muted mono" style={{ fontSize: 12 }}>
                  주문 {delivery.orderId}
                </span>
              ) : null}
              {delivery.lastError ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  실패 사유: {delivery.lastError}
                </span>
              ) : null}
              {delivery.resendable ? (
                <ResendForm delivery={delivery} />
              ) : (
                /* 문의 답변 메일은 주문 상태로 사실성을 판정할 수 없어 게이트가 거절한다.
                   재발송 경로는 운영자가 문의 상세에서 답변을 다시 등록하는 것이다. */
                <span className="muted" style={{ fontSize: 12 }}>
                  이 메일은 발송 이력에서 다시 보낼 수 없습니다. 1:1 문의 화면에서 답변을 다시 등록해주세요.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
