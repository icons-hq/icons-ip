'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleChipTone,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_CATALOG_NEW_RECORD,
  ADMIN_CATALOG_PAGE_SIZES,
  ADMIN_GOOD_LIST_PATH,
  ADMIN_GOOD_LIST_TAB_LABELS,
  ADMIN_GOOD_LIST_TABS,
  ADMIN_GOOD_SEARCH_FIELDS,
  ADMIN_GOOD_STOCK_OPTIONS,
  adminGoodListHref,
  type AdminGoodList,
  type AdminGoodListFilters,
  type AdminGoodListRow,
  type AdminGoodSortKey,
  type AdminGoodStatus,
} from '@/lib/admin/catalog-list';
import { GOOD_TYPES } from '@/lib/goods-taxonomy';
import { RecordThumbnail } from '../fields';
import { ColumnPicker, useColumnVisibility, type CatalogColumnOption } from './ColumnPicker';

/*
 * 굿즈 목록 콘솔.
 *
 * 판매·CS 콘솔의 목록 문법(필터 패널 → 상태 칩 → 그리드 → 페이지)을 카탈로그에 그대로
 * 가져왔다. 조건은 전부 URL에 있고, 행의 첫 칸을 누르면 `?selected=`로 편집 화면이 된다.
 * 일괄 처리(보관·엑셀)는 다음 슬라이스다 — 자리를 비워 두면 운영자가 "왜 안 되지"를
 * 찾게 되므로 준비되기 전에는 체크박스도 그리지 않는다.
 */

const COLUMNS: (ConsoleGridColumn & CatalogColumnOption)[] = [
  { key: 'id', label: '굿즈', locked: true, sortable: true, defaultDirection: 'asc', width: '220px' },
  { key: 'name', label: '이름', locked: true, sortable: true, defaultDirection: 'asc' },
  { key: 'ip', label: 'IP', sortable: true, defaultDirection: 'asc', width: '150px' },
  { key: 'type', label: '유형', width: '110px' },
  { key: 'price', label: '판매가', align: 'end', sortable: true, width: '110px' },
  { key: 'stockQty', label: '재고', align: 'end', sortable: true, width: '120px' },
  { key: 'badge', label: '배지', width: '96px' },
  { key: 'bankTransfer', label: '무통장', width: '80px' },
  { key: 'status', label: '상태', width: '100px' },
];

const COLUMN_STORAGE_KEY = 'icons-admin.catalog.goods.columns';

const STATUS_TONES: Record<AdminGoodStatus, ConsoleChipTone> = {
  selling: 'success',
  low: 'warning',
  soldout: 'danger',
  archived: 'default',
};

function statusBadge(status: AdminGoodStatus) {
  const className = status === 'selling'
    ? 'admin-badge'
    : status === 'archived'
      ? 'admin-badge admin-badge--muted'
      : 'admin-badge admin-badge--warn';
  return (
    <span className={className} data-good-status={status}>
      {ADMIN_GOOD_LIST_TAB_LABELS[status]}
    </span>
  );
}

function stockCell(row: AdminGoodListRow) {
  const { stock, stockQty } = row.good;
  return (
    <span className="admin-catalog-stock">
      <strong className="mono">{stockQty.toLocaleString('ko-KR')}개</strong>
      <span className="muted">{stock}</span>
    </span>
  );
}

function goodCells(row: AdminGoodListRow, editHref: string): Record<string, ReactNode> {
  const { good } = row;
  return {
    id: (
      <span className="admin-catalog-thumb-cell">
        {good.imageUrl ? <RecordThumbnail kind="good" url={good.imageUrl} /> : null}
        <span className="mono">{good.id}</span>
      </span>
    ),
    name: <Link className="admin-console-grid-link" href={editHref}>{good.name}</Link>,
    ip: <span>{row.ipTitle}</span>,
    type: <span>{good.type}</span>,
    price: (
      <span className="mono">
        ₩{good.price.toLocaleString('ko-KR')}
        {good.compareAtPrice ? <><br /><s className="muted">₩{good.compareAtPrice.toLocaleString('ko-KR')}</s></> : null}
      </span>
    ),
    stockQty: stockCell(row),
    badge: good.badge ? <span className="admin-badge">{good.badge}</span> : <span className="muted">-</span>,
    bankTransfer: good.allowBankTransfer ? <span>허용</span> : <span className="muted">차단</span>,
    status: statusBadge(row.tab),
  };
}

