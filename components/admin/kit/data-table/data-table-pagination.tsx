"use client";

import type { ReactTable, RowData } from "@tanstack/react-table";

import { cn } from "cn";
import * as React from "react";

import type { DataTableFeatures } from "@/components/admin/kit/lib/data-table-features";

import { getVisibleSelectedRows } from "@/components/admin/kit/lib/data-table-utils";
import { Button } from "@/components/admin/kit/ui/button";
import { useDirection } from "@/components/admin/kit/ui/direction";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/admin/kit/ui/select";
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

interface DataTablePaginationProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = [10, 20, 30, 40, 50],
  className,
  ...props
}: DataTablePaginationProps<TData>) {
  return (
    <table.Subscribe
      selector={(state) => ({
        pageIndex: state.pagination.pageIndex,
        pageSize: state.pagination.pageSize,
        selectedRowCount: table.getSelectedRowIds().length,
        visibleSelectedRowCount: getVisibleSelectedRows(table).length,
      })}
    >
      {({ pageIndex, pageSize, selectedRowCount, visibleSelectedRowCount }) => (
        <DataTablePaginationContent
          table={table}
          pageIndex={pageIndex}
          pageSize={pageSize}
          selectedRowCount={selectedRowCount}
          visibleSelectedRowCount={visibleSelectedRowCount}
          pageSizeOptions={pageSizeOptions}
          className={className}
          {...props}
        />
      )}
    </table.Subscribe>
  );
}

interface DataTablePaginationContentProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  pageIndex: number;
  pageSize: number;
  selectedRowCount: number;
  visibleSelectedRowCount: number;
  pageSizeOptions: number[];
}

function DataTablePaginationContent<TData extends RowData>({
  table,
  pageIndex,
  pageSize,
  selectedRowCount,
  visibleSelectedRowCount,
  pageSizeOptions,
  className,
  ...props
}: DataTablePaginationContentProps<TData>) {
  const pageSizeLabelId = React.useId();
  const pageCount = table.getPageCount();
  const canPreviousPage = table.getCanPreviousPage();
  const canNextPage = table.getCanNextPage();
  const dir = useDirection();

  return (
    <div
      data-slot="data-table-pagination"
      className={cn(
        "flex w-full flex-col-reverse items-center justify-between gap-4 overflow-auto p-1 sm:flex-row sm:gap-8",
        className,
      )}
      {...props}
    >
      <div
        role="status"
        className="flex-1 text-sm whitespace-nowrap text-muted-foreground"
      >
        {selectedRowCount}건 선택
        {selectedRowCount > visibleSelectedRowCount
          ? ` (${selectedRowCount - visibleSelectedRowCount}건은 이 페이지 밖)`
          : ""}
      </div>
      <div className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:gap-6 lg:gap-8">
        <div className="flex items-center gap-2">
          <p
            id={pageSizeLabelId}
            className="text-sm font-medium whitespace-nowrap"
          >
            페이지당 행
          </p>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => {
              if (value == null) return;
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger aria-labelledby={pageSizeLabelId} className="w-18">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side="top" dir={dir}>
              <SelectGroup>
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div
          role="status"
          className="flex items-center justify-center text-sm font-medium"
        >
          {pageIndex + 1} / {Math.max(pageCount, 1)} 페이지
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="첫 페이지"
            variant="outline"
            size="icon"
            className="hidden lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!canPreviousPage}
          >
            <ChevronsLeft className="rtl:rotate-180" />
          </Button>
          <Button
            aria-label="이전 페이지"
            variant="outline"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!canPreviousPage}
          >
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <Button
            aria-label="다음 페이지"
            variant="outline"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!canNextPage}
          >
            <ChevronRight className="rtl:rotate-180" />
          </Button>
          <Button
            aria-label="마지막 페이지"
            variant="outline"
            size="icon"
            className="hidden lg:flex"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!canNextPage}
          >
            <ChevronsRight className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
