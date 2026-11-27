import Link from 'next/link';
import { ConsoleCountChips, ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { AdminPageHeader, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { SalesGuide } from '@/components/admin/sales/SalesConsole';
import { statusTone } from '@/lib/admin/status-tone';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { cn } from 'cn';
import { CLAIM_FEE_FILTERS, CLAIM_FEE_LIST_LABEL, CLAIM_FEE_PAYER_LABEL, CLAIM_FEE_PAYER_LABELS, CLAIM_FEE_SETTINGS_LABEL, claimFeeQueueHref, type ClaimFeeFilter, type ClaimFeeQueue } from '@/lib/admin/claim-fees';
import { CLAIM_FEE_POLICY_PATH, CLAIM_FEE_STATES } from '@/lib/orders/claim-fees';
import { orderReferenceLabel } from '@/lib/orders';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import { ClaimDateTimeCell } from './ClaimDateTimeCell';
import { krw } from '@/lib/format';

/* 배송비 청구 내역 — 템플릿 룩(ADR-0028). 상태 칩·목록·페이지는 공용 콘솔 부품이다. 보기만 하는 화면이고, 입금 확인·반환 기록은 요청 상세에서 한다. */

/* 줄의 첫 칸이 요청 상세로 가는 링크다(ConsoleGrid) — 내부 번호 대신 어디로 가는지를 이름으로 적는다. */
/* 열 폭 합계는 1366px 화면의 틀(약 1050px) 안에 든다 — 합이 틀보다 크면 '입금 확인한 날'·'돌려준 날'이 가로로 밀린다(F-18). 날짜는 두 줄(ClaimDateTimeCell)이다. */
const columns: ConsoleGridColumn[] = [{ key: 'claim', label: '요청', width: '120px' }, { key: 'order', label: '주문번호', width: '156px' },
 { key: 'state', label: '처리 상태', width: '156px' }, { key: 'amount', label: '청구 금액', width: '100px', align: 'end' }, { key: 'payer', label: CLAIM_FEE_PAYER_LABEL, width: '132px' },
 { key: 'issued', label: '청구한 날', width: '112px' }, { key: 'received', label: '입금 확인한 날', width: '112px' }, { key: 'refunded', label: '돌려준 날', width: '112px' }];
const HEADER_LINK = cn(buttonVariants({ size: 'sm', variant: 'outline' }));
export function ClaimFeesScreen({ data, references = {} }: {
 data: ClaimFeeQueue;
 /** 청구 건의 요청번호(요청 id → 번호). 같은 주문의 여러 청구를 구분하게 '요청' 칸에 함께 보인다. 읽지 못했으면 비워 두고 유형만 보인다(F-18). */
 references?: Readonly<Record<string, number>>;
}) {
 const count = (state: string) => state === 'all' ? Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0) : state === 'open' ? (data.counts.unpaid ?? 0) + (data.counts.reported ?? 0) + (data.counts.refund_due ?? 0) : data.counts[state as keyof typeof data.counts] ?? 0;
 return <section className="flex min-w-0 flex-col gap-4 text-sm text-foreground" aria-label={CLAIM_FEE_LIST_LABEL} data-admin-kit="claim-fees">
  <AdminPageHeader title={CLAIM_FEE_LIST_LABEL} actions={<>
   <Link className={HEADER_LINK} data-slot="button" href={CLAIM_FEE_POLICY_PATH}>{CLAIM_FEE_SETTINGS_LABEL}</Link>
   <Link className={HEADER_LINK} data-slot="button" href="/admin/sales/claims/returns">반품 관리</Link>
   <Link className={HEADER_LINK} data-slot="button" href="/admin/sales/claims/exchanges">교환 관리</Link>
  </>} />
  <SalesGuide title="고객에게 따로 청구한 반품·교환 배송비입니다.">
   <p>입금 확인과 반환은 줄 맨 앞의 요청을 눌러, 요청 상세의 &lsquo;반품·교환 배송비&rsquo; 칸에서 기록합니다. 이 배송비는 주문 환불 금액에서 빼지 않고 따로 받고 따로 돌려줍니다.</p>
  </SalesGuide>
  <ConsoleCountChips label="배송비 처리 상태" chips={Object.entries(CLAIM_FEE_FILTERS).map(([state, label]) => ({ label, active: data.state === state, count: count(state),
   tone: state === 'refund_due' ? 'danger' as const : state === 'reported' ? 'warning' as const : 'default' as const, href: claimFeeQueueHref(state as ClaimFeeFilter) }))} />
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h2 className="text-lg font-semibold tracking-tight">{CLAIM_FEE_FILTERS[data.state]} <span className="text-sm font-normal text-muted-foreground">(총 <strong className="font-medium text-foreground tabular-nums">{data.total.toLocaleString('ko-KR')}</strong>건)</span></h2>
   <Link className={HEADER_LINK} data-slot="button" href={claimFeeQueueHref(data.state, data.page)}>새로고침</Link>
  </div>
  <ConsoleGrid caption={`${CLAIM_FEE_LIST_LABEL} 목록`} preferencesKey="sales-claim-fees" columns={columns} emptyLabel="조건에 맞는 배송비 청구가 없습니다." rows={data.rows.map(row => ({ id: row.id,
   href: `/admin/sales/claims/${row.claimType === 'exchange' ? 'exchanges' : 'returns'}/${row.claimId}`,
   cells: [references[row.claimId] ? <span className="flex flex-col" key="claim"><span className="tabular-nums">{orderClaimReferenceLabel(references[row.claimId])}</span><span className="text-xs font-normal text-muted-foreground">{row.claimType === 'exchange' ? '교환 요청' : '반품 요청'}</span></span> : row.claimType === 'exchange' ? '교환 요청' : '반품 요청', <span className="tabular-nums" key="order">{orderReferenceLabel(row.orderId, row.orderNumber)}</span>, <AdminStatusBadge key="state" tone={statusTone('claimFee', row.state)}>{CLAIM_FEE_STATES[row.state]}</AdminStatusBadge>,
    <span className="tabular-nums" key="amount">{krw(row.amount)}</span>, CLAIM_FEE_PAYER_LABELS[row.payerRole], <ClaimDateTimeCell key="issued" value={row.issuedAt} />, row.receivedAt ? <ClaimDateTimeCell key="received" value={row.receivedAt} /> : '-', row.refundedAt ? <ClaimDateTimeCell key="refunded" value={row.refundedAt} /> : '-'],
  }))} />
  <ConsolePagination label={`${CLAIM_FEE_LIST_LABEL} 페이지`} page={data.page} pageSize={data.pageSize} total={data.total} hrefForPage={page => claimFeeQueueHref(data.state, page)} />
 </section>;
}
