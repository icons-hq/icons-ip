'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { ConsoleTableSettings } from '@/components/admin/kit/console-table-settings';
import { useGridPreferences } from './AdminPreferences';

export type ConsoleSortDirection = 'asc' | 'desc';

export interface ConsoleGridSort {
  key: string;
  direction: ConsoleSortDirection;
}

export interface ConsoleGridColumn {
  /** 컬럼 식별자. 정렬 파라미터 값으로도 쓴다. */
  key: string;
  label: string;
  /** 셀 정렬. 금액·수량은 `'end'`. 기본 `'start'`. */
  align?: 'start' | 'end';
  /** 헤더를 정렬 링크로 만든다. `sortHref` 또는 `sortHrefFor` 중 하나가 있어야 실제 링크가 된다. */
  sortable?: boolean;
  /** 고정 폭. `<col>`에 그대로 들어간다. 예: `'120px'`, `'12%'`. */
  width?: string;
  /** 조회항목 설정에서도 항상 표시한다. 첫 번째 식별 열은 자동으로 필수다. */
  required?: boolean;
  defaultVisible?: boolean;
  /**
   * 정렬 링크 href를 미리 계산해 넘기는 통로. 서버 컴포넌트에서 그리드를 쓸 때 사용한다
   * (함수 prop은 서버 → 클라이언트 경계를 넘지 못한다).
   */
  sortHref?: string;
  /** 이 컬럼을 처음 눌렀을 때 향할 방향. 기본 `'desc'`. */
  defaultDirection?: ConsoleSortDirection;
}

export interface ConsoleGridRow {
  /** 행 식별자. 선택 체크박스의 값이자 React key. */
  id: string;
  /** 컬럼 순서에 맞춘 셀. 서버 컴포넌트에서 미리 만들어 넘긴다. */
  cells: ReactNode[];
  /** 상세로 가는 링크. 첫 번째 셀이 이 링크로 감싸진다. */
  href?: string;
  /** `false`면 이 행은 일괄 선택 대상에서 빠진다. 기본 `true`. */
  selectable?: boolean;
  /** 체크박스 접근성 이름. 기본 `'{id} 선택'`. */
  selectLabel?: string;
}

export interface ConsoleGridProps {
  columns: ConsoleGridColumn[];
  rows: ConsoleGridRow[];
  /** 표의 접근성 이름. 시각적으로는 숨는다. 예: `'주문 목록'`. */
  caption: string;
  /** 행이 없을 때 문구. 기본 `'조건에 맞는 항목이 없습니다.'`. */
  emptyLabel?: string;
  /** 행 선택 체크박스와 전체선택 체크박스를 켠다. */
  selectable?: boolean;
  /** 선택 상태를 바깥에서 통제할 때 넘긴다. 주면 controlled, 안 주면 내부 상태를 쓴다. */
  selectedIds?: string[];
  /** uncontrolled 초기 선택. */
  defaultSelectedIds?: string[];
  /** 선택이 바뀔 때마다 호출된다. 클라이언트 부모만 넘길 수 있다. */
  onSelectionChange?: (selectedIds: string[]) => void;
  /**
   * 선택된 id를 hidden input으로 함께 렌더할 때의 `name`.
   * 그리드를 `<form>`으로 감싸면 별도 배선 없이 server action이 선택 목록을 받는다.
   */
  selectionName?: string;
  /** 현재 정렬. `null`이면 정렬 없음. */
  sort?: ConsoleGridSort | null;
  /** 정렬 링크 href 생성기. 클라이언트 부모에서만 쓸 수 있다. 서버에서는 `column.sortHref`를 쓴다. */
  sortHrefFor?: (key: string, direction: ConsoleSortDirection) => string;
  /** 표 위에 붙일 슬롯. 일괄 액션 바를 여기에 넣는다. */
  children?: ReactNode;
  className?: string;
  /** 계정별 조회항목 설정의 안정된 키. 생략하면 caption을 쓴다. */
  preferencesKey?: string;
  /** 간단한 보조 표에는 조회항목 설정을 생략할 수 있다. */
  configurable?: boolean;
}

