import Link from 'next/link';
import { ConsoleCountChips, ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesGuide } from '@/components/admin/sales/SalesConsole';
import { statusTone } from '@/lib/admin/status-tone';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { CLAIM_FEE_FILTERS, claimFeeQueueHref, type ClaimFeeFilter, type ClaimFeeQueue } from '@/lib/admin/claim-fees';
import { CLAIM_FEE_POLICY_PATH, CLAIM_FEE_STATES } from '@/lib/orders/claim-fees';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { krw } from '@/lib/format';

/* 반품·교환 배송비 청구·입금·반환 목록 — 템플릿 룩(ADR-0028). 상태 칩·목록·페이지는 공용 콘솔 부품이다. */

const columns: ConsoleGridColumn[] = [{ key: 'invoice', label: '청구번호', width: '140px' }, { key: 'order', label: '주문번호', width: '150px' }, { key: 'type', label: '유형', width: '90px' },
 { key: 'state', label: '처리 상태', width: '180px' }, { key: 'amount', label: '청구 금액', width: '130px', align: 'end' }, { key: 'payer', label: '납부 대상', width: '140px' },
 { key: 'issued', label: '청구 시각', width: '180px' }, { key: 'received', label: '입금 확인 시각', width: '180px' }, { key: 'refunded', label: '반환 완료 시각', width: '180px' }];
export function ClaimFeesScreen({ data }: { data: ClaimFeeQueue }) {
 const count = (state: string) => state === 'all' ? Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0) : state === 'open' ? (data.counts.unpaid ?? 0) + (data.counts.reported ?? 0) + (data.counts.refund_due ?? 0) : data.counts[state as keyof typeof data.counts] ?? 0;
 return <section className="flex min-w-0 flex-col gap-4 text-sm text-foreground" aria-label="반품·교환 배송비 청구" data-admin-kit="claim-fees">
  <SalesGuide title="반품·교환 배송비 청구와 반환을 확인하세요.">
   <p>고객 입금 알림은 수납 확인 전입니다. 요청 상세에서 실제 거래 내역을 확인하고 입금·반환 결과를 기록합니다. 주문 결제·환불 금액은 이 목록의 별도 배송비와 구분됩니다.</p>
   <p><Link href={CLAIM_FEE_POLICY_PATH}>배송비 청구 정책</Link> · <Link href="/admin/sales/claims/returns">반품 관리</Link> · <Link href="/admin/sales/claims/exchanges">교환 관리</Link></p>
  </SalesGuide>
  <ConsoleCountChips label="배송비 처리 상태" chips={Object.entries(CLAIM_FEE_FILTERS).map(([state, label]) => ({ label, active: data.state === state, count: count(state),
   tone: state === 'refund_due' ? 'danger' as const : state === 'reported' ? 'warning' as const : 'default' as const, href: claimFeeQueueHref(state as ClaimFeeFilter) }))} />
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h2 className="text-lg font-semibold tracking-tight">{CLAIM_FEE_FILTERS[data.state]} <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-medium text-foreground tabular-nums">{data.total.toLocaleString('ko-KR')}</strong>건)</span></h2>
   <Link className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))} data-slot="button" href={claimFeeQueueHref(data.state, data.page)}>새로고침</Link>
  </div>
  <ConsoleGrid caption="반품 교환 배송비 청구 목록" preferencesKey="sales-claim-fees" columns={columns} emptyLabel="조건에 맞는 배송비 청구가 없습니다." rows={data.rows.map(row => ({ id: row.id,
   href: `/admin/sales/claims/${row.claimType === 'exchange' ? 'exchanges' : 'returns'}/${row.claimId}`,
   cells: [<span className="tabular-nums" key="invoice">{row.id.slice(-8).toUpperCase()}</span>, <span className="tabular-nums" key="order">{orderReferenceLabel(row.orderId, row.orderNumber)}</span>, row.claimType === 'exchange' ? '교환' : '반품', <AdminStatusBadge key="state" tone={statusTone('claimFee', row.state)}>{CLAIM_FEE_STATES[row.state]}</AdminStatusBadge>,
    <span className="tabular-nums" key="amount">{krw(row.amount)}</span>, row.payerRole === 'buyer' ? '원 주문 구매자' : '반품·교환 요청자', formatOrderDateTime(row.issuedAt), row.receivedAt ? formatOrderDateTime(row.receivedAt) : '미확인', row.refundedAt ? formatOrderDateTime(row.refundedAt) : '미완료'],
  }))} />
  <ConsolePagination label="배송비 청구 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => claimFeeQueueHref(data.state, page)} />
 </section>;
}
