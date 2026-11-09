'use client';

import { useActionState } from 'react';
import { RotateCw } from 'lucide-react';
import { resendOrderEmailAction, type AdminOrderActionState } from '@/app/admin/order-actions';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';
import { Button } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ADMIN_COUNT_CARD_GRID_CLASS, AdminCountCard } from '../console/AdminCountCard';
import { ConsoleListCard } from '../console/ConsoleListCard';

/* 트랜잭션 메일 발송 이력(#180 범위 5).
 *
 * 발송이 실패해도 주문은 확정된다(확정은 서버 confirm·reconcile과 DB 멱등
 * finalizer가 소유하고, 메일은 그 뒤의 부수효과다). 그래서 실패는
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

/*
 * 제목·받는 사람·실패 사유 원문은 개인정보 보호로 DB가 돌려주지 않는다(legacy_*·masked, 20260813240000).
 * 코드를 그대로 내보이지 않고, 값이 있을 때만 보인다. 메일 종류는 줄 제목(templateLabel)이 말한다.
 */
const isProtectedValue = (value: string) => value === 'masked' || value.startsWith('legacy_');

function failureReason(lastError: string) {
  return isProtectedValue(lastError) ? '상세 사유는 개인정보 보호로 저장하지 않습니다.' : lastError;
}

/** 다시 보낼 수 없는 이유 — 메일 종류마다 다르다. */
function notResendableReason(delivery: EmailDeliveryRecord) {
  if (delivery.template === 'inquiry_answered') {
    /* 문의 답변 메일은 주문 상태로 사실성을 판정할 수 없어 게이트가 거절한다. 재발송 경로는 답변을 다시 등록하는 것이다. */
    return '이 메일은 발송 이력에서 다시 보낼 수 없습니다. 1:1 문의 화면에서 답변을 다시 등록해주세요.';
  }
  if (delivery.template === 'restock_alert') return '재입고 알림 메일은 발송 이력에서 다시 보낼 수 없습니다.';
  /* 주문 메일인데 대상 주문을 키에서 되찾지 못한 기록. 엉뚱한 주문으로 보내지 않도록 버튼을 만들지 않는다. */
  return '이 기록은 대상 주문을 확인할 수 없어 발송 이력에서 다시 보낼 수 없습니다.';
}

function ResendForm({ delivery }: { delivery: EmailDeliveryRecord }) {
  const [state, action, pending] = useActionState(resendOrderEmailAction, EMPTY_ACTION_STATE);

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <input name="dedupeKey" type="hidden" value={delivery.dedupeKey} />
      <Button disabled={pending} size="sm" type="submit" variant="soft">
        <RotateCw aria-hidden="true" /> {pending ? '보내는 중' : '다시 보내기'}
      </Button>
      {state.errors?.form ? (
        <span className="text-sm text-destructive" role="alert">{state.errors.form}</span>
      ) : null}
      {state.message ? (
        <span className="text-sm text-muted-foreground" role="status">{state.message}</span>
      ) : null}
    </form>
  );
}

export function EmailDeliverySection({ deliveries }: { deliveries: EmailDeliveryRecord[] }) {
  const failed = deliveries.filter((delivery) => delivery.status === 'failed');
  const pending = deliveries.filter((delivery) => delivery.status === 'pending');
  /* 처리할 실패 건을 위로 — 같은 상태 안의 최신순은 서버가 정한 그대로다. */
  const ordered = [...failed, ...deliveries.filter((delivery) => delivery.status !== 'failed')];
  const failedConfirmation = failed.some((delivery) => delivery.template === 'order_confirmation');

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <AdminPageHeader
        title="메일 발송 이력"
        description="주문 확인·배송 시작·문의 답변 메일 중 발송에 실패했거나 결과를 확인하지 못한 건입니다. 이미 발송된 건은 다시 보내도 중복 발송되지 않습니다."
      />

      {deliveries.length ? (
        <div className="flex flex-col gap-1.5" data-email-delivery-summary="">
          <div className={ADMIN_COUNT_CARD_GRID_CLASS}>
            <AdminCountCard count={failed.length} label="발송 실패" tone="danger" />
            <AdminCountCard count={pending.length} label="발송 확인 중" tone="info" />
          </div>
          <p className="text-xs text-muted-foreground">최근 {deliveries.length.toLocaleString('ko-KR')}건 기준입니다. 실패한 건을 먼저 보여줍니다.</p>
        </div>
      ) : null}

      {failedConfirmation ? (
        <AdminNotice tone="warning" title="주문 확인 메일은 전자상거래법상 계약내용에 관한 서면입니다.">
          실패한 건은 줄의 다시 보내기로 다시 보내주세요.
        </AdminNotice>
      ) : null}

      {/* 발송 이력 목록 카드(콘솔 목록 카드) — 한 건이 한 줄이고, 빈 목록도 카드 안에 보인다. */}
      <ConsoleListCard aria-label="메일 발송 이력 목록">
      {!deliveries.length ? (
        <div className="py-10 text-center" role="status">
          <p className="text-sm font-medium">다시 보낼 메일이 없습니다.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">실패했거나 결과를 확인하지 못한 발송이 생기면 여기에 쌓입니다.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y">
          {ordered.map((delivery) => (
            <li className="flex min-w-0 flex-col gap-3 py-4 text-sm first:pt-0 last:pb-0" key={delivery.dedupeKey}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className="text-base leading-snug font-medium text-foreground">{delivery.templateLabel}</strong>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AdminStatusBadge tone={statusTone('emailDelivery', delivery.status)}>{statusLabel(delivery.status)}</AdminStatusBadge>
                  <span className="tabular-nums">{delivery.attemptCount}회 시도</span>
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                {isProtectedValue(delivery.subject) ? null : <span className="text-sm break-words">{delivery.subject}</span>}
                <span className="text-xs break-all text-muted-foreground tabular-nums">
                  {delivery.orderId ? <><span title={delivery.orderId}>주문 {delivery.orderId.slice(0, 8)}…</span> · </> : null}
                  {isProtectedValue(delivery.recipient) ? null : <>받는 사람 {delivery.recipient} · </>}
                  마지막 시도 {formatAttemptedAt(delivery.claimedAt)}
                </span>
                {delivery.lastError ? (
                  <span className="text-xs break-words text-destructive">
                    실패 사유: {failureReason(delivery.lastError)}
                  </span>
                ) : null}
              </div>
              {delivery.resendable ? (
                <ResendForm delivery={delivery} />
              ) : (
                <span className="text-sm text-muted-foreground">{notResendableReason(delivery)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      </ConsoleListCard>
    </section>
  );
}