/**
 * 헤더를 눌렀을 때 향할 정렬 방향.
 *
 * 이미 그 컬럼으로 정렬 중이면 방향을 뒤집고, 아니면 `fallback`(기본 내림차순)으로 간다.
 * 콘솔 목록의 기본 관심사는 최신순이라 첫 클릭 기본값이 내림차순이다.
 */
export function nextSortDirection(
  sort: ConsoleGridSort | null | undefined,
  key: string,
  fallback: ConsoleSortDirection = 'desc',
): ConsoleSortDirection {
  if (!sort || sort.key !== key) return fallback;
  return sort.direction === 'asc' ? 'desc' : 'asc';
}

const SORT_DIRECTION_LABELS: Record<ConsoleSortDirection, string> = {
  asc: '오름차순',
  desc: '내림차순',
};

/**
 * 콘솔 목록 그리드.
 *
 * 정렬은 서버 정렬 전제의 링크로만 처리한다(현재 정렬 키·방향을 받아 반대 방향 href를
 * 만든다). 행 선택만 클라이언트 상태라서 이 컴포넌트 하나가 `'use client'`다.
 *
 * 선택과 일괄 액션을 함께 쓰는 페이지는 얇은 클라이언트 래퍼를 하나 두고 선택 배열을
 * 잡는다. 그리드는 선택을 hidden input으로도 내보내므로 폼 제출은 그대로 동작한다.
 *
 * @example
 * <form action={bulkAction}>
 *   <ConsoleGrid
 *     caption="주문 목록"
 *     columns={columns}
 *     onSelectionChange={setSelected}
 *     rows={rows}
 *     selectable
 *     selectionName="orderIds"
 *   >
 *     <ConsoleBulkActionBar actions={actions} selectedCount={selected.length} />
 *   </ConsoleGrid>
 * </form>
 */
