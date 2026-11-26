'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConsoleGrid, ConsoleListCard, type ConsoleGridColumn } from '@/components/admin/console';
import { LARGE_STATUS_BADGE_CLASS } from '@/components/admin/sales/OrderStatusBadge';
import { useSubscriptionRequest } from '@/components/subscriptions/useSubscriptionRequest';
import { SubscriptionRequestFeedback } from '@/components/subscriptions/SubscriptionParts';
import { inspectGoodsSubscriptionPaymentAction } from '@/app/admin/subscription-actions';
import { subscriptionScheduleLabel, type AdminSubscriptionDetail } from '@/lib/admin/subscriptions';
import { SUBSCRIPTION_CYCLE_LABELS, SUBSCRIPTION_PLAN_LABELS, SUBSCRIPTION_REASON_LABELS, type SubscriptionPauseReason } from '@/lib/subscriptions/model';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime } from '@/lib/orders';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { adminConfirm } from '@/lib/admin/confirm';
import { AdminNotice, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminPageHeading } from '@/components/admin/console/admin-shell-title';
import { statusTone } from '@/lib/admin/status-tone';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
/* 정기구매 상세(템플릿 룩, ADR-0028). 머리 한 줄에 구매자·상태·금액을 먼저 읽고, 주문 상세와 같은 자리에서 처리한다. */
const ROW = 'grid grid-cols-[8rem_minmax(0,1fr)] gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]';
const TERM = 'text-muted-foreground';
const VALUE = 'min-w-0 wrap-anywhere';
const columns: ConsoleGridColumn[] = [{ key: 'number', label: '회차', width: '80px', required: true }, { key: 'scheduled', label: '예정일', width: '170px' },
  { key: 'state', label: '결제 상태', width: '170px' }, { key: 'amount', label: '온라인 금액', width: '130px', align: 'end' },
  { key: 'order', label: '주문', width: '110px' }, { key: 'settled', label: '처리일', width: '170px' }];
/** 구매자 이름이 비어 있으면 DB(subscription_console_row)가 닉네임이 없을 때 쓰는 '회원'으로 부른다 — 이름이 머리글 글자라 빈칸이면 안 된다. */
const buyerLabel = (name: string) => name.trim() || '회원';
/** 확인창에 적는 상품 이름은 줄여 쓴다 — 여러 상품이 한 정기구매에 담기면 이름이 길다. */
const compactLabel = (text: string, max = 50) => { const chars = [...text.replace(/\s+/g, ' ').trim()]; return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join(''); };
/**
 * [현재 회차 결제 결과 조회]는 이름과 달리 조회로 끝나지 않는다. 결제사에서 읽은 결과를 회차에 반영하고, 결제가 이미 됐으면 구매자에게
 * 주문 확인 메일·알림톡이 나간다(lib/subscriptions/worker.server.ts). 새 결제는 요청하지 않는다 — 조회 작업만 받는다. 그래서 대상과 결과를 먼저 말하고 묻는다.
 */
