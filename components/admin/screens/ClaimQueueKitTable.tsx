'use client';

import { Subscribe, type ColumnDef, type RowSelectionState, type SortingState, type Table as CoreTable } from '@tanstack/react-table';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { startTransition, useActionState, useId, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { bulkDecideOrderClaimsAction } from '@/app/admin/claim-actions';
import { bulkConvertClaimTypesAction } from '@/app/admin/claim-type-conversion-actions';
import { DataTable } from '@/components/admin/kit/data-table/data-table';
import { DataTableColumnHeader } from '@/components/admin/kit/data-table/data-table-column-header';
import { DataTablePagination } from '@/components/admin/kit/data-table/data-table-pagination';
import { DataTableToolbar } from '@/components/admin/kit/data-table/data-table-toolbar';
import type { ConsoleDateRange } from '@/components/admin/console/date-presets';
import { KitDatePresets } from '@/components/admin/kit/date-presets';
import { ConsoleTableSettings, type ConsoleTableSettingsColumn } from '@/components/admin/kit/console-table-settings';
import type { DataTableFeatures } from '@/components/admin/kit/lib/data-table-features';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection, ActionBarSeparator } from '@/components/admin/kit/ui/action-bar';
import Link from 'next/link';
import { ConsoleFilterActions, ConsoleFilterField, CONSOLE_FILTER_CARD_CLASS } from '@/components/admin/console/ConsoleFilterPanel';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Checkbox } from '@/components/admin/kit/ui/checkbox';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/admin/kit/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/admin/kit/ui/select';
import { useConsoleTable, type ConsoleTableState } from '@/components/admin/kit/use-console-table';
import {
  ADMIN_CLAIM_BULK_ACTION_LABELS,
  ADMIN_CLAIM_BULK_CONVERT,
  ADMIN_CLAIM_BULK_LIMIT,
  ADMIN_CLAIM_BULK_RESHIP_LIMIT,
  ADMIN_CLAIM_BULK_STEP_LABELS,
  adminClaimBulkConversionLabel,
  adminClaimBulkConversionTarget,
  adminClaimBulkSteps,
  normalizeAdminClaimBulkConversionForm,
  planAdminClaimBulkSubmit,
  type AdminClaimBulkDecision,
  type AdminClaimBulkState,
  type AdminClaimBulkStep,
} from '@/lib/admin/claim-bulk';
import {
  ADMIN_CLAIM_PAGE_SIZE,
  adminClaimHref,
  adminClaimTodayKst,
  adminClaimReasonOptions,
  adminClaimRejectionPresets,
  adminClaimStageOptions,
  type AdminClaimFilters,
  type AdminClaimReasonFilter,
  type AdminClaimStageFilter,
} from '@/lib/admin/claims';
import type { SalesListSort } from '@/lib/admin/sales-list';
import { adminClaimCopy } from '@/lib/admin/vocabulary';
import { ORDER_CLAIM_TYPE_LABELS, type OrderClaimType } from '@/lib/orders/claims';
import { X } from 'lucide-react';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { ClaimBulkStepDialog, type ClaimBulkStepSession } from './ClaimBulkStepDialog';
import { ClaimKitBulkResult } from './ClaimKitBulkResult';
import { ClaimPreviewLink } from './ClaimPreviewDialog';
import { adminConfirm } from '@/lib/admin/confirm';

export { ClaimKitBulkResult } from './ClaimKitBulkResult';

/*
 * 취소·반품·교환 목록 — admin kit(shadcn/ui · Base UI · Dice UI data table, ADR-0028).
 * 세 유형이 같은 표를 쓰고, 유형마다 다른 것은 문구·단계·사유 선택지뿐이다.
 *
 * 판정은 바뀌지 않는다: 조회는 서버가 `admin_search_order_claims_console`로, 처리는
 * `bulkDecideOrderClaimsAction`과 `bulkConvertClaimTypesAction`이 한 건씩 기존 단건 경로로 한다.
 * 단계 일괄 처리(회수 확인·환불 완료 확정·재출고, 1027T-033·SHEET-049·SHEET-052)는 확인창(ClaimBulkStepDialog)이
 * 서버가 계산한 건수·합계·제외 사유를 보이고 한 건씩 단건 경로를 태운다. 이 파일은 화면만 바꾼다.
 *
 * 목록 조건은 기존 URL 계약(`adminClaimHref`)을 그대로 쓴다. 표가 바꾼 페이지·정렬·필터는
 * `hrefFor`가 그 계약의 href로 옮기고 서버가 다시 그린다(components/admin/kit/use-console-table.ts).
 */

/** 서버가 미리 문구로 바꿔 둔 행. SLA는 서버 시각으로 계산해 하이드레이션 차이를 없앤다. */
export interface ClaimKitRow {
  id: string;
  selectable: boolean;
  reference: string;
  previewHref: string;
  order: string;
  type: string;
  reason: string;
  stage: string;
  buyer: string;
  amount: number;
  amountLabel: string;
  requestedAt: string;
  requestedLabel: string;
  slaLabel: string;
  slaTone: string;
  refund: string | null;
  handler: string | null;
}