export function ConsoleGrid({
  caption,
  children,
  className,
  columns,
  configurable = true,
  defaultSelectedIds,
  emptyLabel = '조건에 맞는 항목이 없습니다.',
  onSelectionChange,
  preferencesKey,
  rows,
  selectable = false,
  selectedIds,
  selectionName,
  sort,
  sortHrefFor,
}: ConsoleGridProps) {
  const [internalSelection, setInternalSelection] = useState<string[]>(defaultSelectedIds ?? []);
  const selection = selectedIds ?? internalSelection;
  const selected = new Set(selection);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const { preferences, save } = useGridPreferences(preferencesKey ?? caption, columns);
  const indexes = configurable
    ? preferences.order.filter((key) => !preferences.hidden.includes(key)).map((key) => columns.findIndex((column) => column.key === key))
    : columns.map((_, index) => index);
  const visibleColumns = indexes.map((index) => columns[index]);
  const frozenCount = configurable ? preferences.frozenCount : 0;
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const layoutKey = visibleColumns.map((column) => column.key).join('|');

  useEffect(() => {
    if (!frozenCount || !tableRef.current) return;
    const table = tableRef.current;
    const measure = () => {
      const widths = Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) => cell.getBoundingClientRect().width);
      setColumnWidths((previous) => previous.length === widths.length && previous.every((width, index) => width === widths[index]) ? previous : widths);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) observer.observe(cell);
    return () => observer.disconnect();
  }, [frozenCount, layoutKey, selectable]);

  function frozenStyle(index: number) {
    if (!frozenCount || index >= frozenCount + (selectable ? 1 : 0)) return undefined;
    return { left: columnWidths.slice(0, index).reduce((total, width) => total + width, 0) };
  }

  const selectableIds = rows.filter((row) => row.selectable !== false).map((row) => row.id);
  const selectedOnPage = selectableIds.filter((id) => selected.has(id));
  const allSelected = selectableIds.length > 0 && selectedOnPage.length === selectableIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

  /* 부분 선택은 HTML 속성이 아니라 DOM 프로퍼티라 마크업으로 표현할 수 없다. */
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function commit(next: string[]) {
    if (!selectedIds) setInternalSelection(next);
    onSelectionChange?.(next);
  }

  function toggleRow(id: string, checked: boolean) {
    if (checked) {
      if (selected.has(id)) return;
      commit([...selection, id]);
      return;
    }
    commit(selection.filter((current) => current !== id));
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      const merged = new Set(selection);
      for (const id of selectableIds) merged.add(id);
      commit([...merged]);
      return;
    }
    /* 다른 페이지에서 고른 선택까지 지우지 않는다. 현재 페이지 행만 뺀다. */
    const pageIds = new Set(selectableIds);
    commit(selection.filter((id) => !pageIds.has(id)));
  }

  const columnCount = visibleColumns.length + (selectable ? 1 : 0);
  const hasWidths = visibleColumns.some((column) => column.width);
  /* 인쇄에서는 고정 칸이 흐름 배치로 돌아간다 — 종이에는 가로 스크롤이 없다. */
  const frozenCellClass = 'data-[frozen]:sticky data-[frozen]:z-10 print:data-[frozen]:static';

  /*
   * kit 표 모양(components/admin/kit/ui/table.tsx의 클래스, ADR-0028). 표는 화면 고유 CSS가 닿지 않게 kit 부품
   * 표시(data-slot)를 단다. 체크박스는 폼 제출(선택 hidden input)과 단위 테스트를 위해 네이티브 그대로 두고
   * kit 체크박스 모양을 입는다(admin-kit-vocabulary.css). 고정 열은 불투명 배경이라 가로 스크롤 아래가 비치지 않는다.
   */
  return (
    <div className={`${className ? `${className} ` : ''}flex min-w-0 flex-col gap-2`} data-console-grid="">
      {children}
      {configurable ? <div className="flex justify-end"><ConsoleTableSettings columns={columns} onSave={save} preferences={preferences} /></div> : null}
      <div aria-label={`${caption} 가로 스크롤`} className="@container relative min-w-0 overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50" role="region" tabIndex={0}>
        <table className="w-full caption-bottom text-sm" data-slot="table" ref={tableRef}>
          <caption className="sr-only">{caption}</caption>
          {hasWidths ? (
            <colgroup>
              {selectable ? <col className="w-10" /> : null}
              {visibleColumns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
          ) : null}
          <thead className="[&_tr]:border-b" data-slot="table-header">
            <tr className="border-b bg-muted/50" data-slot="table-row">
              {selectable ? (
                <th className={`relative h-10 w-10 min-w-10 bg-muted p-0 align-middle ${frozenCellClass}`} data-frozen={frozenCount > 0 || undefined} data-slot="table-head" style={frozenStyle(0)} scope="col">
                  {/* 칸 전체가 클릭 영역이다(label이 칸을 채운다). */}
                  <label className="absolute inset-0 flex cursor-pointer items-center justify-center print:static"><input
                    aria-label="전체 선택"
                    checked={allSelected}
                    disabled={selectableIds.length === 0}
                    onChange={(event) => toggleAll(event.target.checked)}
                    ref={selectAllRef}
                    type="checkbox"
                  /></label>
                </th>
              ) : null}
              {visibleColumns.map((column, displayIndex) => {
                const active = sort?.key === column.key;
                const direction = nextSortDirection(sort, column.key, column.defaultDirection);
                const href = column.sortable
                  ? column.sortHref ?? sortHrefFor?.(column.key, direction)
                  : undefined;
                const SortIcon = active ? (sort?.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

                return (
                  <th
                    aria-sort={column.sortable
                      ? active
                        ? sort?.direction === 'asc' ? 'ascending' : 'descending'
                        : 'none'
                      : undefined}
                    className={`h-10 bg-muted px-3 text-left align-middle text-xs font-semibold whitespace-nowrap text-secondary-foreground data-[align=end]:text-right ${frozenCellClass}`}
                    data-align={column.align ?? 'start'}
                    data-frozen={displayIndex < frozenCount || undefined}
                    data-slot="table-head"
                    style={{ ...frozenStyle(displayIndex + (selectable ? 1 : 0)), ...(column.width ? { minWidth: column.width } : null) }}
                    key={column.key}
                    scope="col"
                  >
                    {href ? (
                      <Link
                        aria-label={`${column.label} ${SORT_DIRECTION_LABELS[direction]} 정렬`}
                        className="-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[active]:text-foreground"
                        data-active={active || undefined}
                        data-direction={active ? sort?.direction : undefined}
                        href={href}
                      >
                        {column.label}
                        <SortIcon aria-hidden="true" className={`size-3.5${active ? '' : ' opacity-50'}`} />
                      </Link>
                    ) : column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0" data-slot="table-body">
            {rows.length === 0 ? (
              <tr data-slot="table-row">
                <td className="h-24 p-0 text-center align-middle text-muted-foreground" colSpan={columnCount} data-slot="table-cell">
                  {/* 표가 보이는 폭보다 넓어도 문구는 보이는 폭(스크롤 영역 = 크기 질의 컨테이너) 가운데에 남는다. */}
                  <div className="sticky left-0 flex h-24 w-[100cqw] items-center justify-center px-4">
                    {emptyLabel}
                  </div>
                </td>
              </tr>
            ) : rows.map((row) => {
              const rowSelectable = row.selectable !== false;
              const rowSelected = selected.has(row.id);

              return (
                <tr
                  className="group/row border-b transition-colors hover:bg-primary-soft/40 data-[state=selected]:bg-primary-soft"
                  data-selected={rowSelected ? 'true' : undefined}
                  data-slot="table-row"
                  data-state={rowSelected ? 'selected' : undefined}
                  key={row.id}
                >
                  {selectable ? (
                    <td className={`relative w-10 min-w-10 bg-card p-0 align-middle group-hover/row:bg-[color-mix(in_oklab,var(--primary-soft)_40%,var(--card))] group-data-[state=selected]/row:bg-primary-soft ${frozenCellClass}`} data-frozen={frozenCount > 0 || undefined} data-slot="table-cell" style={frozenStyle(0)}>
                      {rowSelectable ? (
                        <label className="absolute inset-0 flex cursor-pointer items-center justify-center print:static"><input
                          aria-label={row.selectLabel ?? `${row.id} 선택`}
                          checked={rowSelected}
                          onChange={(event) => toggleRow(row.id, event.target.checked)}
                          type="checkbox"
                          value={row.id}
                        /></label>
                      ) : null}
                    </td>
                  ) : null}
                  {indexes.map((index, displayIndex) => {
                    const cell = row.cells[index];
                    const column = columns[index];
                    const frozen = displayIndex < frozenCount;
                    return (
                      <td
                        className={`px-3 py-2 align-middle break-keep data-[align=end]:text-right data-[align=end]:tabular-nums ${frozen ? `bg-card group-hover/row:bg-[color-mix(in_oklab,var(--primary-soft)_40%,var(--card))] group-data-[state=selected]/row:bg-primary-soft ${frozenCellClass}` : ''}`}
                        data-align={column?.align ?? 'start'}
                        data-frozen={frozen || undefined}
                        data-slot="table-cell"
                        style={frozenStyle(displayIndex + (selectable ? 1 : 0))}
                        key={column?.key ?? `cell-${index}`}
                      >
                        {/* 표에서는 행 전체를 링크로 만들 수 없다. 첫 셀만 상세 링크가 된다. */}
                        {index === 0 && row.href ? (
                          <Link className="font-medium text-primary underline-offset-4 hover:underline" href={row.href}>{cell}</Link>
                        ) : cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectionName
        ? selection.map((id) => (
          <input key={id} name={selectionName} type="hidden" value={id} />
        ))
        : null}
    </div>
  );
}
