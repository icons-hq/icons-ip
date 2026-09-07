'use client';

import Link from 'next/link';
import { useActionState, type FormEvent, type ReactNode } from 'react';
import { setVariantStockBulkAction } from '@/app/admin/variant-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn, type ConsoleGridRow } from '@/components/admin/console';
import {
  ADMIN_INVENTORY_PAGE_SIZES,
  ADMIN_INVENTORY_PATH,
  STOCK_SOURCE_LABELS,
  adminInventoryHref,
  type AdminInventoryFilters,
  type AdminStockLocation,
} from '@/lib/admin/variants';
import type { AdminInventoryList, AdminInventoryRow } from '@/lib/admin/variants.server';
import { Icon } from '@/components/ui/Icon';
import { InlineNotice, TextArea } from '../fields';
import { SeededForm } from '@/components/admin/form-seed';

/*
 * 재고 관리(설계서 v2 §1-1 화면 4-4). 품목 × 출고지 한 행 — 보유·예약·가용·안전재고와 마지막 반영 출처.
 * 조건은 URL, 자르기는 RPC(admin_list_variant_stocks). 수량 변경은 굿즈 편집 화면의 「품목 · 재고」 카드가
 * 맡고, 여기서는 엑셀/창고 실적의 절대값 붙여넣기(D-4 엑셀 업로드의 전신)만 받는다.
 */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'good', label: '상품', width: '240px' },
  { key: 'variant', label: '품목' },
  { key: 'location', label: '출고지', width: '110px' },
  { key: 'onHand', label: '보유', align: 'end', width: '90px' },
  { key: 'reserved', label: '예약', align: 'end', width: '90px' },
  { key: 'available', label: '가용', align: 'end', width: '90px' },
  { key: 'safety', label: '안전', align: 'end', width: '80px' },
  { key: 'last', label: '마지막 반영', width: '170px' },
  { key: 'status', label: '상태', width: '120px' },
];

const emptyState: AdminCatalogActionState = {};

