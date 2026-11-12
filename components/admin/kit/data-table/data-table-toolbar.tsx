"use client";

import {
  type Column,
  type ReactTable,
  type RowData,
  Subscribe,
} from "@tanstack/react-table";
import { cn } from "cn";
import * as React from "react";

import type { DataTableFeatures } from "@/components/admin/kit/lib/data-table-features";

import {
  getColumnSelectOptions,
  getFilterVariant,
} from "@/components/admin/kit/lib/data-table-utils";
import { DataTableDateFilter } from "@/components/admin/kit/data-table/data-table-date-filter";
import { DataTableFacetedFilter } from "@/components/admin/kit/data-table/data-table-faceted-filter";
import { DataTableSliderFilter } from "@/components/admin/kit/data-table/data-table-slider-filter";
import { DataTableViewOptions } from "@/components/admin/kit/data-table/data-table-view-options";
import { Button } from "@/components/admin/kit/ui/button";
import { Input } from "@/components/admin/kit/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/admin/kit/ui/input-group";
import { X } from "lucide-react";

interface DataTableToolbarProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  /** ICONS: 열 필터 바로 뒤(초기화 앞)에 둘 화면 고유 조회 요소 — 기간 기준·기간 프리셋 등. */
  filtersEnd?: React.ReactNode;
  /** ICONS: 열 표시 팝오버 대신 둘 열 설정 — 순서·틀고정까지 다루는 조회항목 설정(ConsoleTableSettings). */
  viewOptions?: React.ReactNode;
  /** ICONS: 열 필터가 초안일 때(조회는 [검색]) 툴바 안 초기화 버튼을 감춘다 — 초기화는 조회 조건 카드의 몫이다. */
  hideReset?: boolean;
  /** ICONS: 툴바 칩 대신 화면이 라벨 붙은 조회 칸으로 따로 그리는 열 id. 열 필터 값은 그대로 같은 table이 든다. */
  hideFilters?: readonly string[];
}

export function DataTableToolbar<TData extends RowData>({
  table,
  children,
  className,
  filtersEnd,
  hideReset = false,
  hideFilters,
  viewOptions,
  ...props
}: DataTableToolbarProps<TData>) {
  const columns = React.useMemo(
    () => table.getAllColumns().filter((column) => column.getCanFilter()),
    [table],
  );

  function onReset() {
    table.resetColumnFilters(true);
    table.resetJoinOperator(true);
  }

  return (
    <div
      data-slot="data-table-toolbar"
      className={cn(
        "flex w-full items-start justify-between gap-2 p-1",
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {columns.filter((column) => !hideFilters?.includes(column.id)).map((column) => (
          <DataTableToolbarFilter key={column.id} column={column} />
        ))}
        {filtersEnd}
        <Subscribe
          source={table.atoms.columnFilters}
          selector={(filters) => filters.length > 0}
        >
          {(isFiltered) =>
            isFiltered && !hideReset && (
              <Button
                aria-label="필터 초기화"
                variant="outline"
                onClick={onReset}
              >
                <X
                />
                초기화
              </Button>
            )
          }
        </Subscribe>
      </div>
      <div className="flex items-center gap-2">
        {children}
        {viewOptions ?? <DataTableViewOptions table={table} align="end" />}
      </div>
    </div>
  );
}

interface DataTableToolbarFilterProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData>;
}

function DataTableToolbarFilter<TData extends RowData>({
  column,
}: DataTableToolbarFilterProps<TData>) {
  const columnMeta = column.columnDef.meta;
  if (!columnMeta?.variant) return null;

  const title = columnMeta.label ?? column.id;
  const placeholder = columnMeta.placeholder ?? columnMeta.label;
  const filterVariant = getFilterVariant(columnMeta);

  switch (filterVariant) {
    case "text":
      return (
        <DataTableFilterInput
          column={column}
          placeholder={placeholder}
          className="w-40 lg:w-56"
        />
      );

    case "number":
      return (
        <DataTableFilterInput
          column={column}
          type="number"
          inputMode="numeric"
          placeholder={placeholder}
          unit={columnMeta.variant === "number" ? columnMeta.unit : undefined}
          className="w-30"
        />
      );

    case "range":
      return <DataTableSliderFilter column={column} title={title} />;

    case "date":
    case "date-range":
      return (
        <DataTableDateFilter
          column={column}
          title={title}
          multiple={filterVariant === "date-range"}
        />
      );

    case "select":
    case "multi-select":
      return (
        <DataTableFacetedFilter
          column={column}
          title={title}
          options={getColumnSelectOptions(columnMeta)}
          multiple={filterVariant === "multi-select"}
        />
      );

    default:
      return null;
  }
}

interface DataTableFilterInputProps<
  TData extends RowData,
> extends React.ComponentProps<"input"> {
  column: Column<DataTableFeatures, TData>;
  unit?: string;
}

function DataTableFilterInput<TData extends RowData>({
  column,
  type = "text",
  unit,
  className,
  ...props
}: DataTableFilterInputProps<TData>) {
  return (
    <Subscribe
      source={column.table.atoms.columnFilters}
      selector={() => column.getFilterValue()}
    >
      {(filterValue) => {
        const inputProps = {
          type,
          ...props,
          value: readFilterInputValue(filterValue),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            column.setFilterValue(event.target.value || undefined),
        };

        if (!unit) return <Input {...inputProps} className={className} />;

        return (
          <InputGroup className={className}>
            <InputGroupInput {...inputProps} />
            <InputGroupAddon align="inline-end">
              <InputGroupText>{unit}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        );
      }}
    </Subscribe>
  );
}

function readFilterInputValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return "";
}
