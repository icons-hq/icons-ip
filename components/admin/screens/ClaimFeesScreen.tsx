import Link from 'next/link';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { SalesGuide, SalesStatusSummary } from '@/components/admin/sales/SalesConsole';
import { CLAIM_FEE_FILTERS, claimFeeQueueHref, type ClaimFeeFilter, type ClaimFeeQueue } from '@/lib/admin/claim-fees';
import { CLAIM_FEE_POLICY_PATH, CLAIM_FEE_STATES } from '@/lib/orders/claim-fees';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { krw } from '@/lib/format';
const columns: ConsoleGridColumn[] = [{ key: 'invoice', label: '청구번호', width: '140px' }, { key: 'order', label: '주문번호', width: '150px' }, { key: 'type', label: '유형', width: '90px' },
 { key: 'state', label: '처리 상태', width: '180px' }, { key: 'amount', label: '청구 금액', width: '130px', align: 'end' }, { key: 'payer', label: '납부 대상', width: '140px' },
 { key: 'issued', label: '청구 시각', width: '180px' }, { key: 'received', label: '입금 확인 시각', width: '180px' }, { key: 'refunded', label: '반환 완료 시각', width: '180px' }];
export function ClaimFeesScreen({ data }: { data: ClaimFeeQueue }) {
 const count = (state: string) => state === 'all' ? Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0) : state === 'open' ? (data.counts.unpaid ?? 0) + (data.counts.reported ?? 0) + (data.counts.refund_due ?? 0) : data.counts[state as keyof typeof data.counts] ?? 0;
 return <section className="admin-console admin-sales-console"><SalesGuide title="반품·교환 배송비 청구와 반환을 확인하세요.">
  <p>고객 입금 알림은 수납 확인 전입니다. 요청 상세에서 실제 거래 내역을 확인하고 입금·반환 결과를 기록합니다. 주문 결제·환불 금액은 이 목록의 별도 배송비와 구분됩니다.</p>
  <p><Link href={CLAIM_FEE_POLICY_PATH}>배송비 청구 정책</Link> · <Link href="/admin/sales/claims/returns">반품 관리</Link> · <Link href="/admin/sales/claims/exchanges">교환 관리</Link></p>
 </SalesGuide><SalesStatusSummary label="배송비 처리 상태" items={Object.entries(CLAIM_FEE_FILTERS).map(([state, label]) => ({ label, active: data.state === state, count: count(state), urgent: state === 'refund_due' && count(state) > 0, href: claimFeeQueueHref(state as ClaimFeeFilter) }))} />
 <div className="admin-sales-results"><div className="admin-sales-results-heading"><h2>{CLAIM_FEE_FILTERS[data.state]} <span>(총 {data.total.toLocaleString('ko-KR')}건)</span></h2><Link className="btn btn-sm btn-ghost" href={claimFeeQueueHref(data.state, data.page)}>새로고침</Link></div>
  <ConsoleGrid caption="반품 교환 배송비 청구 목록" preferencesKey="sales-claim-fees" columns={columns} emptyLabel="조건에 맞는 배송비 청구가 없습니다." rows={data.rows.map(row => ({ id: row.id,
   href: `/admin/sales/claims/${row.claimType === 'exchange' ? 'exchanges' : 'returns'}/${row.claimId}`,
   cells: [row.id.slice(-8).toUpperCase(), orderReferenceLabel(row.orderId, row.orderNumber), row.claimType === 'exchange' ? '교환' : '반품', CLAIM_FEE_STATES[row.state], krw(row.amount), row.payerRole === 'buyer' ? '원 주문 구매자' : '반품·교환 요청자', formatOrderDateTime(row.issuedAt), row.receivedAt ? formatOrderDateTime(row.receivedAt) : '미확인', row.refundedAt ? formatOrderDateTime(row.refundedAt) : '미완료'],
  }))} /><ConsolePagination label="배송비 청구 목록 페이지" page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => claimFeeQueueHref(data.state, page)} /></div></section>;
}
