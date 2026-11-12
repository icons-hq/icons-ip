"use client";

import {
  type Cell,
  type ColumnPinningPosition,
  FlexRender,
  type Header,
  type ReactTable,
  type Row,
  type RowData,
  Subscribe,
  type TableState,
} from "@tanstack/react-table";
import { cn } from "cn";
import * as React from "react";

import { StickyTableHead, useStickyTableHead } from "@/components/admin/console/StickyTableHead"
import { useHorizontalOverflow } from "@/components/admin/console/useHorizontalOverflow"
import type { DataTableFeatures } from "@/components/admin/kit/lib/data-table-features";

import {
  getAriaSort,
  getColumnPinningStyle,
  getColumnSizingStyle,
  getVisibleSelectedRows,
} from "@/components/admin/kit/lib/data-table-utils";
import { DataTablePagination } from "@/components/admin/kit/data-table/data-table-pagination";
import { useDirection } from "@/components/admin/kit/ui/direction";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/kit/ui/table";

interface DataTableProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  actionBar?: React.ReactNode;
  /** Shown in the body when the page has no rows. */
  emptyLabel?: React.ReactNode;
  /** Rendered above the pager — the console keeps its own pager next to the export controls. */
  pagination?: React.ReactNode;
}

export function DataTable<TData extends RowData>({
  table,
  actionBar,
  emptyLabel = "결과가 없습니다.",
  pagination,
  children,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: DataTableProps<TData>) {
  const dir = useDirection();

  return (
    <div
      data-slot="data-table"
      dir={dir}
      className={cn("flex w-full flex-col gap-2.5 overflow-auto", className)}
      {...props}
    >
      {children}
      {/* ICONS: 크기 질의 컨테이너는 가로 스크롤 영역에 둔다(DataTableLayout) — 고정 머리글(position: fixed)이 컨테이너 안에 갇히지 않는다. */}
      <div className="isolate overflow-hidden rounded-md border">
        <DataTableLayout
          table={table}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          <DataTableHeader table={table} />
          <DataTableBody table={table} emptyLabel={emptyLabel} />
        </DataTableLayout>
      </div>
      <div className="flex flex-col gap-2.5">
        {pagination === undefined ? <DataTablePagination table={table} /> : pagination}
        {actionBar ? (
          <DataTableActionBar table={table} actionBar={actionBar} />
        ) : null}
      </div>
    </div>
  );
}

interface DataTableLayoutProps<TData extends RowData> extends Pick<
  React.ComponentProps<"table">,
  "aria-label" | "aria-labelledby"
> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  children: React.ReactNode;
}

function DataTableLayout<TData extends RowData>({
  table,
  children,
  ...props
}: DataTableLayoutProps<TData>) {
  /* ICONS: 가로로 넘치는 표는 스크롤 영역이 포커스를 받아야 키보드(화살표)로 옆으로 옮긴다. kit Table과 같은
     클래스에 region·tabIndex·안쪽 포커스 링만 더한다(바깥 테두리 상자가 overflow-hidden이라 링을 안쪽에 그린다). */
  const regionLabel = props["aria-label"] ? `${props["aria-label"]} 가로 스크롤` : undefined;
  const { ref: overflowRef, more: overflowMore } = useHorizontalOverflow<HTMLDivElement>();
  const tableRef = React.useRef<HTMLTableElement>(null);
  /* ICONS: 머리글 고정(ADM-009) — 복제 머리글을 상단 막대 아래에 얹는다. */
  const { cloneScrollRef, metrics } = useStickyTableHead(overflowRef, tableRef);
  return (
    <table.Subscribe selector={selectLayoutState}>
      {() => (
        <div className="relative w-full">
        {overflowMore ? <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-30 w-10 bg-gradient-to-l from-foreground/10 to-transparent print:hidden" data-console-grid-more="" /> : null}
        <StickyTableHead
          cloneScrollRef={cloneScrollRef}
          metrics={metrics}
          scrollRef={overflowRef}
          tableClassName="w-full table-fixed caption-bottom text-sm"
          tableStyle={getColumnSizingStyle(table)}
        >
          <DataTableHeaderRows table={table} />
        </StickyTableHead>
        <div
          aria-label={regionLabel}
          aria-labelledby={regionLabel ? undefined : props["aria-labelledby"]}
          className="@container relative w-full overflow-x-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          data-slot="table-container"
          ref={overflowRef}
          role="region"
          tabIndex={0}
        >
          <table
            className="w-full table-fixed caption-bottom text-sm"
            data-slot="table"
            ref={tableRef}
            style={getColumnSizingStyle(table)}
            {...props}
          >
            {children}
          </table>
        </div>
        </div>
      )}
    </table.Subscribe>
  );
}

interface DataTableHeaderProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
}

function DataTableHeader<TData extends RowData>({
  table,
}: DataTableHeaderProps<TData>) {
  return (
    <TableHeader>
      <DataTableHeaderRows table={table} />
    </TableHeader>
  );
}

