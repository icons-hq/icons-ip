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
  ADMIN_CATALOG_NEW_RECORD,
  ADMIN_CATALOG_PAGE_SIZES,
  ADMIN_IP_LIST_PATH,
  ADMIN_IP_LIST_TAB_LABELS,
  ADMIN_IP_LIST_TABS,
  adminIpListHref,
  type AdminIpList,
  type AdminIpListFilters,
  type AdminIpListRow,
  type AdminIpSortKey,
} from '@/lib/admin/catalog-list';
import { RecordThumbnail } from '../fields';
import { ColumnPicker, useColumnVisibility, type CatalogColumnOption } from './ColumnPicker';

/*
 * IP 목록 콘솔. IP는 카탈로그의 첫 필터이자 굿즈가 태어나는 자리라, 목록에서
 * "이 IP에 굿즈가 몇 개 살아 있는지"가 먼저 보여야 한다. 굿즈 수 칸은 굿즈 목록의
 * IP 필터로 이어진다.
 */

const COLUMNS: (ConsoleGridColumn & CatalogColumnOption)[] = [
  { key: 'id', label: 'IP', locked: true, sortable: true, defaultDirection: 'asc', width: '220px' },
  { key: 'title', label: '이름', locked: true, sortable: true, defaultDirection: 'asc' },
  { key: 'vertical', label: '버티컬', width: '120px' },
  { key: 'goods', label: '굿즈', align: 'end', sortable: true, width: '120px' },
  { key: 'fans', label: '팬', align: 'end', sortable: true, width: '100px' },
  { key: 'featured', label: '대표', width: '80px' },
  { key: 'status', label: '상태', width: '100px' },
];

const COLUMN_STORAGE_KEY = 'icons-admin.catalog.ips.columns';

function ipCells(row: AdminIpListRow, editHref: string): Record<string, ReactNode> {
  const { ip } = row;
  return {
    id: (
      <span className="admin-catalog-thumb-cell">
        {ip.imageUrl ? <RecordThumbnail kind="ip" url={ip.imageUrl} /> : null}
        <span className="mono">{ip.id}</span>
      </span>
    ),
    title: <Link className="admin-console-grid-link" href={editHref}>{ip.title}</Link>,
    vertical: <span>{row.verticalLabel}</span>,
    goods: (
      <Link className="mono" href={`/admin/catalog/goods?ip=${encodeURIComponent(ip.id)}`}>
        {row.activeGoodsCount.toLocaleString('ko-KR')}
        {row.goodsCount !== row.activeGoodsCount ? (
          <span className="muted"> / {row.goodsCount.toLocaleString('ko-KR')}</span>
        ) : null}
      </Link>
    ),
    fans: <span className="mono">{ip.fansCount.toLocaleString('ko-KR')}</span>,
    featured: ip.featured ? <span className="admin-badge">대표</span> : <span className="muted">-</span>,
    status: row.tab === 'archived'
      ? <span className="admin-badge admin-badge--muted" data-ip-status="archived">보관</span>
      : <span className="admin-badge" data-ip-status="active">운영 중</span>,
  };
}

export function IpConsole({
  filters,
  list,
  missingSelection = null,
  verticals,
}: {
  filters: AdminIpListFilters;
  list: AdminIpList;
  missingSelection?: string | null;
  verticals: readonly { key: string; label: string }[];
}) {
  const { hidden, isVisible, toggle } = useColumnVisibility(COLUMN_STORAGE_KEY, COLUMNS);
  const columns = COLUMNS.filter((column) => isVisible(column.key));

  const chips = ADMIN_IP_LIST_TABS.map((tab) => ({
    label: ADMIN_IP_LIST_TAB_LABELS[tab],
    count: list.counts[tab],
    href: adminIpListHref(filters, { tab, page: 1 }),
    active: filters.tab === tab,
    tone: tab === 'active' ? ('success' as const) : ('default' as const),
  }));

  const rows: ConsoleGridRow[] = list.rows.map((row) => {
    const editHref = adminIpListHref(filters, { selected: row.ip.id });
    const cells = ipCells(row, editHref);
    return {
      id: row.ip.id,
      href: editHref,
      cells: columns.map((column) => cells[column.key]),
    };
  });

  const hiddenFields = {
    ...(filters.tab !== 'all' ? { tab: filters.tab } : {}),
    ...(filters.sort ? { sort: filters.sort, dir: filters.dir } : {}),
  };

  return (
    <section aria-label="IP 목록" className="admin-console">
      <div className="admin-catalog-toolbar">
        <ConsoleCountChips chips={chips} label="상태별 IP 수" />
        <div className="admin-catalog-toolbar-actions">
          <ColumnPicker columns={COLUMNS} hidden={hidden} idPrefix="admin-ip-columns" onToggle={toggle} />
          <Link className="btn btn-sm btn-holo" href={adminIpListHref(filters, { selected: ADMIN_CATALOG_NEW_RECORD })}>
            + 새로 등록
          </Link>
        </div>
      </div>

      {missingSelection ? (
        <p className="muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>
          <span className="mono">{missingSelection}</span> IP를 찾지 못했습니다. 삭제되었거나 링크가 낡았을 수 있습니다.
        </p>
      ) : null}

      <ConsoleFilterPanel
        action={ADMIN_IP_LIST_PATH}
        hiddenFields={hiddenFields}
        idPrefix="admin-ip-filter"
        resetHref={ADMIN_IP_LIST_PATH}
        search={{ placeholder: 'IP 이름 · ID', value: filters.query }}
      >
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-ip-filter-vertical">버티컬</label>
          <select defaultValue={filters.vertical} id="admin-ip-filter-vertical" name="vertical">
            <option value="">전체</option>
            {verticals.map((vertical) => (
              <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
            ))}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-ip-filter-size">페이지 크기</label>
          <select defaultValue={String(filters.size)} id="admin-ip-filter-size" name="size">
            {ADMIN_CATALOG_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}건</option>)}
          </select>
        </div>
      </ConsoleFilterPanel>

      <ConsoleGrid
        caption="IP 목록"
        columns={columns}
        emptyLabel="조건에 맞는 IP가 없습니다."
        rows={rows}
        sort={filters.sort ? { key: filters.sort, direction: filters.dir } : null}
        sortHrefFor={(key, direction) => adminIpListHref(filters, {
          dir: direction,
          page: 1,
          sort: key as AdminIpSortKey,
        })}
      />

      <ConsolePagination
        hrefForPage={(page) => adminIpListHref(filters, { page })}
        label="IP 목록 페이지"
        page={list.page}
        pageSize={list.size}
        total={list.total}
      />
    </section>
  );
}
