'use client';

import {
  functionalUpdate,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnPinningState,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type ColumnVisibilityState as VisibilityState,
  type RowData,
} from '@tanstack/react-table';
import { useRouter } from 'next/navigation';
import { useMemo, useOptimistic, useTransition } from 'react';
import { useGridPreferences } from '@/components/admin/console/AdminPreferences';
import type { GridPreferenceColumn } from '@/lib/admin/grid-preferences';
import { dataTableFeatures, type DataTableFeatures } from '@/components/admin/kit/lib/data-table-features';

/*
 * Server-driven console table: the adapter between the Dice UI data table and our URL contract.
 *
 * Dice UI's own `useDataTable` keeps page, sort and filters in the URL with nuqs under its own
 * keys and formats (`perPage`, `sort=col.desc`, one param per column). The console already has a
 * URL contract per screen — `adminClaimHref` and friends — that the server normalizes, that the
 * list export, the `?claimId=` preview and the `?back=` detail link reuse, and that operators share
 * as links. Two URL vocabularies for one list would split those. So the table never writes the URL
 * itself: its state is whatever the server rendered (`state`), each change goes through
 * `hrefFor(next)` — the screen's own href builder — and the server re-renders the page.
 *
 * `useOptimistic` shows the requested page/sort/filter at once while the server renders it, and
 * falls back to the server's state when the navigation settles (a filter the server rejects snaps
 * back instead of lying).
 *
 * Column order, visibility and frozen columns stay in the existing per-account grid preferences
 * (`useGridPreferences`), so an operator's saved layout from the old grid carries over.
 */

export interface ConsoleTableState {
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
}

export function useConsoleTable<TData extends RowData>({
  columns,
  data,
  enableRowSelection,
  getRowId,
  hrefFor,
  onRowSelectionChange,
  pageCount,
  preferenceColumns,
  preferencesKey,
  rowSelection,
  state,
}: {
  columns: ColumnDef<DataTableFeatures, TData>[];
  data: TData[];
  enableRowSelection?: (row: Row<DataTableFeatures, TData>) => boolean;
  getRowId: (row: TData) => string;
  /** The screen's href for a table state. Returning null keeps the current page (an unsupported sort, say). */
  hrefFor: (next: ConsoleTableState) => string | null;
  onRowSelectionChange?: (next: RowSelectionState) => void;
  pageCount: number;
  /** Columns as the grid preferences know them (first column and `required` cannot be hidden). */
  preferenceColumns: readonly GridPreferenceColumn[];
  preferencesKey: string;
  rowSelection?: RowSelectionState;
  state: ConsoleTableState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(state);
  const { preferences, save } = useGridPreferences(preferencesKey, preferenceColumns);

  const columnVisibility = useMemo<VisibilityState>(
    () => Object.fromEntries(preferences.hidden.map((key) => [key, false])),
    [preferences.hidden],
  );
  const columnOrder = useMemo<ColumnOrderState>(() => ['select', ...preferences.order], [preferences.order]);
  const columnPinning = useMemo<ColumnPinningState>(() => {
    const visible = preferences.order.filter((key) => !preferences.hidden.includes(key));
    return { start: ['select', ...visible.slice(0, preferences.frozenCount)], end: [] };
  }, [preferences.frozenCount, preferences.hidden, preferences.order]);

  function navigate(next: ConsoleTableState) {
    const href = hrefFor(next);
    if (!href) return;
    startTransition(() => {
      setShown(next);
      router.push(href, { scroll: false });
    });
  }

  function onPaginationChange(updater: Updater<PaginationState>) {
    const pagination = functionalUpdate(updater, shown.pagination);
    /* A new page size starts again from the first page, like the old pager. */
    navigate({ ...shown, pagination: pagination.pageSize !== shown.pagination.pageSize ? { ...pagination, pageIndex: 0 } : pagination });
  }
  function onSortingChange(updater: Updater<SortingState>) {
    navigate({ ...shown, sorting: functionalUpdate(updater, shown.sorting), pagination: { ...shown.pagination, pageIndex: 0 } });
  }
  function onColumnFiltersChange(updater: Updater<ColumnFiltersState>) {
    navigate({ ...shown, columnFilters: functionalUpdate(updater, shown.columnFilters), pagination: { ...shown.pagination, pageIndex: 0 } });
  }
  function onColumnVisibilityChange(updater: Updater<VisibilityState>) {
    const next = functionalUpdate(updater, columnVisibility);
    const required = new Set(preferenceColumns.filter((column, index) => index === 0 || column.required).map((column) => column.key));
    save({ ...preferences, hidden: preferences.order.filter((key) => next[key] === false && !required.has(key)) });
  }

  const table = useTable({
    columns,
    data,
    features: dataTableFeatures,
    /* Console RPCs take one sort (`p_sort`). Dice UI's header menu asks for multi-sort
       (`toggleSorting(desc, true)`), which would append behind the current sort and change nothing. */
    enableMultiSort: false,
    enableRowSelection: enableRowSelection ?? false,
    getRowId,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    onColumnFiltersChange,
    onColumnVisibilityChange,
    onPaginationChange,
    onRowSelectionChange: onRowSelectionChange
      ? (updater) => onRowSelectionChange(functionalUpdate(updater, rowSelection ?? {}))
      : undefined,
    onSortingChange,
    pageCount,
    state: {
      columnFilters: shown.columnFilters,
      columnOrder,
      columnPinning,
      columnVisibility,
      pagination: shown.pagination,
      rowSelection: rowSelection ?? {},
      sorting: shown.sorting,
    },
  });

  /* The screen's 조회항목 설정 (ConsoleTableSettings) edits the same preferences: order and frozen columns. */
  return { pending, preferences, savePreferences: save, table };
}
