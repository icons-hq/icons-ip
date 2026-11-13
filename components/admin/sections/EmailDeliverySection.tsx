'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ArrowRight, RotateCw } from 'lucide-react';
import { resendOrderEmailAction, type AdminOrderActionState } from '@/app/admin/order-actions';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';
import { Button } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { AdminCountCard } from '../console/AdminCountCard';
import { CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableHeader } from '../console/ConsoleListCard';

/* 트랜잭션 메일 발송 이력(#180 범위 5).
 *
 * 발송이 실패해도 주문은 확정된다(확정은 서버 confirm·reconcile과 DB 멱등
 * finalizer가 소유하고, 메일은 그 뒤의 부수효과다). 그래서 실패는
 * 조용하다 — 이 화면이 없으면 구매자가 계약내용 서면을 못 받은 사실을 아무도 모른다.
 * 실패 목록을 보여주고 다시 보내는 것이 이 화면의 전부다. */

const EMPTY_ACTION_STATE: AdminOrderActionState = {};

/* 다른 문의·주문 화면과 같은 날짜 표기(KST, 24시간제). */
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
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
 * 코드를 그대로 내보이지 않고, 값이 있을 때만 보인다. 제목이 없으면 그 메일이 무슨 안내인지로 칸을 채운다.
 */
const isProtectedValue = (value: string) => value === 'masked' || value.startsWith('legacy_');

const TEMPLATE_SUMMARY: Record<EmailDeliveryRecord['template'], string> = {
  order_confirmation: '주문 접수·계약내용 안내',
  order_shipped: '상품 발송 안내',
  inquiry_answered: '문의 답변 등록 안내',
  restock_alert: '재입고 안내',
};

/** 문의 답변 메일이 실패한 줄 — 버튼 없이 사람이 직접 처리할 일이 있는 유일한 경우다(재발송 경로는 답변을 다시 등록하는 것이다). */
const needsInquiryReply = (delivery: EmailDeliveryRecord) => !delivery.resendable && delivery.status === 'failed' && delivery.template === 'inquiry_answered';

/** 시도 뒤 이만큼 지나도 결과가 없으면 기다려도 오지 않는다(결과 기록이 끊긴 건). 다음 행동을 사람에게 넘긴다. */
const PENDING_STUCK_MS = 60 * 60 * 1000;

/** 다시 보낼 수 없는 이유 — 메일 종류마다 다르다. */
function notResendableReason(delivery: EmailDeliveryRecord, nowMs: number) {
  /* nowMs는 서버가 요청 시각을 넘긴다(렌더 중 시계를 읽지 않는다). 0이면 판단하지 않는다. */
  if (delivery.template === 'inquiry_answered') return nowMs > 0 && nowMs - new Date(delivery.claimedAt).getTime() > PENDING_STUCK_MS ? '결과가 오지 않았습니다. 고객에게 수신 여부를 확인해주세요' : '발송 결과를 확인하는 중입니다';
  if (delivery.template === 'restock_alert') return '재입고 알림 메일은 다시 보낼 수 없습니다';
  /* 주문 메일인데 대상 주문을 키에서 되찾지 못한 기록. 엉뚱한 주문으로 보내지 않도록 버튼을 만들지 않는다. */
  return '대상 주문을 확인할 수 없어 다시 보낼 수 없습니다';
}