/* ICONS: 머리글 행만 — 진짜 머리글과 고정용 복제 머리글이 같은 행을 그린다. */
function DataTableHeaderRows<TData extends RowData>({
  table,
}: DataTableHeaderProps<TData>) {
  return (
    <table.Subscribe selector={selectHeaderState}>
      {() =>
        table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="group/row">
            {headerGroup.headers.map((header) => (
              <DataTableHeadCell
                key={header.id}
                header={header}
                pinned={header.column.getIsPinned()}
              />
            ))}
          </TableRow>
        ))
      }
    </table.Subscribe>
  );
}

interface DataTableHeadCellProps<TData extends RowData> {
  header: Header<DataTableFeatures, TData>;
  pinned: ColumnPinningPosition;
}

function DataTableHeadCell<TData extends RowData>({
  header,
  pinned,
}: DataTableHeadCellProps<TData>) {
  return (
    <Subscribe
      source={header.column.table.atoms.sorting}
      selector={(sorting) => getAriaSort(sorting, header.column.id)}
    >
      {(ariaSort) => (
        <TableHead
          aria-sort={ariaSort}
          colSpan={header.colSpan}
          className={getCellClassName(pinned)}
          style={getColumnPinningStyle(header.column, pinned)}
        >
          {header.isPlaceholder ? null : <FlexRender header={header} />}
        </TableHead>
      )}
    </Subscribe>
  );
}

function getCellClassName(pinned: ColumnPinningPosition) {
  return pinned
    ? "overflow-hidden bg-background transition-colors group-hover/row:bg-[color-mix(in_srgb,var(--primary-soft)_40%,var(--background))] group-has-aria-expanded/row:bg-[color-mix(in_srgb,var(--primary-soft)_40%,var(--background))] group-data-[state=selected]/row:bg-primary-soft"
    : "overflow-hidden";
}

interface DataTableBodyProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  emptyLabel: React.ReactNode;
}

function DataTableBody<TData extends RowData>({
  table,
  emptyLabel,
}: DataTableBodyProps<TData>) {
  const rows = table.getRowModel().rows;

  if (!rows.length) {
    return (
      <Subscribe source={table.atoms.columnVisibility}>
        {() => (
          <TableBody>
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length || 1}
                className="h-24 p-0 text-center"
              >
                {/* ICONS: 표가 보이는 폭보다 넓어도 문구가 가로 스크롤 전체 폭이 아니라 보이는 폭 가운데에 남는다. */}
                <div className="sticky left-0 flex h-24 w-[100cqw] items-center justify-center px-4 whitespace-normal">
                  {emptyLabel}
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        )}
      </Subscribe>
    );
  }

  return (
    <TableBody>
      {rows.map((row) => (
        <DataTableRow key={row.id} row={row} />
      ))}
    </TableBody>
  );
}

interface DataTableActionBarProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  actionBar: React.ReactNode;
}

function DataTableActionBar<TData extends RowData>({
  table,
  actionBar,
}: DataTableActionBarProps<TData>) {
  return (
    <table.Subscribe selector={() => getVisibleSelectedRows(table).length > 0}>
      {(hasVisibleSelectedRows) => (hasVisibleSelectedRows ? actionBar : null)}
    </table.Subscribe>
  );
}

interface DataTableRowProps<TData extends RowData> {
  row: Row<DataTableFeatures, TData>;
}

const DataTableRow = React.memo(DataTableRowImpl) as typeof DataTableRowImpl;

function DataTableRowImpl<TData extends RowData>({
  row,
}: DataTableRowProps<TData>) {
  return (
    <Subscribe
      source={row.table.store}
      selector={(state) => ({
        columnOrder: state.columnOrder,
        columnPinning: state.columnPinning,
        columnVisibility: state.columnVisibility,
        isSelected: state.rowSelection[row.id] === true,
      })}
    >
      {({ isSelected }) => (
        <TableRow
          data-state={isSelected ? "selected" : undefined}
          className="group/row"
        >
          {row.getVisibleCells().map((cell) => (
            <DataTableCell
              key={cell.id}
              cell={cell}
              pinned={cell.column.getIsPinned()}
            />
          ))}
        </TableRow>
      )}
    </Subscribe>
  );
}

interface DataTableCellProps<TData extends RowData> {
  cell: Cell<DataTableFeatures, TData>;
  pinned: ColumnPinningPosition;
}

const DataTableCell = React.memo(DataTableCellImpl) as typeof DataTableCellImpl;

function DataTableCellImpl<TData extends RowData>({
  cell,
  pinned,
}: DataTableCellProps<TData>) {
  return (
    <TableCell
      className={getCellClassName(pinned)}
      style={getColumnPinningStyle(cell.column, pinned)}
    >
      <FlexRender cell={cell} />
    </TableCell>
  );
}

function selectLayoutState(state: TableState<DataTableFeatures>) {
  return {
    columnOrder: state.columnOrder,
    columnPinning: state.columnPinning,
    columnSizing: state.columnSizing,
    columnVisibility: state.columnVisibility,
  };
}

function selectHeaderState(state: TableState<DataTableFeatures>) {
  return {
    columnOrder: state.columnOrder,
    columnPinning: state.columnPinning,
    columnVisibility: state.columnVisibility,
  };
}
