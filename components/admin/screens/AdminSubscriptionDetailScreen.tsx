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
const columns: ConsoleGridColumn[] = [{ key: 'number', label: '회차', width: '80px', required: true }, { key: 'scheduled', label: '예정일', width: '170px' },
  { key: 'state', label: '결제 상태', width: '170px' }, { key: 'amount', label: '온라인 금액', width: '130px', align: 'end' },
  { key: 'order', label: '주문', width: '220px' }, { key: 'settled', label: '처리일', width: '170px' }];
export function AdminSubscriptionDetailScreen({ actorId, data, canManage, older }: { actorId: string; data: AdminSubscriptionDetail; canManage: boolean; older: boolean }) {
  const request = useSubscriptionRequest(actorId), router = useRouter(), [message, setMessage] = useState('');
  const { subscription: plan, cycles } = data, latest = plan.latestCycle;
  const inspect = canManage && latest?.dispatchedAt && ['dispatching', 'unknown', 'needs_review'].includes(latest.state);
  return <section className="admin-sales-console wc-admin-kit"><header><Link href="/admin/sales/subscriptions">정기구매 목록</Link><h1>정기구매 상세</h1></header>
    <SubscriptionRequestFeedback {...request} />{!request.blocked && <>
      <dl><div><dt>신청번호</dt><dd className="mono">{plan.id}</dd></div><div><dt>구매자</dt><dd>{plan.buyerName}</dd></div><div><dt>상품</dt><dd>{plan.goodsLabel}</dd></div>
        <div><dt>상태·주기</dt><dd>{SUBSCRIPTION_PLAN_LABELS[plan.state]} · {subscriptionScheduleLabel(plan.schedule)}</dd></div><div><dt>다음 결제일</dt><dd>{plan.nextRunAt ? formatOrderDateTime(plan.nextRunAt) : '—'}</dd></div>
        <div><dt>이후 회차 온라인 금액 / 별도 착불 배송비</dt><dd>{formatKrwExact(plan.renewalOnlineTotal)} / {formatKrwExact(plan.renewalCollectTotal)}</dd></div>
        <div><dt>결제완료 회차·누계</dt><dd>{plan.paidCycleCount}회 · {formatKrwExact(plan.paidOnlineTotal)}</dd></div></dl>
      {plan.reason && <p>{adminGoodsCopy(SUBSCRIPTION_REASON_LABELS[plan.reason as SubscriptionPauseReason] ?? '회차 확인이 필요합니다.')}</p>}
      <p>신청 주기·배송지·카드·결제금액 변경은 고객의 동의를 받아 고객 화면에서 진행합니다. 주문 취소·반품·환불은 회차별 주문 상세에서 처리하세요.</p>
      <div className="wc-admin-kit__actions"><button className="btn btn-sm" type="button" disabled={request.locked} onClick={() => router.refresh()}>최신 상태 확인</button>
        {inspect && <button type="button" className="btn btn-sm" disabled={request.locked} onClick={() => {
          const input = { expectedActorId: actorId, cycleId: latest.id, operationId: crypto.randomUUID() };
          request.run(() => inspectGoodsSubscriptionPaymentAction(input), value => { setMessage(value); router.refresh(); });
        }}>현재 회차 결제 결과 조회</button>}</div>{message && <p role="status">{message}</p>}
      <ConsoleGrid caption="정기구매 회차 내역" preferencesKey="sales-subscription-cycles" columns={columns} emptyLabel="생성된 회차가 없습니다."
        rows={cycles.rows.map(cycle => ({ id: cycle.id, cells: [cycle.number, formatOrderDateTime(cycle.scheduledAt),
          `${SUBSCRIPTION_CYCLE_LABELS[cycle.state]}${cycle.orderStatus === 'canceled' ? ' · 주문 취소' : ''}`, cycle.amount === null ? '—' : formatKrwExact(cycle.amount),
          cycle.orderId ? <Link key="order" className="mono" href={`/admin/sales/orders/${cycle.orderId}`}>{cycle.orderId}</Link> : '—', cycle.settledAt ? formatOrderDateTime(cycle.settledAt) : '—'] }))} />
      <nav aria-label="정기구매 회차 페이지" className="wc-admin-kit__actions"><span>전체 {cycles.total}회차</span>{older && <Link href={`/admin/sales/subscriptions/${plan.id}`}>최근 회차 보기</Link>}
        {cycles.hasMore && <Link href={`/admin/sales/subscriptions/${plan.id}?before=${cycles.nextBeforeNumber}`}>이전 회차 더 보기</Link>}</nav>
    </>}</section>;
}