interface Option<T extends string = string> { value: T; label: string }

const EMPTY_STATE: AdminClaimBulkState = {};
const BULK_RESULT_LOST = '처리 결과를 받지 못했습니다. 목록을 새로고침해 각 건의 상태를 확인하세요.';
const PAGE_SIZE_OPTIONS = [20, 50, 100];
/* SLA는 운영자가 가장 먼저 보는 값이라 톤을 데이터 속성으로 남기고, 임박·초과를 의미색으로 강조한다. */
const SLA_TONE_CLASS = 'data-[sla-tone=warning]:font-semibold data-[sla-tone=warning]:text-[var(--wc-warning)] data-[sla-tone=danger]:font-bold data-[sla-tone=danger]:text-destructive';

/* 정렬 ↔ RPC p_sort. RPC가 아는 정렬은 네 가지뿐이라 그 밖의 열은 정렬을 끈다. */
function sortingFor(sort: SalesListSort | undefined): SortingState {
  if (sort === 'oldest') return [{ id: 'requested', desc: false }];
  if (sort === 'amount_high') return [{ id: 'amount', desc: true }];
  if (sort === 'amount_low') return [{ id: 'amount', desc: false }];
  return [{ id: 'requested', desc: true }];
}
function sortFor(sorting: SortingState): SalesListSort | undefined {
  const [first] = sorting;
  if (first?.id === 'amount') return first.desc ? 'amount_high' : 'amount_low';
  if (first?.id === 'requested' && !first.desc) return 'oldest';
  return undefined;
}

/*
 * 기간 ↔ 날짜 필터. URL의 `YYYY-MM-DD`는 KST 달력 날짜이고, 달력은 고른 칸의 브라우저 자정 ms를 준다.
 * 두 변환은 같은 날짜 글자를 브라우저 달력 칸 하나에 맞대는 역함수다. ms를 KST로 다시 환산하면
 * KST보다 동쪽 시간대(UTC+10 이상) 브라우저에서 고른 날의 전날이 된다.
 */
function dayToMs(day: string | null) {
  if (!day) return undefined;
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).getTime();
}
function msToDay(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 서버 필터 → 표 상태. */
export function claimKitStateFor(filters: AdminClaimFilters, pageSize: number): ConsoleTableState {
  const columnFilters = [];
  if (filters.stage !== 'all') columnFilters.push({ id: 'stage', value: [filters.stage] });
  if (filters.reasonType !== 'all') columnFilters.push({ id: 'reason', value: [filters.reasonType] });
  if (filters.from || filters.to) columnFilters.push({ id: 'requested', value: [dayToMs(filters.from), dayToMs(filters.to)] });
  return { columnFilters, pagination: { pageIndex: filters.page - 1, pageSize }, sorting: sortingFor(filters.sort) };
}

/** 표 상태 → 서버 필터(기존 URL 계약). */
export function claimKitFiltersFor(filters: AdminClaimFilters, next: ConsoleTableState): AdminClaimFilters {
  const value = (id: string) => next.columnFilters.find((filter) => filter.id === id)?.value;
  const first = (id: string) => { const picked = value(id); return Array.isArray(picked) && typeof picked[0] === 'string' ? picked[0] : null; };
  const range = value('requested');
  let from = Array.isArray(range) ? msToDay(range[0]) : null;
  let to = Array.isArray(range) ? msToDay(range[1]) : null;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    ...filters,
    from,
    page: next.pagination.pageIndex + 1,
    pageSize: next.pagination.pageSize === ADMIN_CLAIM_PAGE_SIZE ? undefined : next.pagination.pageSize,
    reasonType: (first('reason') ?? 'all') as AdminClaimReasonFilter,
    sort: sortFor(next.sorting),
    stage: (first('stage') ?? 'all') as AdminClaimStageFilter,
    to,
  };
}

function SelectColumnHeader({ table }: { table: CoreTable<DataTableFeatures, ClaimKitRow> }) {
  return <Subscribe source={table.atoms.rowSelection} selector={() => ({
    all: table.getIsAllPageRowsSelected(),
    some: table.getIsSomePageRowsSelected(),
    any: table.getRowModel().rows.some((row) => row.getCanSelect()),
  })}>
    {({ all, some, any }) => <Checkbox
      aria-label="이 페이지에서 처리할 수 있는 요청 모두 선택"
      checked={all}
      disabled={!any}
      indeterminate={some && !all}
      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
    />}
  </Subscribe>;
}

/**
 * 표의 단계·사유 필터 선택지. 그 유형에 생길 수 없는 단계(취소의 수거)·사유(취소의 하자, 반품·교환의
 * 운영자 전액 취소)는 고를 수 없다(R7). '전체'는 필터를 지운 상태라 선택지에 두지 않는다.
 */
