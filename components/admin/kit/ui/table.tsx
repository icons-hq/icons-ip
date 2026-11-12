"use client"

import * as React from "react"
import { cn } from "cn"

import {
  StickyTableHead,
  useClonedHeadHtml,
  useStickyTableHead,
} from "@/components/admin/console/StickyTableHead"

function Table({
  className,
  stickyHeader = false,
  ...props
}: React.ComponentProps<"table"> & {
  /** ICONS: 긴 목록을 내릴 때 머리글을 상단 막대 아래에 고정한다(복제 머리글 — 머리글이 글자뿐인 표만). */
  stickyHeader?: boolean
}) {
  const tableRef = React.useRef<HTMLTableElement>(null)
  const regionRef = React.useRef<HTMLDivElement>(null)
  const { cloneScrollRef, metrics } = useStickyTableHead(
    regionRef,
    tableRef,
    stickyHeader
  )
  const headHtml = useClonedHeadHtml(tableRef, stickyHeader)
  return (
    <>
      {stickyHeader ? (
        <StickyTableHead
          cloneScrollRef={cloneScrollRef}
          headHtml={headHtml}
          metrics={metrics}
          scrollRef={regionRef}
          tableClassName={cn("w-full caption-bottom text-sm", className)}
        />
      ) : null}
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
        ref={regionRef}
      >
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", className)}
          ref={tableRef}
          {...props}
        />
      </div>
    </>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-primary-soft/40 has-aria-expanded:bg-primary-soft/40 data-[state=selected]:bg-primary-soft",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 bg-muted px-2 text-left align-middle text-xs font-semibold whitespace-nowrap text-secondary-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