function ResendForm({ delivery }: { delivery: EmailDeliveryRecord }) {
  const [state, action, pending] = useActionState(resendOrderEmailAction, EMPTY_ACTION_STATE);

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <input name="dedupeKey" type="hidden" value={delivery.dedupeKey} />
      <Button disabled={pending} size="sm" type="submit" variant={delivery.status === 'failed' ? 'soft' : 'outline'}>
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

/** 다음 행동 칸. 사람이 할 일이 있는 줄만 주의색으로 세우고, 할 수 있는 일이 없는 줄은 이유만 조용히 적는다 — 실패 건을 보고 뭘 할지 바로 잡히게. */
function NextAction({ delivery, nowMs }: { delivery: EmailDeliveryRecord; nowMs: number }) {
  if (delivery.resendable) return <ResendForm delivery={delivery} />;
  /* 대상 문의를 찾을 식별값(메시지 id뿐)이 없어 링크를 만들지 않는다 — 문구로만 안내한다. */
  if (needsInquiryReply(delivery)) {
    return (
      <span className="inline-flex items-start gap-1.5 font-semibold text-warning">
        <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />1:1 문의 화면에서 답변을 다시 등록해주세요
      </span>
    );
  }
  return <span className="text-muted-foreground">{notResendableReason(delivery, nowMs)}</span>;
}

export function EmailDeliverySection({ deliveries, nowMs = 0 }: { deliveries: EmailDeliveryRecord[]; nowMs?: number }) {
  const failed = deliveries.filter((delivery) => delivery.status === 'failed');
  const pending = deliveries.filter((delivery) => delivery.status === 'pending');
  /* 처리할 실패 건을 위로 — 같은 상태 안의 최신순은 서버가 정한 그대로다. */
  const ordered = [...failed, ...deliveries.filter((delivery) => delivery.status !== 'failed')];
  const resendableFailed = failed.filter((delivery) => delivery.resendable);
  const failedConfirmation = resendableFailed.some((delivery) => delivery.template === 'order_confirmation');
  /* 줄마다 되풀이하던 안내는 표 위에 한 번만 둔다. 해당하는 기록이 있을 때만 말한다. */
  const redactedReason = deliveries.some((delivery) => delivery.lastError !== null && isProtectedValue(delivery.lastError));
  const detachedRecord = deliveries.some((delivery) => !delivery.orderId && isProtectedValue(delivery.recipient));

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <AdminPageHeader
        title="메일 발송 이력"
        description="발송에 실패했거나 결과를 확인하지 못한 메일입니다. 이미 발송된 건은 다시 보내도 중복으로 가지 않습니다."
      />

      {deliveries.length ? (
        /* 세 칸이 화면을 나눠 가져 긴 이름도 잘리지 않는다(좁은 화면에서는 긴 이름의 마지막 카드만 한 줄을 쓴다). */
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 max-sm:[&>:last-child]:col-span-2" data-email-delivery-summary="">
          <AdminCountCard count={failed.length} label="발송 실패" tone="danger" />
          <AdminCountCard count={pending.length} label="발송 확인 중" tone="info" />
          <AdminCountCard count={resendableFailed.length} icon={RotateCw} label="지금 다시 보낼 수 있음" tone="warning" />
        </div>
      ) : null}

      {/* 누를 버튼이 있을 때만 누르라고 말한다. 버튼이 하나도 없으면 없다고 먼저 말한다. */}
      {failedConfirmation ? (
        <AdminNotice tone="warning" title="주문 확인 메일은 전자상거래법상 계약내용에 관한 서면입니다.">
          실패한 건은 줄의 다시 보내기로 다시 보내주세요.
        </AdminNotice>
      ) : failed.length && !resendableFailed.length ? (
        <AdminNotice tone="neutral" title="지금 이 화면에서 다시 보낼 수 있는 메일이 없습니다.">
          {failed.some(needsInquiryReply) ? '표의 다음 행동 칸에 주황색으로 적힌 일만 직접 처리해주세요.' : '표의 다음 행동 칸에 이유를 적었습니다. 지금 처리할 일은 없습니다.'}
        </AdminNotice>
      ) : null}

      {/* 발송 이력 목록 카드 — 한 건이 표 한 줄이라 유형·상태·다음 행동을 위아래로 훑어 비교한다. */}
      <ConsoleListCard
        aria-label="메일 발송 이력 목록"
        description={deliveries.length ? <>최근 {deliveries.length.toLocaleString('ko-KR')}건 기준이며 실패한 건을 먼저 보여줍니다.{redactedReason ? ' 상세 사유는 개인정보 보호로 저장하지 않습니다.' : ''}{detachedRecord ? ' 주문·받는 사람이 보관되지 않은 기록은 메일 종류만 보입니다.' : ''}</> : undefined}
      >
      {!deliveries.length ? (
        <div className="py-10 text-center" role="status">
          <p className="text-sm font-medium">다시 보낼 메일이 없습니다.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">실패했거나 결과를 확인하지 못한 발송이 생기면 여기에 쌓입니다.</p>
        </div>
      ) : (
        <div aria-label="발송 기록 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}>
          <Table className="min-w-[50rem]">
            <caption className="sr-only">발송 기록</caption>
            <ConsoleTableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-24 px-3">유형</TableHead>
                <TableHead className="px-3">제목·요약</TableHead>
                <TableHead className="w-28 px-3">상태</TableHead>
                <TableHead className="w-44 px-3">마지막 시도</TableHead>
                <TableHead className="w-[21rem] px-3">다음 행동</TableHead>
              </TableRow>
            </ConsoleTableHeader>
            <TableBody>
              {ordered.map((delivery) => {
                const subject = isProtectedValue(delivery.subject) ? null : delivery.subject;
                const recipient = isProtectedValue(delivery.recipient) ? null : delivery.recipient;
                /* 원문을 지운 기록은 사유를 모르는 것이지 사유가 아니다 — 빨간 글자로 적지 않는다(표 위 안내 한 번). */
                const error = delivery.lastError && !isProtectedValue(delivery.lastError) ? delivery.lastError : null;
                return (
                  <TableRow className={needsInquiryReply(delivery) ? 'bg-warning-soft/50 hover:bg-warning-soft' : undefined} key={delivery.dedupeKey}>
                    <TableCell className="px-3 font-medium">{delivery.templateLabel}</TableCell>
                    <TableCell className="px-3">
                      <span className="block max-w-[22rem] truncate" title={subject ?? undefined}>{subject ?? TEMPLATE_SUMMARY[delivery.template]}</span>
                      {delivery.orderId || recipient ? (
                        <span className="mt-0.5 block max-w-[22rem] truncate text-xs text-muted-foreground tabular-nums" title={recipient ?? undefined}>
                          {delivery.orderId ? <Link className="font-medium underline-offset-4 hover:underline" href={`/admin/sales/orders/${delivery.orderId}`} title={delivery.orderId}>주문 {delivery.orderId.slice(0, 8)}…</Link> : null}
                          {delivery.orderId && recipient ? ' · ' : null}
                          {recipient ? <>받는 사람 {recipient}</> : null}
                        </span>
                      ) : null}
                      {error ? <span className="mt-0.5 block max-w-[22rem] truncate text-xs text-destructive" title={error}>실패 사유: {error}</span> : null}
                    </TableCell>
                    <TableCell className="px-3"><AdminStatusBadge tone={statusTone('emailDelivery', delivery.status)}>{statusLabel(delivery.status)}</AdminStatusBadge></TableCell>
                    <TableCell className="px-3 tabular-nums">
                      {formatAttemptedAt(delivery.claimedAt)}
                      <span className="mt-0.5 block text-xs text-muted-foreground">{delivery.attemptCount}회 시도</span>
                    </TableCell>
                    <TableCell className="px-3 whitespace-normal"><NextAction delivery={delivery} nowMs={nowMs} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      </ConsoleListCard>
    </section>
  );
}