export function claimKitFilterOptions(claimType: OrderClaimType): { stage: Option[]; reason: Option[] } {
  return {
    stage: adminClaimStageOptions(claimType).filter((option) => option.value !== 'all'),
    reason: adminClaimReasonOptions(claimType).filter((option) => option.value !== 'all'),
  };
}

/* 긴 값은 한 줄로 자르고 전체 값은 title에 둔다. 칸이 overflow-hidden이라 그냥 두면 말없이 글자가 잘린다. */
function OneLine({ value }: { value: string }) {
  return <span className="block truncate" title={value}>{value}</span>;
}

/*
 * 1440 화면(표 폭 1,100px)에 유형을 뺀 열이 모두 들어오는 폭이다(합계 1,096px). 번호·금액·날짜는 값이 잘리지 않는 최소 폭이고,
 * 이름·사유처럼 긴 값만 잘린다. 유형은 세 목록 모두 값이 한 가지라(유형별 조회) 기본으로 숨긴다.
 */
/** 환급 기한은 반품의 약관 기한이다. 취소·교환에서는 같은 칸이 처리 진행을 말한다. */
function claimDeadlineLabel(claimType: OrderClaimType): string {
  return claimType === 'return' ? '환급 기한' : '처리 기한';
}

function buildColumns(claimType: OrderClaimType, dateLabel: string): ColumnDef<DataTableFeatures, ClaimKitRow>[] {
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];
  const { reason: reasonOptions, stage: stageOptions } = claimKitFilterOptions(claimType);
  return [
    {
      id: 'select',
      enableHiding: false,
      enableSorting: false,
      header: ({ table }) => <SelectColumnHeader table={table} />,
      cell: ({ row }) => <Subscribe source={row.table.atoms.rowSelection} selector={(selection) => selection[row.id] === true}>
        {(selected) => <Checkbox
          aria-label={`요청 ${row.original.reference} 선택`}
          checked={selected}
          disabled={!row.getCanSelect()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />}
      </Subscribe>,
      size: 40,
    },
    {
      id: 'reference',
      accessorKey: 'reference',
      enableHiding: false,
      enableSorting: false,
      header: '요청번호',
      meta: { label: '요청번호' },
      cell: ({ row }) => <ClaimPreviewLink href={row.original.previewHref} label={`요청 ${row.original.reference} 상세 열기`}>
        <span className="tabular-nums">{row.original.reference}</span>
      </ClaimPreviewLink>,
      size: 80,
    },
    { id: 'order', accessorKey: 'order', enableSorting: false, header: '주문번호', meta: { label: '주문번호' }, cell: ({ row }) => <span className="tabular-nums">{row.original.order}</span>, size: 156 },
    { id: 'type', accessorKey: 'type', enableSorting: false, header: '유형', meta: { label: '유형' }, size: 70 },
    {
      id: 'reason',
      accessorKey: 'reason',
      enableColumnFilter: true,
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="사유" />,
      meta: { label: `${typeLabel}사유`, variant: 'select', options: reasonOptions },
      cell: ({ row }) => <OneLine value={row.original.reason} />,
      size: 112,
    },
    {
      id: 'stage',
      accessorKey: 'stage',
      enableColumnFilter: true,
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />,
      meta: { label: `${typeLabel}처리상태`, variant: 'select', options: stageOptions },
      /* 행은 표시 문구만 들고 오므로 이 열의 보기표로 단계를 되찾아 색을 정한다(같은 표를 쓰는 문구라 어긋나지 않는다). */
      cell: ({ row }) => <AdminStatusBadge tone={statusTone('claim', stageOptions.find((option) => option.label === row.original.stage)?.value)}>{row.original.stage}</AdminStatusBadge>,
      size: 120,
    },
    { id: 'buyer', accessorKey: 'buyer', enableSorting: false, header: '구매자', meta: { label: '구매자' }, cell: ({ row }) => <OneLine value={row.original.buyer} />, size: 96 },
    {
      id: 'amount',
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} label="주문금액" />,
      meta: { label: '주문금액' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.amountLabel}</span>,
      size: 100,
    },
    {
      id: 'requested',
      accessorKey: 'requestedAt',
      enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="접수일" />,
      cell: ({ row }) => <time dateTime={row.original.requestedAt}>{row.original.requestedLabel}</time>,
      meta: { label: dateLabel, variant: 'date', filter: 'range' },
      size: 140,
    },
    { id: 'sla', accessorKey: 'slaLabel', enableSorting: false, header: claimDeadlineLabel(claimType), meta: { label: claimDeadlineLabel(claimType) }, cell: ({ row }) => <span className={SLA_TONE_CLASS} data-sla-tone={row.original.slaTone}>{row.original.slaLabel}</span>, size: 90 },
    { id: 'refund', accessorKey: 'refund', enableSorting: false, header: '환불 수단', meta: { label: '환불 수단' }, cell: ({ row }) => row.original.refund ?? <span className="text-muted-foreground">미접수</span>, size: 86 },
    { id: 'handler', accessorKey: 'handler', enableSorting: false, header: '처리자', meta: { label: '처리자' }, cell: ({ row }) => row.original.handler ? <OneLine value={row.original.handler} /> : <span className="text-muted-foreground">미배정</span>, size: 76 },
  ];
}

