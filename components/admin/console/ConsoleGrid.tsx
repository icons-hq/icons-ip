'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  defaultSelectedIds,
  emptyLabel = '조건에 맞는 항목이 없습니다.',
  onSelectionChange,
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

  const columnCount = columns.length + (selectable ? 1 : 0);
  const hasWidths = columns.some((column) => column.width);

  return (
    <div className={`${className ? `${className} ` : ''}admin-console-grid`}>
      {children}
      <div className="admin-console-grid-scroll">
        <table className="admin-console-grid-table">
          <caption className="admin-console-grid-caption">{caption}</caption>
          {hasWidths ? (
            <colgroup>
              {selectable ? <col className="admin-console-grid-check-col" /> : null}
              {columns.map((column) => (
                <col key={column.key} style={column.width ? { width: column.width } : undefined} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr>
              {selectable ? (
                <th className="admin-console-grid-check" scope="col">
                  <input
                    aria-label="전체 선택"
                    checked={allSelected}
                    disabled={selectableIds.length === 0}
                    onChange={(event) => toggleAll(event.target.checked)}
                    ref={selectAllRef}
                    type="checkbox"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const direction = nextSortDirection(sort, column.key, column.defaultDirection);
                const href = column.sortable
                  ? column.sortHref ?? sortHrefFor?.(column.key, direction)
                  : undefined;

                return (
                  <th
                    aria-sort={column.sortable
                      ? active
                        ? sort?.direction === 'asc' ? 'ascending' : 'descending'
                        : 'none'
                      : undefined}
                    data-align={column.align ?? 'start'}
                    key={column.key}
                    scope="col"
                  >
                    {href ? (
                      <Link
                        aria-label={`${column.label} ${SORT_DIRECTION_LABELS[direction]} 정렬`}
                        className={`admin-console-grid-sort${active ? ' on' : ''}`}
                        data-direction={active ? sort?.direction : undefined}
                        href={href}
                      >
                        {column.label}
                        <span aria-hidden="true" className="admin-console-grid-sort-mark">
                          {active ? (sort?.direction === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </Link>
                    ) : column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="admin-console-grid-empty" colSpan={columnCount}>
                  <p className="muted">{emptyLabel}</p>
                </td>
              </tr>
            ) : rows.map((row) => {
              const rowSelectable = row.selectable !== false;
              const rowSelected = selected.has(row.id);

              return (
                <tr data-selected={rowSelected ? 'true' : undefined} key={row.id}>
                  {selectable ? (
                    <td className="admin-console-grid-check">
                      {rowSelectable ? (
                        <input
                          aria-label={row.selectLabel ?? `${row.id} 선택`}
                          checked={rowSelected}
                          onChange={(event) => toggleRow(row.id, event.target.checked)}
                          type="checkbox"
                          value={row.id}
                        />
                      ) : null}
                    </td>
                  ) : null}
                  {row.cells.map((cell, index) => {
                    const column = columns[index];
                    return (
                      <td
                        data-align={column?.align ?? 'start'}
                        key={column?.key ?? `cell-${index}`}
                      >
                        {/* 표에서는 행 전체를 링크로 만들 수 없다. 첫 셀만 상세 링크가 된다. */}
                        {index === 0 && row.href ? (
                          <Link className="admin-console-grid-link" href={row.href}>{cell}</Link>
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
