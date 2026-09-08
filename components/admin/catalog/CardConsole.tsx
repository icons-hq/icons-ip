'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_CARD_LIST_PATH,
  ADMIN_CARD_LIST_TAB_LABELS,
  ADMIN_CARD_LIST_TABS,
  ADMIN_CATALOG_NEW_RECORD,
  ADMIN_CATALOG_PAGE_SIZES,
  adminCardListHref,
  type AdminCardList,
  type AdminCardListFilters,
  type AdminCardListRow,
  type AdminCardSortKey,
} from '@/lib/admin/catalog-list';
import { RARITY_ORDER } from '@/lib/rarity';
import { RecordThumbnail } from '../fields';
import { ColumnPicker, useColumnVisibility, type CatalogColumnOption } from './ColumnPicker';

/*
 * 카드 목록 콘솔 (규모 후속).
 *
 * 카드는 IP 와 카드풀 아래에 달린다 — 목록에서 「어느 IP·어느 풀」이 먼저 보여야 하고,
 * 그 두 칸은 그 IP·풀로 좁힌 목록으로 이어진다. 서버가 한 페이지만 자른다.
 */
const COLUMNS: (ConsoleGridColumn & CatalogColumnOption)[] = [
  { key: 'id', label: '카드', locked: true, sortable: true, defaultDirection: 'asc', width: '220px' },
  { key: 'name', label: '이름', locked: true, sortable: true, defaultDirection: 'asc' },
  { key: 'no', label: '번호', sortable: true, width: '110px' },
  { key: 'rarity', label: '등급', sortable: true, width: '90px' },
  { key: 'ip', label: 'IP', width: '160px' },
  { key: 'pool', label: '카드풀', width: '160px' },
  { key: 'status', label: '상태', width: '100px' },
];
const COLUMN_STORAGE_KEY = 'icons-admin.catalog.cards.columns';

function cardCells(row: AdminCardListRow, filters: AdminCardListFilters, editHref: string): Record<string, ReactNode> {
  const { card } = row;
  return {
    id: (
      <span className="admin-catalog-thumb-cell">
        <RecordThumbnail kind="card" url={card.imageUrl ?? ''} />
        {/* 첫 셀은 표가 행 링크로 감싼다 — 여기 또 링크를 두면 <a> 안의 <a> 가 되어 hydration 이 깨진다. */}
        <span className="mono">{card.id}</span>
      </span>
    ),
    name: <Link href={editHref}>{card.name}</Link>,
    no: <span className="mono">{card.no ?? '-'}</span>,
    rarity: <span className="admin-badge">{card.rarity}</span>,
    ip: <Link href={adminCardListHref(filters, { ip: card.ipId, page: 1 })}>{row.ipTitle}</Link>,
    pool: card.poolId
      ? <Link href={adminCardListHref(filters, { pool: card.poolId, page: 1 })}>{row.poolName ?? card.poolId}</Link>
      : <span className="muted">-</span>,
    status: row.tab === 'archived'
      ? <span className="admin-badge admin-badge--muted">보관</span>
      : <span className="admin-badge">운영 중</span>,
  };
}

export function CardConsole({
  filters,
  list,
  missingSelection = null,
}: {
  filters: AdminCardListFilters;
  list: AdminCardList;
  missingSelection?: string | null;
}) {
  const { hidden, isVisible, toggle } = useColumnVisibility(COLUMN_STORAGE_KEY, COLUMNS);
  const columns = COLUMNS.filter((column) => isVisible(column.key));
  const chips = ADMIN_CARD_LIST_TABS.map((tab) => ({
    label: ADMIN_CARD_LIST_TAB_LABELS[tab],
    count: list.counts[tab],
    href: adminCardListHref(filters, { tab, page: 1 }),
    active: filters.tab === tab,
    tone: tab === 'active' ? ('success' as const) : ('default' as const),
  }));
  const rows: ConsoleGridRow[] = list.rows.map((row) => {
    const editHref = adminCardListHref(filters, { selected: row.card.id });
    const cells = cardCells(row, filters, editHref);
    return { id: row.card.id, href: editHref, cells: columns.map((column) => cells[column.key]) };
  });
  /* IP·풀 좁힘은 목록 링크에서 온다 — 검색 폼이 그 조건을 잃지 않게 숨김 칸으로 나른다. */
  const hiddenFields = {
    ...(filters.tab !== 'all' ? { tab: filters.tab } : {}),
    ...(filters.ip ? { ip: filters.ip } : {}),
    ...(filters.pool ? { pool: filters.pool } : {}),
    ...(filters.sort ? { sort: filters.sort, dir: filters.dir } : {}),
  };

  return (
    <section aria-label="카드 목록" className="admin-console">
      <div className="admin-catalog-toolbar">
        <ConsoleCountChips chips={chips} label="상태별 카드 수" />
        <div className="admin-catalog-toolbar-actions">
          <ColumnPicker columns={COLUMNS} hidden={hidden} idPrefix="admin-card-columns" onToggle={toggle} />
          <Link className="btn btn-sm btn-holo" href={adminCardListHref(filters, { selected: ADMIN_CATALOG_NEW_RECORD })}>
            + 새로 등록
          </Link>
        </div>
      </div>
      {missingSelection ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>
          <span className="mono">{missingSelection}</span> 카드를 찾지 못했습니다. 삭제되었거나 링크가 낡았을 수 있습니다.
        </p>
      ) : null}
      {filters.ip || filters.pool ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>
          {filters.ip ? <>IP <span className="mono">{filters.ip}</span></> : null}
          {filters.ip && filters.pool ? ' · ' : ''}
          {filters.pool ? <>카드풀 <span className="mono">{filters.pool}</span></> : null}
          {' '}로 좁혀 보는 중 — <Link href={adminCardListHref(filters, { ip: '', pool: '', page: 1 })}>전체 보기</Link>
        </p>
      ) : null}
      <ConsoleFilterPanel
        action={ADMIN_CARD_LIST_PATH}
        hiddenFields={hiddenFields}
        idPrefix="admin-card-filter"
        resetHref={ADMIN_CARD_LIST_PATH}
        search={{ placeholder: '카드 이름 · ID · 번호', value: filters.query }}
      >
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-card-filter-rarity">등급</label>
          <select defaultValue={filters.rarity} id="admin-card-filter-rarity" name="rarity">
            <option value="">전체</option>
            {RARITY_ORDER.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-card-filter-size">페이지 크기</label>
          <select defaultValue={String(filters.size)} id="admin-card-filter-size" name="size">
            {ADMIN_CATALOG_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}건</option>)}
          </select>
        </div>
      </ConsoleFilterPanel>
      <ConsoleGrid
        caption="카드 목록"
        columns={columns}
        emptyLabel="조건에 맞는 카드가 없습니다."
        rows={rows}
        sort={filters.sort ? { key: filters.sort, direction: filters.dir } : null}
        sortHrefFor={(key, direction) => adminCardListHref(filters, { dir: direction, page: 1, sort: key as AdminCardSortKey })}
      />
      <ConsolePagination
        hrefForPage={(page) => adminCardListHref(filters, { page })}
        label="카드 목록 페이지"
        page={list.page}
        pageSize={list.size}
        total={list.total}
      />
    </section>
  );
}
