"use client";

import {
  type ReactTable,
  type RowData,
  Subscribe,
} from "@tanstack/react-table";
import { cn } from "cn";
import * as React from "react";

import type { DataTableFeatures } from "@/components/admin/kit/lib/data-table-features";

import { Button } from "@/components/admin/kit/ui/button";
import { useDirection } from "@/components/admin/kit/ui/direction";
import {
  Faceted,
  FacetedContent,
  FacetedEmpty,
  FacetedGroup,
  FacetedInput,
  FacetedItem,
  FacetedItemIndicator,
  FacetedList,
  FacetedTrigger,
} from "@/components/admin/kit/ui/faceted";
import { Settings2 } from "lucide-react";

interface DataTableViewOptionsProps<
  TData extends RowData,
> extends React.ComponentProps<typeof FacetedContent> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  disabled?: boolean;
}

export function DataTableViewOptions<TData extends RowData>({
  table,
  disabled,
  className,
  ...props
}: DataTableViewOptionsProps<TData>) {
  const dir = useDirection();
  const columns = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter(
          (column) => column.accessorFn !== undefined && column.getCanHide(),
        ),
    [table],
  );

  return (
    <Subscribe source={table.atoms.columnVisibility}>
      {(columnVisibility) => (
        <Faceted
          multiple
          value={columns
            .filter((column) => columnVisibility[column.id] !== false)
            .map((column) => column.id)}
        >
          <FacetedTrigger
            render={
              <Button
                aria-label="표시할 열 선택"
                variant="outline"
                className="ms-auto hidden lg:flex"
                disabled={disabled}
              />
            }
          >
            <Settings2 className="text-muted-foreground" />
            열 표시
          </FacetedTrigger>
          <FacetedContent
            aria-label="열"
            dir={dir}
            align="center"
            className={cn("w-44", className)}
            {...props}
          >
            <FacetedInput placeholder="열 이름 찾기" />
            <FacetedList>
              <FacetedEmpty>찾는 열이 없습니다.</FacetedEmpty>
              <FacetedGroup>
                {columns.map((column) => (
                  <FacetedItem
                    key={column.id}
                    value={column.id}
                    onSelect={() => column.toggleVisibility()}
                  >
                    <span className="truncate">
                      {column.columnDef.meta?.label ?? column.id}
                    </span>
                    <FacetedItemIndicator />
                  </FacetedItem>
                ))}
              </FacetedGroup>
            </FacetedList>
          </FacetedContent>
        </Faceted>
      )}
    </Subscribe>
  );
}