export function GoodConsole({
  filters,
  ipOptions,
  list,
  missingSelection = null,
}: {
  filters: AdminGoodListFilters;
  ipOptions: readonly { id: string; title: string; archivedAt: string | null }[];
  list: AdminGoodList;
  /** `?selected=`가 가리키는 굿즈가 없을 때 그 id. 목록이 빈 게 아니라 링크가 낡은 것임을 알린다. */
  missingSelection?: string | null;
}) {
  const { hidden, isVisible, toggle } = useColumnVisibility(COLUMN_STORAGE_KEY, COLUMNS);
  const columns = COLUMNS.filter((column) => isVisible(column.key));

  const chips = ADMIN_GOOD_LIST_TABS.map((tab) => ({
    label: ADMIN_GOOD_LIST_TAB_LABELS[tab],
    count: list.counts[tab],
    href: adminGoodListHref(filters, { tab, page: 1 }),
    active: filters.tab === tab,
    tone: tab === 'all' ? ('info' as const) : STATUS_TONES[tab],
  }));

  const rows: ConsoleGridRow[] = list.rows.map((row) => {
    const editHref = adminGoodListHref(filters, { selected: row.good.id });
    const cells = goodCells(row, editHref);
    return {
      id: row.good.id,
      href: editHref,
      cells: columns.map((column) => cells[column.key]),
    };
  });

  const hiddenFields = {
    ...(filters.tab !== 'all' ? { tab: filters.tab } : {}),
    ...(filters.sort ? { sort: filters.sort, dir: filters.dir } : {}),
  };

  return (
    <section aria-label="굿즈 목록" className="admin-console">
      <div className="admin-catalog-toolbar">
        <ConsoleCountChips chips={chips} label="상태별 굿즈 수" />
        <div className="admin-catalog-toolbar-actions">
          <ColumnPicker columns={COLUMNS} hidden={hidden} idPrefix="admin-good-columns" onToggle={toggle} />
          <Link className="btn btn-sm btn-holo" href={adminGoodListHref(filters, { selected: ADMIN_CATALOG_NEW_RECORD })}>
            + 새로 등록
          </Link>
        </div>
      </div>

      {missingSelection ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>
          <span className="mono">{missingSelection}</span> 굿즈를 찾지 못했습니다. 삭제되었거나 링크가 낡았을 수 있습니다.
        </p>
      ) : null}

      <ConsoleFilterPanel
        action={ADMIN_GOOD_LIST_PATH}
        hiddenFields={hiddenFields}
        idPrefix="admin-good-filter"
        resetHref={ADMIN_GOOD_LIST_PATH}
        search={{
          fieldName: 'field',
          fieldValue: filters.field,
          fields: ADMIN_GOOD_SEARCH_FIELDS,
          placeholder: '굿즈 이름 · ID · IP',
          value: filters.query,
        }}
        statusFilter={{ label: '재고', name: 'stock', options: ADMIN_GOOD_STOCK_OPTIONS, value: filters.stock }}
      >
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-good-filter-ip">IP</label>
          <select defaultValue={filters.ip} id="admin-good-filter-ip" name="ip">
            <option value="">전체</option>
            {ipOptions.map((ip) => (
              <option key={ip.id} value={ip.id}>{ip.archivedAt ? `[보관] ${ip.title}` : ip.title}</option>
            ))}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-good-filter-type">유형</label>
          <select defaultValue={filters.type} id="admin-good-filter-type" name="type">
            <option value="">전체</option>
            {GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-good-filter-size">페이지 크기</label>
          <select defaultValue={String(filters.size)} id="admin-good-filter-size" name="size">
            {ADMIN_CATALOG_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}건</option>)}
          </select>
        </div>
      </ConsoleFilterPanel>

      <ConsoleGrid
        caption="굿즈 목록"
        columns={columns}
        emptyLabel="조건에 맞는 굿즈가 없습니다."
        rows={rows}
        sort={filters.sort ? { key: filters.sort, direction: filters.dir } : null}
        sortHrefFor={(key, direction) => adminGoodListHref(filters, {
          dir: direction,
          page: 1,
          sort: key as AdminGoodSortKey,
        })}
      />

      <ConsolePagination
        hrefForPage={(page) => adminGoodListHref(filters, { page })}
        label="굿즈 목록 페이지"
        page={list.page}
        pageSize={list.size}
        total={list.total}
      />
    </section>
  );
}