/* 조회항목 설정의 열. 키는 기존 표(ClaimQueueScreen)와 같아, 같은 저장 키에서 운영자가 저장한 배치가 이어진다. */
function preferenceColumnsFor(claimType: OrderClaimType): readonly ConsoleTableSettingsColumn[] {
  return [
    { key: 'reference', label: '요청번호' }, { key: 'order', label: '주문번호' }, { key: 'type', label: '유형', defaultVisible: false },
    { key: 'reason', label: '사유' }, { key: 'stage', label: '상태' }, { key: 'buyer', label: '구매자' },
    { key: 'amount', label: '주문금액' }, { key: 'requested', label: '접수일' },
    /* 취소·교환의 기한 칸은 '회수 없음'·'재출고 대기'뿐이고, 교환에는 환불이 없다 — 그 목록에서는 기본으로 숨긴다(조회항목 설정에서 켠다). */
    { key: 'sla', label: claimDeadlineLabel(claimType), ...(claimType !== 'return' ? { defaultVisible: false } : {}) },
    { key: 'refund', label: '환불 수단', ...(claimType === 'exchange' ? { defaultVisible: false } : {}) },
    { key: 'handler', label: '처리자' },
  ];
}
const PREFERENCE_COLUMNS_BY_TYPE: Record<OrderClaimType, readonly ConsoleTableSettingsColumn[]> = {
  cancel: preferenceColumnsFor('cancel'),
  return: preferenceColumnsFor('return'),
  exchange: preferenceColumnsFor('exchange'),
};

/**
 * 검색 항목·검색어 입력. 값은 위 조회 조건 폼이 들고 있고 [검색]을 눌러야 조회된다(ADM-016 #13).
 * 검색어는 조합이 끝난 뒤에만 확정한다. Dice UI의 텍스트 필터는 입력할 때마다 값을 올려 보내
 * (조합 중인 한글도) URL·서버 재조회로 이어지므로 쓰지 않는다. Enter의 조합 확정 키는 검색을 보내지 않는다.
 */
function ClaimSearchFields({ field, fieldOptions, onField, onQuery, query, typeLabel }: {
  field: string;
  fieldOptions: readonly Option[];
  onField: (value: string) => void;
  onQuery: (value: string) => void;
  query: string;
  typeLabel: string;
}) {
  const inputId = useId();
  return <div aria-label={`${typeLabel} 요청 검색`} className="flex min-w-0 flex-wrap items-center gap-2" role="search">
    <Select items={fieldOptions} onValueChange={(value) => { if (typeof value === 'string') onField(value); }} value={field}>
      <SelectTrigger aria-label="검색 항목" className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {fieldOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <label className="sr-only" htmlFor={inputId}>검색어</label>
    <Input
      className="w-full sm:w-72"
      id={inputId}
      maxLength={100}
      onChange={(event) => onQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}
      placeholder="주문번호 · 요청번호 · 구매자 · 수령인 · 상품 URL"
      value={query}
    />
  </div>;
}

const CUSTOM_REASON = '__custom';
const ALL_OPTION = '__all';

/**
 * 거부 사유(R7) — kit 판. ClaimRejectionReasonField와 같은 규칙: 유형에 맞는 확정 문장만 고를 수 있고,
 * '직접 입력'을 고르면 칸을 비우고 입력 칸으로 옮긴다. 사유 칸의 Enter는 아무 버튼도 누르지 않는다(팝오버
 * 안에 실행 버튼이 따로 있다). 한글 조합을 끝내는 Enter는 막지 않는다 — 조합 확정을 방해하지 않게 한다.
 */
function KitRejectionReasonField({ claimType, onChange, value }: { claimType: OrderClaimType; onChange: (value: string) => void; value: string }) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const presets = adminClaimRejectionPresets(claimType);
  const items = [{ value: CUSTOM_REASON, label: '직접 입력' }, ...presets.map((preset) => ({ value: preset, label: preset }))];
  return <div className="flex flex-col gap-3">
    <div className="flex flex-col gap-1.5">
      <Label>자주 쓰는 거부 사유</Label>
      <Select
        items={items}
        onValueChange={(next) => {
          const preset = typeof next === 'string' && next !== CUSTOM_REASON ? next : '';
          onChange(preset);
          if (!preset) inputRef.current?.focus();
        }}
        value={presets.includes(value) ? value : CUSTOM_REASON}
      >
        <SelectTrigger aria-label="자주 쓰는 거부 사유" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>거부 사유</Label>
      <Input
        id={inputId}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault(); }}
        placeholder="10~200자"
        ref={inputRef}
        value={value}
      />
      <p className="text-xs text-muted-foreground">선택한 건 모두에 씁니다. 구매자에게 그대로 전달됩니다.</p>
    </div>
  </div>;
}

