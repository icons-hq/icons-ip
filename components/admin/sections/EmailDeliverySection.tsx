'use client';

import { useActionState } from 'react';
import { RotateCw } from 'lucide-react';
import { resendOrderEmailAction, type AdminOrderActionState } from '@/app/admin/order-actions';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { AdminPageHeader } from '../console/AdminKit';
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

function ResendForm({ delivery }: { delivery: EmailDeliveryRecord }) {
  const [state, action, pending] = useActionState(resendOrderEmailAction, EMPTY_ACTION_STATE);

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <input name="dedupeKey" type="hidden" value={delivery.dedupeKey} />
      <Button disabled={pending} size="sm" type="submit">
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
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <AdminPageHeader
        title="메일 발송 이력"
        description="주문 확인·배송 시작·문의 답변 메일의 발송 이력입니다. 주문 확인 메일은 전자상거래법상 계약내용에 관한 서면이라 실패한 건은 반드시 다시 보내야 합니다. 이미 발송된 건은 다시 보내도 중복 발송되지 않습니다."
      />

      {/* 발송 이력 목록 카드(콘솔 목록 카드) — 한 건이 한 줄이고, 빈 목록도 카드 안에 보인다. */}
      <ConsoleListCard aria-label="메일 발송 이력 목록">
      {!deliveries.length ? (
        <div className="py-10 text-center" role="status">
          <p className="text-sm font-medium">다시 보낼 메일이 없습니다.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">실패했거나 결과를 확인하지 못한 발송이 생기면 여기에 쌓입니다.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y">
          {deliveries.map((delivery) => (
            <li className="flex min-w-0 flex-col gap-4 py-4 text-sm first:pt-0 last:pb-0" key={delivery.dedupeKey}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className="text-base leading-snug font-medium text-foreground">{delivery.templateLabel}</strong>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={delivery.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(delivery.status)}</Badge>
                  <span className="tabular-nums">{delivery.attemptCount}회 시도</span>
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm break-words">{delivery.subject}</span>
                <span className="text-xs break-all text-muted-foreground">
                  받는 사람 {delivery.recipient} · 마지막 시도 {formatAttemptedAt(delivery.claimedAt)}
                </span>
                {delivery.orderId ? (
                  <span className="text-xs break-all text-muted-foreground tabular-nums">
                    주문 {delivery.orderId}
                  </span>
                ) : null}
                {delivery.lastError ? (
                  <span className="text-xs break-words text-destructive">
                    실패 사유: {delivery.lastError}
                  </span>
                ) : null}
              </div>
              {delivery.resendable ? (
                <ResendForm delivery={delivery} />
              ) : (
                /* 문의 답변 메일은 주문 상태로 사실성을 판정할 수 없어 게이트가 거절한다.
                   재발송 경로는 운영자가 문의 상세에서 답변을 다시 등록하는 것이다. */
                <span className="text-sm text-muted-foreground">
                  이 메일은 발송 이력에서 다시 보낼 수 없습니다. 1:1 문의 화면에서 답변을 다시 등록해주세요.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      </ConsoleListCard>
    </section>
  );
}
