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
import { Button } from '@/components/admin/kit/ui/button';
import { OrderStatusBadge } from '@/components/admin/sales/OrderStatusBadge';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { adminClaimStageLabel } from '@/lib/admin/claims';
import { adminListExportHref } from '@/lib/admin/list-export';
import { adminOrderItemsHref, orderItemBuyerLabel, selectedConfirmableOrderIds, type AdminOrderItemData } from '@/lib/admin/order-items';
import { shipmentStatusLabel, type ShipmentStatus } from '@/lib/orders/shipments';
import type { OrderItemAllocation } from '@/lib/admin/item-allocation';
import { adminOrderDetailHrefFromBack, ADMIN_ORDER_SEARCH_FIELDS, ADMIN_ORDER_STATUSES, ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { adminOrderPreviewHref } from '@/lib/admin/order-preview';
import { OrderPreviewLink, OrderPreviewNewTabLink } from './OrderPreview';
import { SALES_DATE_FIELDS } from '@/lib/admin/sales-list';
import { formatOrderDateTime, orderReferenceLabel } from '@/lib/orders';
import { isOpenOrderClaimStage, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';
import { adminConfirm } from '@/lib/admin/confirm';

const fields = [...ADMIN_ORDER_SEARCH_FIELDS, { value: 'item', label: '상품주문번호' }];
const statuses = [{ value: 'all', label: '전체 상태' }, ...ADMIN_ORDER_STATUSES.map(value => ({ value, label: ADMIN_ORDER_STATUS_LABELS[value] }))];
/* 상품주문별 조회 — 템플릿 룩(ADR-0028). 열 구성·처리 동선은 그대로이고 셀 보조 줄은 유틸리티로 그린다. */
const META_CLASS = 'flex flex-col gap-0.5 [&_small]:text-xs [&_small]:text-muted-foreground';
const columns: ConsoleGridColumn[] = [
  { key: 'item', label: '상품주문번호', width: '190px', required: true }, { key: 'order', label: '주문번호', width: '190px', required: true },
  { key: 'status', label: '주문상태', width: '100px' }, { key: 'created', label: '주문일시', width: '160px' },
  { key: 'good', label: '상품명', width: '240px' }, { key: 'variant', label: '옵션 / 옵션코드', width: '180px' },
  { key: 'qty', label: '수량', width: '65px', align: 'end' }, { key: 'unitPrice', label: '단가', width: '100px', align: 'end' },
  { key: 'amount', label: '상품금액', width: '120px', align: 'end' },
  { key: 'allocation', label: '할인·적립금 배분', width: '170px', align: 'end' }, { key: 'paid', label: '배분 후 금액', width: '120px', align: 'end' },
  { key: 'buyer', label: '구매자명', width: '110px' },
  { key: 'recipient', label: '수취인명', width: '110px' }, { key: 'shipment', label: '출고지 / 배송', width: '180px' },
  { key: 'claim', label: '취소·반품·교환', width: '140px' }, { key: 'action', label: '주문 전체 상세', width: '120px' },
];
/** 품목에 나눈 할인 합계와 구성. 나눌 수 없는 주문은 —로 둔다. */
const PARTIAL_COLUMNS: ConsoleGridColumn[] = columns.flatMap(column => column.key === 'qty'
  ? [column, { key: 'canceledQty', label: '취소 수량', width: '80px', align: 'end' as const }] : [column]);
function OrderItemAllocationCell({ allocation }: { allocation?: OrderItemAllocation | null }) {
  if (!allocation) return <>—</>;
  const total = allocation.couponDiscount + allocation.storeCreditDiscount + allocation.volumeDiscount;
  return <div className={META_CLASS}>{total ? `−${formatKrwExact(total)}` : formatKrwExact(0)}
    <small>쿠폰 {formatKrwExact(allocation.couponDiscount)} · 적립금 {formatKrwExact(allocation.storeCreditDiscount)}{allocation.volumeDiscount ? ` · 복수구매 ${formatKrwExact(allocation.volumeDiscount)}` : ''}</small></div>;
}
export function OrderItemsScreen({ data, canManage }: { data: AdminOrderItemData; canManage: boolean }) {
  const router = useRouter(); const [selected, setSelected] = useState<string[]>([]); const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const { filters } = data; const currentHref = adminOrderItemsHref(filters); const pageSize = filters.pageSize ?? 20;
  const eligible = new Set(data.rows.filter(row => canManage && row.status === 'paid' && (!row.claim || !isOpenOrderClaimStage(row.claim.stage))).map(row => row.id));
  const selection = selected.filter(id => eligible.has(id));
  const orderIds = selectedConfirmableOrderIds(data.rows, selection);
  /** 재고 부족 부분 취소가 있는 상품주문이 있을 때만 '취소 수량' 열을 둔다(수량·상품금액·배분 후 금액은 남은 몫). */
  const partial = data.rows.some(row => row.partialCancel);
  async function confirm() {
    if (pending || !orderIds.length || !await adminConfirm(`선택한 상품주문이 포함된 주문 전체 ${orderIds.length}건을 발주확인할까요? 선택하지 않은 같은 주문의 품목도 함께 처리됩니다.`)) return;
    setError(''); setMessage('');
    startTransition(async () => {
      try {
        const form = new FormData(); orderIds.forEach(id => form.append('orderIds', id));
        const result = await bulkConfirmAdminOrdersAction({}, form);
        setError(result.errors?.form ?? ''); setMessage(result.message ?? ''); setSelected([]); router.refresh();
      } catch { setError('처리 결과를 확인하지 못했습니다. 주문 전체의 최신 상태를 확인해주세요.'); router.refresh(); }
    });
  }
  return <section className="flex min-w-0 flex-col gap-4 text-sm" data-admin-order-items="">
    <OrderViewTabs filters={filters} view="items" />
    <SalesGuide title="상품주문별 번호·옵션·수량과 연결된 주문·배송을 확인합니다.">
      <p>상품주문번호는 주문에 포함된 개별 품목의 고유 번호입니다. 같은 주문번호가 여러 행에 표시될 수 있습니다. 상품명·옵션은 주문 당시 기록이며 현재 상품 정보로 바뀌지 않습니다.</p>
      <p>상품금액은 주문 당시 단가 × 수량입니다. 주문 쿠폰·적립금·복수구매 할인은 거래확정 엑셀과 같은 규칙으로 품목에 나눠 배분 후 금액(배송비 제외)에 표시합니다. 주문 당시 기록이 없어 나눌 수 없으면 —로 둡니다. 취소·반품은 주문 전체·전액으로 처리합니다.</p>
      {partial ? <p>취소 수량은 재고 부족 부분 취소로 뺀 수량입니다. 그 행의 수량·상품금액·배분 후 금액은 남은 몫이고, 할인·적립금 배분은 주문 당시 값입니다.</p> : null}
    </SalesGuide>
    <SalesStatusSummary label="상품주문 처리 단계" items={statuses.map(option => ({ label: option.label, active: filters.status === option.value, tone: option.value === 'paid' ? 'warning' as const : undefined,
      count: option.value === 'all' ? Object.values(data.counts).reduce((sum, value) => sum + value, 0) : data.counts[option.value as keyof typeof data.counts],
      href: adminOrderItemsHref(filters, { status: option.value as typeof filters.status, page: 1 }) }))} />
    <SalesFilterPanel currentHref={currentHref} resetHref="/admin/sales/orders?view=items" id="order-items"
      date={{ from: filters.from, to: filters.to, field: filters.dateField ?? 'ordered', options: SALES_DATE_FIELDS }}
      search={{ value: filters.query, field: filters.field, options: fields, placeholder: '상품주문 · 주문 · 상품명 · 옵션 · 구매자 · 송장', fitsOrderNumber: true }}>
      <SalesFilterField label="주문상태" htmlFor="order-item-status"><SalesSelect id="order-item-status" name="status" value={filters.status} options={statuses} /></SalesFilterField>
      <SalesFilterField label="결제수단" htmlFor="order-item-payment"><SalesSelect id="order-item-payment" name="paymentMethod" value={filters.paymentMethod ?? ''} options={[{ value: '', label: '전체' }, { value: 'card', label: '카드' }, { value: 'bank_transfer', label: '무통장' }]} /></SalesFilterField>
    </SalesFilterPanel>
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-sales-results="">
      <SalesResultsHeader currentHref={currentHref} total={data.total} unit="개 상품주문" pageSize={pageSize} sort={filters.sort ?? 'newest'}
        sortOptions={[{ value: 'newest', label: '최근순' }, { value: 'oldest', label: '과거순' }, { value: 'amount_high', label: '상품금액 높은순' }, { value: 'amount_low', label: '상품금액 낮은순' }]}>
        <AdminListExportButton href={adminListExportHref('orders', currentHref)} total={data.total} />
      </SalesResultsHeader>
      <p className="text-muted-foreground">조회 조건에 맞는 상품주문 {data.total.toLocaleString('ko-KR')}개 · 주문 {data.orderCount.toLocaleString('ko-KR')}건 · 수량 {data.qty.toLocaleString('ko-KR')}개</p>
      {/* 16열 표 — 옛 목록처럼 최소 폭을 두어 열이 눌려 글자가 세로로 쌓이지 않게 가로로 스크롤한다. */}
      <ConsoleGrid className="[&_table]:min-w-[2040px]" caption="상품주문 목록" preferencesKey="sales-order-items" columns={partial ? PARTIAL_COLUMNS : columns} selectable={canManage}
        selectedIds={selection} onSelectionChange={setSelected} emptyLabel="검색 조건에 맞는 상품주문이 없습니다."
        rows={data.rows.map(row => ({ id: row.id, selectable: eligible.has(row.id), selectLabel: `상품주문 ${row.productOrderNumber ?? row.id} 선택`, cells: [
          <Link key="item" className="font-medium tabular-nums underline-offset-4 hover:underline" href={`${adminOrderDetailHrefFromBack(row.orderId, currentHref)}#item-${row.id}`} target="_blank" rel="noopener noreferrer">{row.productOrderNumber ?? row.id}</Link>,
          /* S36-075: 주문번호는 같은 목록 위 상세 팝업을 연다. 새 탭 열기는 옆 보조 링크다(상품주문번호는 그 품목 위치로 새 탭을 연다). */
          <span key="order" className="inline-flex items-center gap-1"><OrderPreviewLink className="tabular-nums underline-offset-4 hover:underline" href={adminOrderPreviewHref(currentHref, row.orderId)}
            label={`주문 ${orderReferenceLabel(row.orderId, row.orderNumber)} 상세 팝업 열기`}>{orderReferenceLabel(row.orderId, row.orderNumber)}</OrderPreviewLink>
            <OrderPreviewNewTabLink href={adminOrderDetailHrefFromBack(row.orderId, currentHref)} label={`주문 ${orderReferenceLabel(row.orderId, row.orderNumber)} 상세 열기 (새 탭)`} /></span>,
          <OrderStatusBadge key="status" status={row.status} />,
          formatOrderDateTime(row.createdAt), row.goodName,
          <div key="variant" className={META_CLASS}>{row.variantName ?? '기본 옵션'}<small>{row.variantCode ?? ''}</small><GoodsCustomInputsSummary selection={row.customInputs} /></div>,
          row.partialCancel?.activeQty ?? row.qty,
          ...(partial ? [row.partialCancel ? <span key="canceled" className="tabular-nums text-destructive">{row.partialCancel.canceledQty}</span> : '—'] : []),
          formatKrwExact(row.unitPrice), formatKrwExact(row.partialCancel?.activeItemAmount ?? row.itemAmount),
          <OrderItemAllocationCell key="allocation" allocation={row.allocation} />, row.allocation ? formatKrwExact(row.allocation.paidGoodsTotal - (row.partialCancel?.paidAmount ?? 0)) : '—',
          orderItemBuyerLabel(row), row.recipientName ?? '—',
          <div key="shipment" className={META_CLASS}>{row.originName ?? '출고지 미연결'}{row.shipmentStatus ? <AdminStatusBadge tone={statusTone('shipment', row.shipmentStatus)}>{shipmentStatusLabel(row.shipmentStatus as ShipmentStatus) ?? ''}</AdminStatusBadge> : null}<small>{row.carrierLabel} {row.trackingNumber}</small>{row.extraTrackingNumbers?.map(number => <small className="tabular-nums" key={number}>추가 {number}</small>)}</div>,
          row.claim ? (canManage ? <Link key="claim" className="inline-flex flex-wrap items-center gap-1 underline-offset-4 hover:underline" href={`/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[row.claim.type]}/${row.claim.id}`}>{ORDER_CLAIM_TYPE_LABELS[row.claim.type]} <AdminStatusBadge tone={statusTone('claim', row.claim.stage)}>{adminClaimStageLabel(row.claim.type, row.claim.stage)}</AdminStatusBadge></Link> : <span key="claim" className="inline-flex flex-wrap items-center gap-1">{ORDER_CLAIM_TYPE_LABELS[row.claim.type]} <AdminStatusBadge tone={statusTone('claim', row.claim.stage)}>{adminClaimStageLabel(row.claim.type, row.claim.stage)}</AdminStatusBadge></span>) : '—',
          <Link key="detail" className="font-medium underline-offset-4 hover:underline" href={adminOrderDetailHrefFromBack(row.orderId, currentHref)}>{canManage ? '전체 상세·처리' : '전체 상세'}</Link>,
        ] }))}>
        {canManage ? <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 print:hidden" data-sales-workbar=""><span className="text-muted-foreground tabular-nums">{selection.length}개 상품주문 · {orderIds.length}개 주문 선택</span>
          <Button type="button" size="sm" disabled={pending || !orderIds.length} onClick={confirm}>선택 주문 전체 발주확인</Button>
          <span className="text-xs text-muted-foreground">체크칸은 발주확인할 수 있는 신규주문에만 있습니다. 같은 주문의 다른 품목도 함께 처리됩니다.</span></div> : null}
      </ConsoleGrid>
      {message ? <p className="text-success" role="status">{message}</p> : null}{error ? <p className="text-destructive" role="alert">{error}</p> : null}
      <ConsolePagination label="상품주문 목록 페이지" page={filters.page} pageSize={pageSize} total={data.total} hrefForPage={page => adminOrderItemsHref(filters, { page })} />
    </div>
  </section>;
}