/**
 * 반품↔교환 일괄 전환 입력(10/27 회의 14:52 · MD-0032·0033). 상세의 전환 창과 같은 고객 합의 근거·동의를
 * 받는다. 환불계좌는 건마다 달라 여기서 받지 않는다 — 계좌가 필요한 건은 결과표에 남고 상세에서 입력한다.
 */
function KitConversionFields({ agreement, confirmed, count, needsAccountNotice, onAgreement, onConfirmed, targetLabel }: {
  agreement: string;
  confirmed: boolean;
  count: number;
  needsAccountNotice: boolean;
  onAgreement: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  targetLabel: string;
}) {
  const inputId = useId();
  return <div className="flex flex-col gap-3">
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>고객 합의 근거</Label>
      <Input
        id={inputId}
        maxLength={500}
        onChange={(event) => onAgreement(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault(); }}
        placeholder="상담 일시, 참조번호와 합의한 내용을 적어주세요."
        value={agreement}
      />
      <p className="text-xs text-muted-foreground">선택한 건 모두에 같은 내용으로 기록합니다. 기존 접수일, 수거 내역, 보류 사유와 배송비 기록은 유지됩니다. 배송비 차액은 고객과 별도로 확인해주세요.</p>
      {needsAccountNotice ? <p className="text-xs text-muted-foreground">환불계좌가 없는 무통장 주문은 전환되지 않고 결과표에 남습니다. 요청번호를 눌러 상세에서 입력해주세요.</p> : null}
    </div>
    <label className="flex items-start gap-2 text-sm leading-relaxed">
      <Checkbox checked={confirmed} className="mt-0.5" onCheckedChange={(value) => onConfirmed(!!value)} />
      <span>선택한 {count}건 모두 고객과 {targetLabel} 전환 및 배송비 처리에 합의했습니다.</span>
    </label>
  </div>;
}