function formatDate(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function inventoryCells(row: AdminInventoryRow): ReactNode[] {
  const low = row.safety > 0 && row.available <= row.safety;
  const goodHref = `/admin/catalog/goods?selected=${encodeURIComponent(row.goodId)}`;
  return [
    <span className="col" key="good" style={{ gap: 2 }}>
      <Link className="admin-console-grid-link" href={goodHref}>{row.goodName}</Link>
      <span className="muted mono" style={{ fontSize: 11 }}>{row.goodId} · {row.ipTitle}</span>
    </span>,
    <span className="col" key="variant" style={{ gap: 2 }}>
      <span>{row.optionSummary || (row.isDefault ? '기본 품목' : '-')}</span>
      <span className="muted mono" style={{ fontSize: 11 }}>{row.variantCode}{row.customCode ? ` · ${row.customCode}` : ''}</span>
    </span>,
    <span key="location">{row.locationName}</span>,
    <span className="mono" key="onHand">{row.onHand.toLocaleString('ko-KR')}</span>,
    <span className="mono muted" key="reserved">{row.reserved.toLocaleString('ko-KR')}</span>,
    <span className={`mono${low ? ' admin-inventory-low' : ''}`} key="available">{row.available.toLocaleString('ko-KR')}</span>,
    <span className="mono muted" key="safety">{row.safety > 0 ? row.safety.toLocaleString('ko-KR') : '-'}</span>,
    <span className="col" key="last" style={{ gap: 2 }}>
      <span style={{ fontSize: 12 }}>{STOCK_SOURCE_LABELS[row.lastSource] ?? row.lastSource}</span>
      <span className="muted" style={{ fontSize: 11 }}>{formatDate(row.lastMovementAt)}{row.countedAt ? ` · 실사 ${formatDate(row.countedAt)}` : ''}</span>
    </span>,
    <span className="row" key="status" style={{ flexWrap: 'wrap', gap: 4 }}>
      {row.goodArchivedAt || row.variantArchivedAt ? <span className="admin-badge admin-badge--muted">보관</span> : null}
      {!row.sellable ? <span className="admin-badge admin-badge--muted">판매 안 함</span> : null}
      {!row.display ? <span className="admin-badge admin-badge--muted">미진열</span> : null}
      {low ? <span className="admin-badge">안전재고 이하</span> : null}
      {!row.goodArchivedAt && !row.variantArchivedAt && row.sellable && row.display && !low ? <span className="muted">-</span> : null}
    </span>,
  ];
}

function stampBatchId(event: FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem('batchId');
  if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
}

function BulkStockForm() {
  const [state, action, pending] = useActionState(setVariantStockBulkAction, emptyState);
  return (
    <SeededForm values={state.values} action={action} className="card col admin-inventory-bulk" onSubmit={stampBatchId} style={{ borderRadius: 10, gap: 10, padding: 16 }}>
      <div>
        <span className="eyebrow">BULK</span>
        <h2 style={{ fontSize: 16, margin: '6px 0 0' }}>수량 일괄 맞추기 (절대값)</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        한 줄에 하나 — <span className="mono">참조, 출고지, 보유수량, 안전재고</span>. 참조는 품목코드·자체 품목코드·상품 ID(옵션 없는 상품). 출고지와 안전재고는 생략할 수 있다.
        한 행이라도 틀리면 아무것도 반영하지 않는다.
      </p>
      <input name="batchId" type="hidden" value="" />
      <div className="admin-form-grid">
        <label className="admin-field">
          <span className="admin-field-label">출처</span>
          <select className="admin-field-control" defaultValue="excel" name="kind">
            <option value="excel">엑셀(수기)</option>
            <option value="wms">창고 실적</option>
          </select>
        </label>
      </div>
      <TextArea error={state.errors?.rows} label="행" name="rows" placeholder={'RED-S, gimpo, 30, 5\ng4, 12'} required />
      <InlineNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
        <Icon name="check" size={15} /> {pending ? '반영 중' : '수량 반영'}
      </button>
    </SeededForm>
  );
}

export function InventoryConsole({
  filters,
  list,
  locations,
}: {
  filters: AdminInventoryFilters;
  list: AdminInventoryList;
  locations: AdminStockLocation[];
}) {
  const rows: ConsoleGridRow[] = list.rows.map((row) => ({
    id: `${row.variantId}:${row.locationId}`,
    cells: inventoryCells(row),
  }));

  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">INVENTORY</span>
          <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>재고</h1>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>품목 × 출고지 {list.total.toLocaleString('ko-KR')}행</span>
      </div>

      <form action={ADMIN_INVENTORY_PATH} className="admin-console-filter card" method="get" style={{ borderRadius: 10, padding: 14 }}>
        <div className="admin-console-filter-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div className="admin-console-filter-field">
            <label className="admin-console-filter-label" htmlFor="admin-inventory-query">검색어</label>
            <input className="admin-field-control" defaultValue={filters.query} id="admin-inventory-query" name="query" placeholder="상품명 · 상품 ID · 품목코드 · 자체코드" />
          </div>
          <div className="admin-console-filter-field">
            <label className="admin-console-filter-label" htmlFor="admin-inventory-location">출고지</label>
            <select className="admin-field-control" defaultValue={filters.location} id="admin-inventory-location" name="location">
              <option value="">전체</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </div>
          <div className="admin-console-filter-field">
            <label className="admin-console-filter-label" htmlFor="admin-inventory-size">페이지 크기</label>
            <select className="admin-field-control" defaultValue={String(filters.size)} id="admin-inventory-size" name="size">
              {ADMIN_INVENTORY_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}건</option>)}
            </select>
          </div>
          <label className="admin-variant-value" style={{ paddingBottom: 8 }}>
            <input defaultChecked={filters.low} name="low" type="checkbox" value="1" /> 안전재고 이하만
          </label>
          <label className="admin-variant-value" style={{ paddingBottom: 8 }}>
            <input defaultChecked={filters.archived} name="archived" type="checkbox" value="1" /> 보관 포함
          </label>
          {filters.ip ? <input name="ip" type="hidden" value={filters.ip} /> : null}
          <button className="btn btn-sm btn-holo" type="submit">검색</button>
          <Link className="btn btn-sm btn-ghost" href={ADMIN_INVENTORY_PATH}>초기화</Link>
        </div>
      </form>

      <ConsoleGrid
        caption="품목 × 출고지 재고"
        columns={COLUMNS}
        emptyLabel="조건에 맞는 재고 행이 없습니다."
        rows={rows}
      />
      <ConsolePagination
        hrefForPage={(page) => adminInventoryHref(filters, { page })}
        page={list.page}
        pageSize={list.size}
        total={list.total}
      />
      <BulkStockForm />
    </div>
  );
}
