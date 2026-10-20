import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import type { PurchaseRestrictionBatch } from '@/lib/admin/purchase-restriction-batches';
import { PurchaseRestrictionBatchForm } from './PurchaseRestrictionBatchForm';
import { ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import type { PurchaseRestrictionReleaseReceipt } from '@/lib/admin/purchase-restriction-release';
import { PurchaseRestrictionReleaseGrid } from './PurchaseRestrictionReleaseGrid';
import { SalesGuide, SalesFilterField, SalesFilterPanel, SalesSelect } from '@/components/admin/sales/SalesConsole';
import { PURCHASE_RESTRICTION_REASONS, purchaseRestrictionsHref, type PurchaseRestrictionData } from '@/lib/admin/purchase-restrictions';
import { formatOrderDateTime } from '@/lib/orders';
import { PurchaseRestrictionRegister, PurchaseRestrictionRelease } from './PurchaseRestrictionForms';
const COLUMNS: ConsoleGridColumn[] = [
  { key: 'state', label: '상태', width: '90px', required: true },
  { key: 'customer', label: '고객', width: '190px', required: true },
  { key: 'reason', label: '등록 사유', width: '230px' },
  { key: 'order', label: '근거 주문번호', width: '170px' },
  { key: 'registered', label: '등록일시 / 처리자', width: '170px' },
  { key: 'released', label: '해제일시 / 처리자 / 사유', width: '230px' },
  { key: 'action', label: '관리', width: '190px', required: true },
];
export function PurchaseRestrictionsScreen({ data, initialBatch = null, batchMissing = false, initialRelease = null, releaseMissing = false }: { data: PurchaseRestrictionData; initialBatch?: PurchaseRestrictionBatch | null; batchMissing?: boolean; initialRelease?: PurchaseRestrictionReleaseReceipt | null; releaseMissing?: boolean }) {
  const { filters, total } = data;
  const currentHref = purchaseRestrictionsHref(filters);
  return <div className="admin-console admin-sales-console admin-purchase-restriction-screen wc-admin-kit">
    <SalesGuide title={adminGoodsCopy('판매방해 고객의 신규 굿즈 주문을 제한하고 등록·해제 이력을 확인합니다.')}>
      <p>{adminGoodsCopy('구매제한은 신규 굿즈 주문에 적용됩니다. 기존 주문의 결제·배송·취소·환불은 정상 처리하며, 로그인·공개 탐색·티켓 예매·게임 이용은 각 서비스의 기존 기준을 따릅니다.')}</p>
      <p>계정 전체 정지는 고객 관리의 별도 조치입니다. 등록 사유와 근거를 확인한 뒤 필요한 고객에 한해 등록하고, 해제 시에도 사유를 남깁니다.</p>
    </SalesGuide>
    <SalesFilterPanel currentHref={currentHref} id="purchase-restrictions" hiddenFieldExclusions={['pageSize']} search={{ value: filters.query, placeholder: '고객명 · 고객 ID · 정확한 이메일 · 근거 주문번호' }}>
      <SalesFilterField label="처리상태" htmlFor="purchase-restriction-state"><SalesSelect id="purchase-restriction-state" name="state" value={filters.state} options={[{ value: 'active', label: '구매제한 중' }, { value: 'released', label: '해제' }, { value: 'all', label: '전체' }]} /></SalesFilterField>
      <SalesFilterField label="목록 수" htmlFor="purchase-restriction-size"><SalesSelect id="purchase-restriction-size" name="pageSize" value={String(filters.pageSize)} options={[20,50,100].map(size => ({ value: String(size), label: `${size}개씩 보기` }))} /></SalesFilterField>
    </SalesFilterPanel>
    {batchMissing ? <p role="alert" className="admin-error">등록 요청을 찾을 수 없습니다. 목록에서 구매제한 상태를 확인해주세요.</p> : null}
    {releaseMissing ? <p role="alert" className="admin-error">이 요청으로 저장된 해제 결과가 없습니다. 목록에서 최신 구매제한 상태를 확인해주세요.</p> : null}
    <PurchaseRestrictionRegister />
    <PurchaseRestrictionBatchForm key={initialBatch?.id ?? 'new'} initialBatch={initialBatch} currentHref={currentHref} />
    <div className="admin-sales-results">
      <div className="admin-sales-results-heading"><h2>목록 <span>(총 <strong>{total.toLocaleString('ko-KR')}</strong>건)</span></h2><span>최근 등록순 · 해제 이력 포함 조회 가능</span></div>
      <PurchaseRestrictionReleaseGrid key={currentHref + (initialRelease?.id ?? '')} columns={COLUMNS} currentHref={currentHref} initialReceipt={initialRelease}
        rows={data.rows.map(row => ({ id: row.id, selectable: row.releasedAt === null, selectLabel: `${row.nickname || row.userId} 구매제한 선택`, cells: [
          <span key="state" className={row.releasedAt ? 'admin-badge' : 'admin-badge admin-badge--warn'}>{row.releasedAt ? '해제' : '구매제한 중'}</span>,
          <div key="customer"><Link href={`/admin/customers/${row.userId}`}>{row.nickname || '이름 없음'}</Link><small>{row.maskedEmail}</small><small className="mono">{row.userId}</small></div>,
          <div key="reason"><strong>{PURCHASE_RESTRICTION_REASONS.find(reason => reason.value === row.reasonCode)?.label ?? row.reasonCode}</strong><small>{row.reasonDetail}</small></div>,
          row.evidenceOrderId ? <Link key="order" className="mono" href={`/admin/sales/orders/${row.evidenceOrderId}`}>{row.evidenceOrderId}</Link> : '—',
          <div key="registered">{formatOrderDateTime(row.createdAt)}<small>{row.createdBy || '담당자 정보 없음'}</small></div>,
          row.releasedAt ? <div key="released">{formatOrderDateTime(row.releasedAt)}<small>{row.releasedBy || '담당자 정보 없음'}</small><small>{row.releaseReason}</small></div> : '—',
          row.releasedAt ? '—' : <PurchaseRestrictionRelease key="action" restrictionId={row.id} customerName={row.nickname || row.userId} />,
        ] }))} />
      <ConsolePagination label="구매제한 목록 페이지" page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => purchaseRestrictionsHref({ ...filters, page })} />
    </div>
  </div>;
}