export function ClaimQueueKitTable({
  claimType,
  dateFieldOptions,
  filters,
  pageSize,
  rows,
  searchFieldOptions,
  total,
}: {
  claimType: OrderClaimType;
  dateFieldOptions: readonly Option[];
  filters: AdminClaimFilters;
  pageSize: number;
  rows: ClaimKitRow[];
  searchFieldOptions: readonly Option[];
  total: number;
}) {
  const router = useRouter();
  const [searching, startSearch] = useTransition();
  /* 조회 조건 초안(검색 항목·검색어·기간 기준). 열 필터 초안은 표 훅이 들고 있다. [검색]을 눌러야 모두 함께 적용된다. */
  const [draftField, setDraftField] = useState<string>(filters.field ?? 'all');
  const [draftQuery, setDraftQuery] = useState(filters.query);
  const [draftDateField, setDraftDateField] = useState<string>(filters.dateField ?? 'requested');
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [note, setNote] = useState('');
  const [clientError, setClientError] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [agreement, setAgreement] = useState('');
  const [convertConfirmed, setConvertConfirmed] = useState(false);
  /* 단계 일괄 처리 확인창과 그 결과. 결과는 창을 닫으면 아래 결과표로 넘어온다. */
  const [stepSession, setStepSession] = useState<ClaimBulkStepSession | null>(null);
  const [stepResult, setStepResult] = useState<AdminClaimBulkState | null>(null);
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];
  const convertFrom = claimType === 'cancel' ? null : claimType;
  const convertTo = convertFrom ? adminClaimBulkConversionTarget(convertFrom) : null;
  /* 열 머리글·필터 이름은 적용된 기간 기준을 따른다(초안이 아니라 지금 보이는 목록의 기준). */
  const appliedDateField = filters.dateField ?? 'requested';
  const dateLabel = dateFieldOptions.find((option) => option.value === appliedDateField)?.label ?? '요청일';
  /*
   * 열 정의는 유형·기간 기준이 바뀔 때만 새로 만든다. flexRender는 셀 함수를 컴포넌트로 그리므로 열이 새로
   * 만들어지면 모든 셀이 다시 마운트되고, 상세 팝업을 연 요청번호 링크도 교체돼 닫은 뒤 포커스를 돌려줄 곳이
   * 사라진다. 그래서 서버가 이동마다 새로 보내는 옵션 배열을 받지 않고 여기서 유형으로 만든다.
   */
  const columns = useMemo(() => buildColumns(claimType, dateLabel), [claimType, dateLabel]);
  const currentHref = adminClaimHref(claimType, filters);
  const filterId = 'claim-filter';
  const reasonSelectItems = useMemo(() => [{ value: ALL_OPTION, label: '전체' }, ...claimKitFilterOptions(claimType).reason], [claimType]);
  const stageSelectItems = useMemo(() => [{ value: ALL_OPTION, label: '전체' }, ...claimKitFilterOptions(claimType).stage], [claimType]);

  const { draftColumnFilters, pending, preferences, savePreferences, table } = useConsoleTable({
    columns,
    data: rows,
    deferColumnFilters: true,
    enableRowSelection: (row) => row.original.selectable,
    getRowId: (row) => row.id,
    hrefFor: (next) => adminClaimHref(claimType, claimKitFiltersFor(filters, next)),
    onRowSelectionChange: setSelection,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    preferenceColumns: PREFERENCE_COLUMNS_BY_TYPE[claimType],
    preferencesKey: `sales-claims-${claimType}`,
    rowSelection: selection,
    state: claimKitStateFor(filters, pageSize),
  });

  const [state, run, deciding] = useActionState(async (previous: AdminClaimBulkState, formData: FormData) => {
    setStepResult(null);
    let next: AdminClaimBulkState;
    try {
      next = formData.get('decision') === ADMIN_CLAIM_BULK_CONVERT
        ? await bulkConvertClaimTypesAction(previous, formData)
        : await bulkDecideOrderClaimsAction(previous, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: BULK_RESULT_LOST };
    }
    if (next.results) {
      const skipped = next.results.filter((result) => result.outcome === 'skipped');
      setSelection(Object.fromEntries(skipped.map((result) => [result.claimId, true])));
      /* 합의 근거는 고른 고객들의 것이다. 남은 건을 다시 실행할 때만 두고, 다음 선택으로 넘기지 않는다. */
      if (skipped.length === 0) setAgreement('');
    }
    return next;
  }, EMPTY_STATE);

  const eligible = new Set(rows.filter((row) => row.selectable).map((row) => row.id));
  const selectedIds = Object.keys(selection).filter((id) => selection[id] && eligible.has(id));
  const overLimit = selectedIds.length > ADMIN_CLAIM_BULK_LIMIT;

  async function decide(decision: AdminClaimBulkDecision) {
    if (deciding) return;
    const plan = await planAdminClaimBulkSubmit({ claimType, count: selectedIds.length, decision, note }, adminConfirm);
    if (plan.kind === 'invalid') { setClientError(plan.error); return; }
    setClientError('');
    if (plan.kind === 'dismissed') return;
    const formData = new FormData();
    formData.set('claimType', claimType);
    for (const id of selectedIds) formData.append('claimIds', id);
    formData.set('decision', plan.decision);
    formData.set('note', note);
    setRejectOpen(false);
    startTransition(() => run(formData));
  }

  function convert() {
    if (deciding || !convertFrom) return;
    const formData = new FormData();
    formData.set('claimType', convertFrom);
    for (const id of selectedIds) formData.append('claimIds', id);
    formData.set('decision', ADMIN_CLAIM_BULK_CONVERT);
    formData.set('agreement', agreement);
    formData.set('confirmed', convertConfirmed ? 'true' : 'false');
    const checked = normalizeAdminClaimBulkConversionForm(formData);
    if (!checked.ok) { setClientError(checked.error); return; }
    setClientError('');
    setConvertOpen(false);
    /* 동의는 실행마다 새로 받는다. 시간 예산으로 남은 건을 다시 실행할 때도 다시 체크한다. */
    setConvertConfirmed(false);
    startTransition(() => run(formData));
  }

  /* 확인창을 연다. 확인할 내용(건수·출고지·금액·제외 사유)은 창이 서버에서 읽는다. 입고일 기본값은 연 날의 KST 오늘이다. */
  function openStep(step: AdminClaimBulkStep) {
    if (deciding || stepSession) return;
    const limit = step === 'reship' ? ADMIN_CLAIM_BULK_RESHIP_LIMIT : ADMIN_CLAIM_BULK_LIMIT;
    if (selectedIds.length > limit) { setClientError(`한 번에 ${limit}건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.`); return; }
    setClientError('');
    setStepSession({ step, claimIds: [...selectedIds], today: adminClaimTodayKst() });
  }

  /* 창을 닫으면 결과를 목록 아래에 남기고, 실패·미처리 건만 선택에 남겨 다시 처리할 수 있게 한다. */
  function closeStep(result: AdminClaimBulkState | null) {
    setStepSession(null);
    if (!result?.results?.length) return;
    setStepResult(result);
    setSelection(Object.fromEntries(result.results.filter((entry) => entry.outcome === 'failed' || entry.outcome === 'skipped').map((entry) => [entry.claimId, true])));
  }

  /* 서버가 그린 조건이 바뀌면(조회·초기화·뒤로 가기·페이지 이동) 초안도 그 조건으로 되돌린다. */
  const [seenHref, setSeenHref] = useState(currentHref);
  if (seenHref !== currentHref) {
    setSeenHref(currentHref);
    setDraftField(filters.field ?? 'all');
    setDraftQuery(filters.query);
    setDraftDateField(filters.dateField ?? 'requested');
  }

  /* [검색]: 검색 항목·검색어·기간 기준·열 필터 초안을 한 번에 적용한다. URL 계약(adminClaimHref)은 그대로다. */
  function applyConditions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const applied = claimKitFiltersFor(filters, { ...claimKitStateFor(filters, pageSize), columnFilters: draftColumnFilters, pagination: { pageIndex: 0, pageSize } });
    startSearch(() => {
      router.push(adminClaimHref(claimType, {
        ...applied,
        dateField: draftDateField === 'requested' ? undefined : draftDateField as AdminClaimFilters['dateField'],
        field: draftField === 'all' ? undefined : draftField as AdminClaimFilters['field'],
        page: 1,
        query: draftQuery.trim(),
      }), { scroll: false });
    });
  }

  /* 기간 빠른 선택은 기간 기준(요청일 등)을 그대로 두고 기간 초안만 채운다. 기존 화면의 프리셋과 같은 KST 기간이다. */
  const draftRange = draftColumnFilters.find((filter) => filter.id === 'requested')?.value;
  const draftFrom = Array.isArray(draftRange) ? msToDay(draftRange[0]) : null;
  const draftTo = Array.isArray(draftRange) ? msToDay(draftRange[1]) : null;
  function onDatePreset(range: ConsoleDateRange) {
    table.getColumn('requested')?.setFilterValue([dayToMs(range.from), dayToMs(range.to)]);
  }

  const error = clientError || state.error;
  const busy = pending || searching;

  return <div className="flex min-w-0 flex-col gap-3" data-admin-kit="claims-table" data-pending={busy ? 'true' : undefined}>
    <form aria-label={`${typeLabel} 요청 조회 조건`} className={CONSOLE_FILTER_CARD_CLASS} data-console-filters="" onSubmit={applyConditions}>
      <ClaimSearchFields field={draftField} fieldOptions={searchFieldOptions} onField={setDraftField} onQuery={setDraftQuery} query={draftQuery} typeLabel={typeLabel} />
      <div className="flex flex-wrap items-end gap-3">
        {([['reason', `${typeLabel}사유`, reasonSelectItems], ['stage', `${typeLabel}처리상태`, stageSelectItems]] as const).map(([columnId, label, items]) => {
          const current = draftColumnFilters.find((filter) => filter.id === columnId)?.value;
          const value = Array.isArray(current) && typeof current[0] === 'string' ? current[0] : ALL_OPTION;
          return <ConsoleFilterField htmlFor={`${filterId}-${columnId}`} key={columnId} label={label}>
            <Select items={items} onValueChange={(next) => { if (typeof next === 'string') table.getColumn(columnId)?.setFilterValue(next === ALL_OPTION ? undefined : [next]); }} value={value}>
              <SelectTrigger className="w-44" id={`${filterId}-${columnId}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {items.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </ConsoleFilterField>;
        })}
        <ConsoleFilterField htmlFor={`${filterId}-dateField`} label="기간 기준">
          <Select items={dateFieldOptions} onValueChange={(value) => { if (typeof value === 'string') setDraftDateField(value); }} value={draftDateField}>
            <SelectTrigger className="w-32" id={`${filterId}-dateField`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {dateFieldOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </ConsoleFilterField>
        <ConsoleFilterField label="기간">
          <KitDatePresets disabled={busy} from={draftFrom} onSelect={onDatePreset} to={draftTo} />
        </ConsoleFilterField>
      </div>
      <DataTableToolbar
        className="p-0"
        hideFilters={['reason', 'stage']}
        hideReset
        table={table}
        viewOptions={<ConsoleTableSettings columns={PREFERENCE_COLUMNS_BY_TYPE[claimType]} onSave={savePreferences} preferences={preferences} />}
      />
      <ConsoleFilterActions>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={adminClaimHref(claimType, { ...filters, dateField: undefined, field: undefined, from: null, page: 1, query: '', reasonType: 'all', stage: 'all', to: null })}>초기화</Link>
        <Button disabled={busy} type="submit" variant="soft">검색</Button>
      </ConsoleFilterActions>
    </form>
    {/* 일괄 처리 결과(선택 건 승인·거부·검토중·전환·단계 처리)는 목록 위, 조회 조건 바로 아래에 둔다 — 처리 막대가 화면 아래에 있어도
        결과표가 목록 끝(첫 화면 밖)에 붙지 않게 한다(QA2 S-T11a-02). */}
    {overLimit ? <p className="text-sm text-destructive" role="alert">한 번에 {ADMIN_CLAIM_BULK_LIMIT}건까지 처리할 수 있습니다. 선택을 줄여주세요.</p> : null}
    {error && !rejectOpen && !convertOpen ? <p className="text-sm text-destructive" role="alert">{adminClaimCopy(error)}</p> : null}
    <ClaimKitBulkResult previewHrefBase={currentHref} state={stepResult ?? state} />
    {/* 처리 막대는 체크하면 화면 아래에 뜬다. 체크 전에는 같은 버튼을 흐리게 보여 어디서 처리하는지 알린다(발주 화면의 '선택 주문 0건'과 같은 약속). */}
    {selectedIds.length === 0 ? <div aria-label="일괄 처리(요청을 체크하면 쓸 수 있습니다)" className="flex flex-wrap items-center gap-1.5" data-claims-bulk-idle="" role="group">
      <span className="text-xs text-muted-foreground">0건 선택</span>
      {[
        ADMIN_CLAIM_BULK_ACTION_LABELS.approve,
        ADMIN_CLAIM_BULK_ACTION_LABELS.review,
        ...adminClaimBulkSteps(claimType).map((step) => ADMIN_CLAIM_BULK_STEP_LABELS[step]),
        ...(convertFrom ? [adminClaimBulkConversionLabel(convertFrom)] : []),
        ADMIN_CLAIM_BULK_ACTION_LABELS.reject,
      ].map((label) => <Button disabled key={label} size="sm" title="왼쪽 체크칸에서 요청을 고르면 화면 아래 막대에서 처리합니다" variant="outline">{label}</Button>)}
    </div> : null}
    <DataTable
      aria-label={`${typeLabel} 요청 목록`}
      emptyLabel={`조건에 맞는 ${typeLabel} 요청이 없습니다.`}
      pagination={<DataTablePagination pageSizeOptions={PAGE_SIZE_OPTIONS} table={table} />}
      table={table}
    />

    <ActionBar
      aria-label="선택 건 일괄 처리"
      className="w-max max-w-[calc(100vw-1rem)] flex-wrap justify-center"
      onOpenChange={(open) => { if (!open && !deciding) setSelection({}); }}
      open={selectedIds.length > 0}
    >
      <ActionBarSelection>
        {selectedIds.length}건 선택 · 최대 {ADMIN_CLAIM_BULK_LIMIT}건
        <ActionBarSeparator />
        <ActionBarClose aria-label="선택 해제"><X /></ActionBarClose>
      </ActionBarSelection>
      <ActionBarSeparator />
      <ActionBarGroup className="flex-wrap justify-center">
        {(['approve', 'review'] as const).map((decision) => <ActionBarItem
          disabled={deciding || overLimit}
          key={decision}
          onSelect={(event) => { event.preventDefault(); return decide(decision); }}
          variant={decision === 'approve' ? 'default' : 'secondary'}
        >{ADMIN_CLAIM_BULK_ACTION_LABELS[decision]}</ActionBarItem>)}
        {/* 단계 처리(회수 확인·환불 완료 확정·재출고)는 확인창에서 건수·금액·제외 사유를 본 뒤 실행한다. */}
        {adminClaimBulkSteps(claimType).map((step) => <ActionBarItem
          disabled={deciding || stepSession !== null || overLimit}
          key={step}
          onSelect={(event) => { event.preventDefault(); openStep(step); }}
          variant="secondary"
        >{ADMIN_CLAIM_BULK_STEP_LABELS[step]}</ActionBarItem>)}
        {convertFrom && convertTo ? <Popover onOpenChange={(open) => { setClientError(''); setConvertOpen(open); }} open={convertOpen}>
          <PopoverTrigger render={<ActionBarItem disabled={deciding || overLimit} onSelect={(event) => event.preventDefault()} variant="secondary" />}>
            {adminClaimBulkConversionLabel(convertFrom)}
          </PopoverTrigger>
          <PopoverContent className="w-96 max-w-[calc(100vw-1rem)]" side="top">
            <KitConversionFields
              agreement={agreement}
              confirmed={convertConfirmed}
              count={selectedIds.length}
              needsAccountNotice={convertTo === 'return'}
              onAgreement={setAgreement}
              onConfirmed={setConvertConfirmed}
              targetLabel={ORDER_CLAIM_TYPE_LABELS[convertTo]}
            />
            {clientError ? <p className="text-sm text-destructive" role="alert">{clientError}</p> : null}
            <Button disabled={deciding || !convertConfirmed} onClick={convert}>선택 {selectedIds.length}건 {ORDER_CLAIM_TYPE_LABELS[convertTo]} 전환</Button>
          </PopoverContent>
        </Popover> : null}
        <Popover onOpenChange={(open) => { setClientError(''); setRejectOpen(open); }} open={rejectOpen}>
          <PopoverTrigger render={<ActionBarItem disabled={deciding || overLimit} onSelect={(event) => event.preventDefault()} variant="destructive" />}>
            {ADMIN_CLAIM_BULK_ACTION_LABELS.reject}
          </PopoverTrigger>
          <PopoverContent className="w-96" side="top">
            <KitRejectionReasonField claimType={claimType} onChange={setNote} value={note} />
            {clientError ? <p className="text-sm text-destructive" role="alert">{clientError}</p> : null}
            <Button disabled={deciding} onClick={() => decide('reject')} variant="destructive">선택 {selectedIds.length}건 거부</Button>
          </PopoverContent>
        </Popover>
      </ActionBarGroup>
      {deciding ? <span className="text-sm text-muted-foreground" role="status">처리 중… 한 건씩 순서대로 처리합니다.</span> : null}
    </ActionBar>

    {stepSession ? <ClaimBulkStepDialog claimType={claimType} onClose={closeStep} previewHrefBase={currentHref} session={stepSession} /> : null}
  </div>;
}
