'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkConfirmAdminOrdersAction } from '@/app/admin/order-actions';
import { GoodsCustomInputsSummary } from '@/components/shop/GoodsCustomInputs';
import { AdminListExportButton } from '@/components/admin/AdminListExportButton';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { OrderViewTabs } from '@/components/admin/sales/OrderViewTabs';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsHeader, SalesSelect, SalesStatusSummary } from '@/components/admin/sales/SalesConsole';
import { formatKrwExact } from '@/components/admin/format';
import { adminListExportHref } from '@/lib/admin/list-export';
import { adminOrderItemsHref, selectedConfirmableOrderIds, type AdminOrderItemData } from '@/lib/admin/order-items';
import { adminOrderDetailHrefFromBack, ADMIN_ORDER_SEARCH_FIELDS, ADMIN_ORDER_STATUSES, ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { SALES_DATE_FIELDS } from '@/lib/admin/sales-list';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { isOpenOrderClaimStage, ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';

const fields = [...ADMIN_ORDER_SEARCH_FIELDS, { value: 'item', label: '상품주문번호' }];
const statuses = [{ value: 'all', label: '전체 상태' }, ...ADMIN_ORDER_STATUSES.map(value => ({ value, label: ADMIN_ORDER_STATUS_LABELS[value] }))];
const columns: ConsoleGridColumn[] = [
  { key: 'item', label: '상품주문번호', width: '190px', required: true }, { key: 'order', label: '주문번호', width: '190px', required: true },
  { key: 'status', label: '주문상태', width: '100px' }, { key: 'created', label: '주문일시', width: '160px' },
  { key: 'good', label: '상품명', width: '240px' }, { key: 'variant', label: '옵션 / 옵션코드', width: '180px' },
  { key: 'qty', label: '수량', width: '65px', align: 'end' }, { key: 'unitPrice', label: '단가', width: '100px', align: 'end' },
  { key: 'amount', label: '상품금액', width: '120px', align: 'end' }, { key: 'buyer', label: '구매자명', width: '110px' },
  { key: 'recipient', label: '수취인명', width: '110px' }, { key: 'shipment', label: '출고지 / 배송', width: '180px' },
  { key: 'claim', label: '취소·반품·교환', width: '140px' }, { key: 'action', label: '주문 전체 상세', width: '120px' },
];
export function OrderItemsScreen({ data, canManage }: { data: AdminOrderItemData; canManage: boolean }) {
  const router = useRouter(); const [selected, setSelected] = useState<string[]>([]); const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const { filters } = data; const currentHref = adminOrderItemsHref(filters); const pageSize = filters.pageSize ?? 20;
  const eligible = new Set(data.rows.filter(row => canManage && row.status === 'paid' && (!row.claim || !isOpenOrderClaimStage(row.claim.stage))).map(row => row.id));
  const selection = selected.filter(id => eligible.has(id));
  const orderIds = selectedConfirmableOrderIds(data.rows, selection);
  function confirm() {
    if (pending || !orderIds.length || !window.confirm(`선택한 상품주문이 포함된 주문 전체 ${orderIds.length}건을 발주확인할까요? 선택하지 않은 같은 주문의 품목도 함께 처리됩니다.`)) return;
    setError(''); setMessage('');
    startTransition(async () => {
      try {
        const form = new FormData(); orderIds.forEach(id => form.append('orderIds', id));
        const result = await bulkConfirmAdminOrdersAction({}, form);
        setError(result.errors?.form ?? ''); setMessage(result.message ?? ''); setSelected([]); router.refresh();
      } catch { setError('처리 결과를 확인하지 못했습니다. 주문 전체의 최신 상태를 확인해주세요.'); router.refresh(); }
    });
  }
  return <section className="admin-orders admin-order-items admin-sales-console wc-admin-kit">
    <OrderViewTabs filters={filters} view="items" />
    <SalesGuide title="상품주문별 번호·옵션·수량과 연결된 주문·배송을 확인합니다.">
      <p>상품주문번호는 주문에 포함된 개별 품목의 고유 번호입니다. 같은 주문번호가 여러 행에 표시될 수 있습니다. 상품명·옵션은 주문 당시 기록이며 현재 상품 정보로 바뀌지 않습니다.</p>
      <p>상품금액은 주문 당시 단가 × 수량이며 주문 쿠폰·적립금과 배송비를 배분한 결제금액이 아닙니다. 취소·반품은 주문 전체·전액으로 처리합니다.</p>
    </SalesGuide>
    <SalesStatusSummary label="상품주문 처리 단계" items={statuses.map(option => ({ label: option.label, active: filters.status === option.value,
      count: option.value === 'all' ? Object.values(data.counts).reduce((sum, value) => sum + value, 0) : data.counts[option.value as keyof typeof data.counts],
      href: adminOrderItemsHref(filters, { status: option.value as typeof filters.status, page: 1 }) }))} />
    <SalesFilterPanel currentHref={currentHref} resetHref="/admin/sales/orders?view=items" id="order-items"
      date={{ from: filters.from, to: filters.to, field: filters.dateField ?? 'ordered', options: SALES_DATE_FIELDS }}
      search={{ value: filters.query, field: filters.field, options: fields, placeholder: '상품주문 · 주문 · 상품명 · 옵션 · 구매자 · 송장' }}>
      <SalesFilterField label="주문상태" htmlFor="order-item-status"><SalesSelect id="order-item-status" name="status" value={filters.status} options={statuses} /></SalesFilterField>
      <SalesFilterField label="결제수단" htmlFor="order-item-payment"><SalesSelect id="order-item-payment" name="paymentMethod" value={filters.paymentMethod ?? ''} options={[{ value: '', label: '전체' }, { value: 'card', label: '카드' }, { value: 'bank_transfer', label: '무통장' }]} /></SalesFilterField>
    </SalesFilterPanel>
    <div className="admin-sales-results">
      <SalesResultsHeader currentHref={currentHref} total={data.total} unit="개 상품주문" pageSize={pageSize} sort={filters.sort ?? 'newest'}
        sortOptions={[{ value: 'newest', label: '최근순' }, { value: 'oldest', label: '과거순' }, { value: 'amount_high', label: '상품금액 높은순' }, { value: 'amount_low', label: '상품금액 낮은순' }]}>
        <AdminListExportButton href={adminListExportHref('orders', currentHref)} total={data.total} />
      </SalesResultsHeader>
      <p className="admin-order-items-counts">조회 조건에 맞는 상품주문 {data.total.toLocaleString('ko-KR')}개 · 주문 {data.orderCount.toLocaleString('ko-KR')}건 · 수량 {data.qty.toLocaleString('ko-KR')}개</p>
      <ConsoleGrid caption="상품주문 목록" preferencesKey="sales-order-items" columns={columns} selectable={canManage}
        selectedIds={selection} onSelectionChange={setSelected} emptyLabel="검색 조건에 맞는 상품주문이 없습니다."
        rows={data.rows.map(row => ({ id: row.id, selectable: eligible.has(row.id), selectLabel: `상품주문 ${row.productOrderNumber ?? row.id} 선택`, cells: [
          <Link key="item" className="mono" href={`${adminOrderDetailHrefFromBack(row.orderId, currentHref)}#item-${row.id}`} target="_blank" rel="noopener noreferrer">{row.productOrderNumber ?? row.id}</Link>,
          <Link key="order" className="mono" href={adminOrderDetailHrefFromBack(row.orderId, currentHref)} target="_blank" rel="noopener noreferrer">{orderReferenceLabel(row.orderId, row.orderNumber)}</Link>,
          <span key="status" className={`order-status order-status--${row.status}`}>{ADMIN_ORDER_STATUS_LABELS[row.status]}</span>,
          formatOrderDateTime(row.createdAt), row.goodName,
          <div key="variant" className="admin-order-items-meta">{row.variantName ?? '기본 옵션'}<small>{row.variantCode ?? ''}</small><GoodsCustomInputsSummary selection={row.customInputs} /></div>,
          row.qty, formatKrwExact(row.unitPrice), formatKrwExact(row.itemAmount), row.buyerName, row.recipientName ?? '—',
          <div key="shipment" className="admin-order-items-meta">{row.originName ?? '출고지 미연결'}<small>{({ ready: '발송대기', shipping: '배송중', delivered: '배송완료', canceled: '취소' } as Record<string, string>)[row.shipmentStatus ?? ''] ?? ''}</small><small>{row.carrierLabel} {row.trackingNumber}</small></div>,
          row.claim ? (canManage ? <Link key="claim" href={`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[row.claim.type]}/${row.claim.id}`}>{ORDER_CLAIM_TYPE_LABELS[row.claim.type]} · {ORDER_CLAIM_STAGE_LABELS[row.claim.stage]}</Link> : `${ORDER_CLAIM_TYPE_LABELS[row.claim.type]} · ${ORDER_CLAIM_STAGE_LABELS[row.claim.stage]}`) : '—',
          <Link key="detail" href={adminOrderDetailHrefFromBack(row.orderId, currentHref)}>{canManage ? '전체 상세·처리' : '전체 상세'}</Link>,
        ] }))}>
        {canManage ? <div className="admin-sales-workbar"><span>{selection.length}개 상품주문 · {orderIds.length}개 주문 선택</span>
          <button type="button" className="wc-admin-kit__button" disabled={pending || !orderIds.length} onClick={confirm}>선택 주문 전체 발주확인</button>
          <span>같은 주문의 다른 품목도 함께 처리됩니다.</span></div> : null}
      </ConsoleGrid>
      {message ? <p role="status">{message}</p> : null}{error ? <p className="admin-error" role="alert">{error}</p> : null}
      <ConsolePagination label="상품주문 목록 페이지" page={filters.page} pageSize={pageSize} total={data.total} hrefForPage={page => adminOrderItemsHref(filters, { page })} />
    </div>
  </section>;
}