function inspectPaymentConfirm({ subscription: plan, cycles }: AdminSubscriptionDetail, latest: NonNullable<AdminSubscriptionDetail['subscription']['latestCycle']>) {
  const amount = cycles.rows.find(row => row.id === latest.id)?.amount ?? null;
  return { title: '현재 회차 결제 결과를 조회할까요?', confirmLabel: '결제 결과 조회', cancelLabel: '돌아가기',
    message: `${buyerLabel(plan.buyerName)}님 · ${compactLabel(plan.goodsLabel)} · ${latest.number}회차${amount === null ? '' : ` · ${formatKrwExact(amount)}`}\n결제사에서 이 회차의 결제 결과를 조회하고, 그 결과대로 회차 상태를 바꿉니다. 결제가 이미 됐다면 구매자에게 주문 확인 메일·알림톡이 나갈 수 있습니다. 새로 결제하지는 않습니다.` };
}
export function AdminSubscriptionDetailScreen({ actorId, data, canManage, older }: { actorId: string; data: AdminSubscriptionDetail; canManage: boolean; older: boolean }) {
  const request = useSubscriptionRequest(actorId), router = useRouter(), [message, setMessage] = useState('');
  const { subscription: plan, cycles } = data, latest = plan.latestCycle, buyer = buyerLabel(plan.buyerName);
  const inspect = canManage && latest?.dispatchedAt && ['dispatching', 'unknown', 'needs_review'].includes(latest.state);
  async function inspectPayment() {
    if (!latest || !await adminConfirm(inspectPaymentConfirm(data, latest))) return;
    const input = { expectedActorId: actorId, cycleId: latest.id, operationId: crypto.randomUUID() };
    request.run(() => inspectGoodsSubscriptionPaymentAction(input), value => { setMessage(value); router.refresh(); });
  }
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-subscription-detail="">
    <header className="flex flex-wrap items-center justify-between gap-3" data-admin-kit="page-header">
      <section aria-label="정기구매 현재 상태" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-subscription-status-strip="">
        <AdminPageHeading title="정기구매 상세" />
        {/* 로그인 계정이 바뀌면 아래 내용과 함께 이 줄의 신청 정보도 감춘다. 정기구매에는 운영자가 쓰는 번호가 없어 구매자 이름이 머리를 이룬다. */}
        {request.blocked ? null : <>
          <strong className="min-w-0 text-base font-semibold wrap-anywhere">{buyer}</strong>
          <AdminStatusBadge className={LARGE_STATUS_BADGE_CLASS} tone={statusTone('subscription', plan.state)}>{SUBSCRIPTION_PLAN_LABELS[plan.state]}</AdminStatusBadge>
          <span className="flex items-baseline gap-1.5"><span className="text-muted-foreground">이후 회차</span><strong className="text-base font-semibold tabular-nums">{formatKrwExact(plan.renewalOnlineTotal)}</strong></span>
        </>}
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/sales/subscriptions">정기구매 목록</Link>
        {request.blocked ? null : <>
          <Button type="button" variant="outline" disabled={request.locked} onClick={() => router.refresh()}>최신 상태 확인</Button>
          {inspect && <Button type="button" disabled={request.locked} onClick={() => { void inspectPayment(); }}>현재 회차 결제 결과 조회</Button>}
        </>}
      </div>
    </header>
    <SubscriptionRequestFeedback {...request} />{!request.blocked && <>
      {message && <AdminNotice role="status" tone="success">{message}</AdminNotice>}
      {/* 고객이 스스로 멈춘 건은 문제가 아니므로 주의색을 쓰지 않는다. 문구는 고객 화면 말투라 누가 멈췄는지 운영자 말로 적는다. */}
      {plan.reason && <AdminNotice title={plan.reason === 'customer_paused' ? '운영자가 처리할 일은 없습니다' : '상태 사유를 확인해주세요'} tone={plan.reason === 'customer_paused' ? 'neutral' : 'warning'}>{plan.reason === 'customer_paused' ? '고객이 직접 일시정지했습니다.' : adminGoodsCopy(SUBSCRIPTION_REASON_LABELS[plan.reason as SubscriptionPauseReason] ?? '회차 확인이 필요합니다.')}</AdminNotice>}
      <AdminSectionCard title="신청 내용">
        <dl className="grid gap-3">
          <div className={ROW}><dt className={TERM}>구매자</dt><dd className={VALUE}>{buyer}</dd></div><div className={ROW}><dt className={TERM}>상품</dt><dd className={VALUE}>{plan.goodsLabel}</dd></div>
          <div className={ROW}><dt className={TERM}>주기</dt><dd className={VALUE}>{subscriptionScheduleLabel(plan.schedule)}</dd></div><div className={ROW}><dt className={TERM}>다음 결제일</dt><dd className={VALUE}>{plan.nextRunAt ? formatOrderDateTime(plan.nextRunAt) : '—'}</dd></div>
          <div className={ROW}><dt className={TERM}>이후 회차 온라인 금액</dt><dd className={`${VALUE} tabular-nums`}>{formatKrwExact(plan.renewalOnlineTotal)}</dd></div>
          <div className={ROW}><dt className={TERM}>별도 착불 배송비</dt><dd className={`${VALUE} tabular-nums`}>{formatKrwExact(plan.renewalCollectTotal)}</dd></div>
          <div className={ROW}><dt className={TERM}>결제완료 회차·누계</dt><dd className={`${VALUE} tabular-nums`}>{plan.paidCycleCount}회 · {formatKrwExact(plan.paidOnlineTotal)}</dd></div></dl>
        <p className="border-t pt-3 text-xs text-muted-foreground">신청 주기·배송지·카드·결제금액 변경은 고객의 동의를 받아 고객 화면에서 진행합니다. 주문 취소·반품·환불은 회차별 주문 상세에서 처리하세요.</p>
      </AdminSectionCard>
      <ConsoleListCard headingLevel={3} title="회차 내역" total={cycles.total} unit="회차">
      <ConsoleGrid caption="정기구매 회차 내역" configurable={false} columns={columns} emptyLabel="생성된 회차가 없습니다."
        rows={cycles.rows.map(cycle => ({ id: cycle.id, cells: [cycle.number, formatOrderDateTime(cycle.scheduledAt),
          <span key="state" className="flex flex-wrap items-center gap-1"><AdminStatusBadge tone={statusTone('subscriptionCycle', cycle.state)}>{SUBSCRIPTION_CYCLE_LABELS[cycle.state]}</AdminStatusBadge>{cycle.orderStatus === 'canceled' ? <AdminStatusBadge tone="danger">주문 취소</AdminStatusBadge> : null}</span>, cycle.amount === null ? '—' : formatKrwExact(cycle.amount),
          /* 회차 조회(private.subscription_cycle_page)가 주문번호 없이 orderId만 줘서, 번호 대신 가는 곳을 말한다. 주문번호는 그 주문 상세 머리에 있다. */
          cycle.orderId ? <Link key="order" className="underline-offset-4 hover:underline" href={`/admin/sales/orders/${cycle.orderId}`}>주문 상세</Link> : '—', cycle.settledAt ? formatOrderDateTime(cycle.settledAt) : '—'] }))} />
      {older || cycles.hasMore ? <nav aria-label="정기구매 회차 페이지" className="flex flex-wrap items-center gap-2">{older && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`/admin/sales/subscriptions/${plan.id}`}>최근 회차 보기</Link>}
        {cycles.hasMore && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`/admin/sales/subscriptions/${plan.id}?before=${cycles.nextBeforeNumber}`}>이전 회차 더 보기</Link>}</nav> : null}
      </ConsoleListCard>
    </>}</section>;
}
