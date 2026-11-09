'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import { useSubscriptionRequest } from '@/components/subscriptions/useSubscriptionRequest';
import { SubscriptionRequestFeedback } from '@/components/subscriptions/SubscriptionParts';
import { inspectGoodsSubscriptionPaymentAction } from '@/app/admin/subscription-actions';
import { subscriptionScheduleLabel, type AdminSubscriptionDetail } from '@/lib/admin/subscriptions';
import { SUBSCRIPTION_CYCLE_LABELS, SUBSCRIPTION_PLAN_LABELS, SUBSCRIPTION_REASON_LABELS, type SubscriptionPauseReason } from '@/lib/subscriptions/model';
import { formatKrwExact } from '@/components/admin/format';
import { formatOrderDateTime } from '@/lib/orders';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { AdminNotice, AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
/* 정기구매 상세(템플릿 룩, ADR-0028). 셸이 h1을 그리므로 화면 머리는 AdminPageHeader(h2)다. */
const ROW = 'grid grid-cols-[8rem_minmax(0,1fr)] gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]';
const TERM = 'text-muted-foreground';
const VALUE = 'min-w-0 wrap-anywhere';
const columns: ConsoleGridColumn[] = [{ key: 'number', label: '회차', width: '80px', required: true }, { key: 'scheduled', label: '예정일', width: '170px' },
  { key: 'state', label: '결제 상태', width: '170px' }, { key: 'amount', label: '온라인 금액', width: '130px', align: 'end' },
  { key: 'order', label: '주문', width: '220px' }, { key: 'settled', label: '처리일', width: '170px' }];
export function AdminSubscriptionDetailScreen({ actorId, data, canManage, older }: { actorId: string; data: AdminSubscriptionDetail; canManage: boolean; older: boolean }) {
  const request = useSubscriptionRequest(actorId), router = useRouter(), [message, setMessage] = useState('');
  const { subscription: plan, cycles } = data, latest = plan.latestCycle;
  const inspect = canManage && latest?.dispatchedAt && ['dispatching', 'unknown', 'needs_review'].includes(latest.state);
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-subscription-detail="">
    <AdminPageHeader title="정기구매 상세" actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/sales/subscriptions">정기구매 목록</Link>} />
    <SubscriptionRequestFeedback {...request} />{!request.blocked && <>
      <dl className="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
        <div className={ROW}><dt className={TERM}>신청번호</dt><dd className={`${VALUE} tabular-nums`}>{plan.id}</dd></div><div className={ROW}><dt className={TERM}>구매자</dt><dd className={VALUE}>{plan.buyerName}</dd></div><div className={ROW}><dt className={TERM}>상품</dt><dd className={VALUE}>{plan.goodsLabel}</dd></div>
        <div className={ROW}><dt className={TERM}>상태·주기</dt><dd className={`${VALUE} flex flex-wrap items-center gap-2`}><AdminStatusBadge tone={statusTone('subscription', plan.state)}>{SUBSCRIPTION_PLAN_LABELS[plan.state]}</AdminStatusBadge> {subscriptionScheduleLabel(plan.schedule)}</dd></div><div className={ROW}><dt className={TERM}>다음 결제일</dt><dd className={VALUE}>{plan.nextRunAt ? formatOrderDateTime(plan.nextRunAt) : '—'}</dd></div>
        <div className={ROW}><dt className={TERM}>이후 회차 온라인 금액 / 별도 착불 배송비</dt><dd className={`${VALUE} tabular-nums`}>{formatKrwExact(plan.renewalOnlineTotal)} / {formatKrwExact(plan.renewalCollectTotal)}</dd></div>
        <div className={ROW}><dt className={TERM}>결제완료 회차·누계</dt><dd className={`${VALUE} tabular-nums`}>{plan.paidCycleCount}회 · {formatKrwExact(plan.paidOnlineTotal)}</dd></div></dl>
      {plan.reason && <AdminNotice tone="warning">{adminGoodsCopy(SUBSCRIPTION_REASON_LABELS[plan.reason as SubscriptionPauseReason] ?? '회차 확인이 필요합니다.')}</AdminNotice>}
      <p className="text-muted-foreground">신청 주기·배송지·카드·결제금액 변경은 고객의 동의를 받아 고객 화면에서 진행합니다. 주문 취소·반품·환불은 회차별 주문 상세에서 처리하세요.</p>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" type="button" variant="outline" disabled={request.locked} onClick={() => router.refresh()}>최신 상태 확인</Button>
        {inspect && <Button size="sm" type="button" disabled={request.locked} onClick={() => {
          const input = { expectedActorId: actorId, cycleId: latest.id, operationId: crypto.randomUUID() };
          request.run(() => inspectGoodsSubscriptionPaymentAction(input), value => { setMessage(value); router.refresh(); });
        }}>현재 회차 결제 결과 조회</Button>}</div>{message && <p className="text-success" role="status">{message}</p>}
      <ConsoleGrid caption="정기구매 회차 내역" preferencesKey="sales-subscription-cycles" columns={columns} emptyLabel="생성된 회차가 없습니다."
        rows={cycles.rows.map(cycle => ({ id: cycle.id, cells: [cycle.number, formatOrderDateTime(cycle.scheduledAt),
          <span key="state" className="flex flex-wrap items-center gap-1"><AdminStatusBadge tone={statusTone('subscriptionCycle', cycle.state)}>{SUBSCRIPTION_CYCLE_LABELS[cycle.state]}</AdminStatusBadge>{cycle.orderStatus === 'canceled' ? <AdminStatusBadge tone="danger">주문 취소</AdminStatusBadge> : null}</span>, cycle.amount === null ? '—' : formatKrwExact(cycle.amount),
          cycle.orderId ? <Link key="order" className="tabular-nums underline-offset-4 hover:underline" href={`/admin/sales/orders/${cycle.orderId}`}>{cycle.orderId}</Link> : '—', cycle.settledAt ? formatOrderDateTime(cycle.settledAt) : '—'] }))} />
      <nav aria-label="정기구매 회차 페이지" className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground tabular-nums">전체 {cycles.total}회차</span>{older && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`/admin/sales/subscriptions/${plan.id}`}>최근 회차 보기</Link>}
        {cycles.hasMore && <Link className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`/admin/sales/subscriptions/${plan.id}?before=${cycles.nextBeforeNumber}`}>이전 회차 더 보기</Link>}</nav>
    </>}</section>;
}
