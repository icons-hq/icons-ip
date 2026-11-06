'use client';

import { Subscribe, type ColumnDef, type RowSelectionState, type SortingState, type Table as CoreTable } from '@tanstack/react-table';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { startTransition, useActionState, useId, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { bulkDecideOrderClaimsAction } from '@/app/admin/claim-actions';
import { DataTable } from '@/components/admin/kit/data-table/data-table';
import { DataTableColumnHeader } from '@/components/admin/kit/data-table/data-table-column-header';
import { DataTablePagination } from '@/components/admin/kit/data-table/data-table-pagination';
import { DataTableToolbar } from '@/components/admin/kit/data-table/data-table-toolbar';
import type { ConsoleDateRange } from '@/components/admin/console/date-presets';
import { KitDatePresets } from '@/components/admin/kit/date-presets';
import { ConsoleTableSettings, type ConsoleTableSettingsColumn } from '@/components/admin/kit/console-table-settings';
import type { DataTableFeatures } from '@/components/admin/kit/lib/data-table-features';
import { ActionBar, ActionBarClose, ActionBarGroup, ActionBarItem, ActionBarSelection, ActionBarSeparator } from '@/components/admin/kit/ui/action-bar';
import { Button } from '@/components/admin/kit/ui/button';
import { Checkbox } from '@/components/admin/kit/ui/checkbox';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/admin/kit/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/admin/kit/ui/select';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { useConsoleTable, type ConsoleTableState } from '@/components/admin/kit/use-console-table';
import {
  ADMIN_CLAIM_BULK_ACTION_LABELS,
  ADMIN_CLAIM_BULK_LIMIT,
  ADMIN_CLAIM_BULK_OUTCOME_LABELS,
  planAdminClaimBulkSubmit,
  type AdminClaimBulkDecision,
  type AdminClaimBulkState,
} from '@/lib/admin/claim-bulk';
import {
  adminClaimHref,
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
import { ClaimPreviewLink } from './ClaimPreviewDialog';

/*
 * 취소·반품·교환 목록 — admin kit(shadcn/ui · Base UI · Dice UI data table, ADR-0028).
 * 세 유형이 같은 표를 쓰고, 유형마다 다른 것은 문구·단계·사유 선택지뿐이다.
 *
 * 판정은 바뀌지 않는다: 조회는 서버가 `admin_search_order_claims_console`로, 처리는
 * `bulkDecideOrderClaimsAction`이 한 건씩 기존 단건 경로로 한다. 이 파일은 화면만 바꾼다.
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
    pageSize: next.pagination.pageSize === 20 ? undefined : next.pagination.pageSize,
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
      size: 110,
    },
    { id: 'order', accessorKey: 'order', enableSorting: false, header: '주문번호', meta: { label: '주문번호' }, cell: ({ row }) => <span className="tabular-nums">{row.original.order}</span>, size: 190 },
    { id: 'type', accessorKey: 'type', enableSorting: false, header: '유형', meta: { label: '유형' }, size: 70 },
    {
      id: 'reason',
      accessorKey: 'reason',
      enableColumnFilter: true,
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="사유" />,
      meta: { label: `${typeLabel}사유`, variant: 'select', options: reasonOptions },
      size: 150,
    },
    {
      id: 'stage',
      accessorKey: 'stage',
      enableColumnFilter: true,
      enableSorting: false,
      header: ({ column }) => <DataTableColumnHeader column={column} label="상태" />,
      meta: { label: `${typeLabel}처리상태`, variant: 'select', options: stageOptions },
      size: 110,
    },
    { id: 'buyer', accessorKey: 'buyer', enableSorting: false, header: '구매자', meta: { label: '구매자' }, cell: ({ row }) => <>@{row.original.buyer}</> },
    {
      id: 'amount',
      accessorKey: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} label="주문금액" />,
      meta: { label: '주문금액' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.amountLabel}</span>,
      size: 120,
    },
    {
      id: 'requested',
      accessorKey: 'requestedAt',
      enableColumnFilter: true,
      header: ({ column }) => <DataTableColumnHeader column={column} label="접수일" />,
      cell: ({ row }) => <time dateTime={row.original.requestedAt}>{row.original.requestedLabel}</time>,
      meta: { label: dateLabel, variant: 'date', filter: 'range' },
      size: 150,
    },
    { id: 'sla', accessorKey: 'slaLabel', enableSorting: false, header: '환급 기한', meta: { label: '환급 기한' }, cell: ({ row }) => <span data-sla-tone={row.original.slaTone}>{row.original.slaLabel}</span>, size: 116 },
    { id: 'refund', accessorKey: 'refund', enableSorting: false, header: '환불 수단', meta: { label: '환불 수단' }, cell: ({ row }) => row.original.refund ?? <span className="text-muted-foreground">미접수</span>, size: 110 },
    { id: 'handler', accessorKey: 'handler', enableSorting: false, header: '처리자', meta: { label: '처리자' }, cell: ({ row }) => row.original.handler ? <>@{row.original.handler}</> : <span className="text-muted-foreground">미배정</span>, size: 104 },
  ];
}

/* 조회항목 설정의 열. 키는 기존 표(ClaimQueueScreen)와 같아, 같은 저장 키에서 운영자가 저장한 배치가 이어진다. */
const PREFERENCE_COLUMNS: readonly ConsoleTableSettingsColumn[] = [
  { key: 'reference', label: '요청번호' }, { key: 'order', label: '주문번호' }, { key: 'type', label: '유형' },
  { key: 'reason', label: '사유' }, { key: 'stage', label: '상태' }, { key: 'buyer', label: '구매자' },
  { key: 'amount', label: '주문금액' }, { key: 'requested', label: '접수일' }, { key: 'sla', label: '환급 기한' },
  { key: 'refund', label: '환불 수단' }, { key: 'handler', label: '처리자' },
];

/**
 * 검색어는 조합이 끝난 뒤에만 확정한다. Dice UI의 텍스트 필터는 입력할 때마다 값을 올려 보내
 * (조합 중인 한글도) URL·서버 재조회로 이어지므로 쓰지 않는다. Enter의 조합 확정 키는 검색을 보내지 않는다.
 */
function ClaimSearchBox({ field, fieldOptions, onSearch, pending, query, typeLabel }: {
  field: string;
  fieldOptions: readonly Option[];
  onSearch: (field: string, query: string) => void;
  pending: boolean;
  query: string;
  typeLabel: string;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(query);
  const [draftField, setDraftField] = useState(field);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(draftField, draft.trim());
  }
  return <form aria-label={`${typeLabel} 요청 검색`} className="flex flex-wrap items-center gap-2" onSubmit={submit} role="search">
    <Select items={fieldOptions} onValueChange={(value) => { if (typeof value === 'string') setDraftField(value); }} value={draftField}>
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
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}
      placeholder="주문번호 · 요청번호 · 구매자 · 수취인 · 상품번호"
      value={draft}
    />
    <Button disabled={pending} type="submit">검색</Button>
  </form>;
}

const CUSTOM_REASON = '__custom';

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
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [note, setNote] = useState('');
  const [clientError, setClientError] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const typeLabel = ORDER_CLAIM_TYPE_LABELS[claimType];
  const dateField = filters.dateField ?? 'requested';
  const dateLabel = dateFieldOptions.find((option) => option.value === dateField)?.label ?? '요청일';
  /*
   * 열 정의는 유형·기간 기준이 바뀔 때만 새로 만든다. flexRender는 셀 함수를 컴포넌트로 그리므로 열이 새로
   * 만들어지면 모든 셀이 다시 마운트되고, 상세 팝업을 연 요청번호 링크도 교체돼 닫은 뒤 포커스를 돌려줄 곳이
   * 사라진다. 그래서 서버가 이동마다 새로 보내는 옵션 배열을 받지 않고 여기서 유형으로 만든다.
   */
  const columns = useMemo(() => buildColumns(claimType, dateLabel), [claimType, dateLabel]);
  const currentHref = adminClaimHref(claimType, filters);

  const { pending, preferences, savePreferences, table } = useConsoleTable({
    columns,
    data: rows,
    enableRowSelection: (row) => row.original.selectable,
    getRowId: (row) => row.id,
    hrefFor: (next) => adminClaimHref(claimType, claimKitFiltersFor(filters, next)),
    onRowSelectionChange: setSelection,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    preferenceColumns: PREFERENCE_COLUMNS,
    preferencesKey: `sales-claims-${claimType}`,
    rowSelection: selection,
    state: claimKitStateFor(filters, pageSize),
  });

  const [state, run, deciding] = useActionState(async (previous: AdminClaimBulkState, formData: FormData) => {
    let next: AdminClaimBulkState;
    try {
      next = await bulkDecideOrderClaimsAction(previous, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: BULK_RESULT_LOST };
    }
    if (next.results) {
      setSelection(Object.fromEntries(next.results.filter((result) => result.outcome === 'skipped').map((result) => [result.claimId, true])));
    }
    return next;
  }, EMPTY_STATE);

  const eligible = new Set(rows.filter((row) => row.selectable).map((row) => row.id));
  const selectedIds = Object.keys(selection).filter((id) => selection[id] && eligible.has(id));
  const overLimit = selectedIds.length > ADMIN_CLAIM_BULK_LIMIT;

  function decide(decision: AdminClaimBulkDecision) {
    if (deciding) return;
    const plan = planAdminClaimBulkSubmit({ claimType, count: selectedIds.length, decision, note }, (message) => window.confirm(message));
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

  function onSearch(field: string, query: string) {
    startSearch(() => {
      router.push(adminClaimHref(claimType, {
        ...filters,
        field: field === 'all' ? undefined : field as AdminClaimFilters['field'],
        page: 1,
        query,
      }), { scroll: false });
    });
  }

  function onDateField(value: string) {
    startSearch(() => {
      router.push(adminClaimHref(claimType, {
        ...filters,
        dateField: value === 'requested' ? undefined : value as AdminClaimFilters['dateField'],
        page: 1,
      }), { scroll: false });
    });
  }

  /* 기간 프리셋은 기간 기준(요청일 등)을 그대로 두고 기간만 바꾼다. 기존 화면의 프리셋과 같은 KST 기간이다. */
  function onDatePreset(range: ConsoleDateRange) {
    startSearch(() => {
      router.push(adminClaimHref(claimType, { ...filters, from: range.from, page: 1, to: range.to }), { scroll: false });
    });
  }

  const error = clientError || state.error;
  const busy = pending || searching;

  return <div className="flex min-w-0 flex-col gap-3" data-admin-kit="claims-table" data-pending={busy ? 'true' : undefined}>
    <ClaimSearchBox
      field={filters.field ?? 'all'}
      fieldOptions={searchFieldOptions}
      key={`${filters.field ?? 'all'}:${filters.query}`}
      onSearch={onSearch}
      pending={busy}
      query={filters.query}
      typeLabel={typeLabel}
    />
    <DataTable
      aria-label={`${typeLabel} 요청 목록`}
      emptyLabel={`조건에 맞는 ${typeLabel} 요청이 없습니다.`}
      pagination={<DataTablePagination pageSizeOptions={PAGE_SIZE_OPTIONS} table={table} />}
      table={table}
    >
      <DataTableToolbar
        filtersEnd={<>
          <Select items={dateFieldOptions} onValueChange={(value) => { if (typeof value === 'string') onDateField(value); }} value={dateField}>
            <SelectTrigger aria-label="기간 기준" className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dateFieldOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <KitDatePresets disabled={busy} from={filters.from} onSelect={onDatePreset} to={filters.to} />
        </>}
        table={table}
        viewOptions={<ConsoleTableSettings columns={PREFERENCE_COLUMNS} onSave={savePreferences} preferences={preferences} />}
      />
    </DataTable>

    <ActionBar
      aria-label="선택 건 일괄 처리"
      onOpenChange={(open) => { if (!open && !deciding) setSelection({}); }}
      open={selectedIds.length > 0}
    >
      <ActionBarSelection>
        {selectedIds.length}건 선택 · 최대 {ADMIN_CLAIM_BULK_LIMIT}건
        <ActionBarSeparator />
        <ActionBarClose aria-label="선택 해제"><X /></ActionBarClose>
      </ActionBarSelection>
      <ActionBarSeparator />
      <ActionBarGroup>
        {(['approve', 'review'] as const).map((decision) => <ActionBarItem
          disabled={deciding || overLimit}
          key={decision}
          onSelect={(event) => { event.preventDefault(); decide(decision); }}
          variant={decision === 'approve' ? 'default' : 'secondary'}
        >{ADMIN_CLAIM_BULK_ACTION_LABELS[decision]}</ActionBarItem>)}
        <Popover onOpenChange={setRejectOpen} open={rejectOpen}>
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

    {overLimit ? <p className="text-sm text-destructive" role="alert">한 번에 {ADMIN_CLAIM_BULK_LIMIT}건까지 처리할 수 있습니다. 선택을 줄여주세요.</p> : null}
    {error && !rejectOpen ? <p className="text-sm text-destructive" role="alert">{adminClaimCopy(error)}</p> : null}
    <ClaimKitBulkResult previewHrefBase={currentHref} state={state} />
  </div>;
}

/** 일괄 처리의 건별 결과표. 목록에서 빠진 요청도 남고, 요청번호는 같은 목록 위 팝업을 연다. */
export function ClaimKitBulkResult({ previewHrefBase, state }: { previewHrefBase: string; state: AdminClaimBulkState }) {
  if (!state.results?.length) return null;
  return <section aria-label="일괄 처리 결과" className="flex flex-col gap-2">
    <p className="text-sm" role="status">{state.summary}</p>
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableCaption>일괄 처리 결과</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">번호</TableHead><TableHead scope="col">결과</TableHead><TableHead scope="col">사유</TableHead></TableRow></TableHeader>
        <TableBody>
          {state.results.map((result) => <TableRow data-outcome={result.outcome} key={result.claimId}>
            <TableCell>{result.reference
              ? <ClaimPreviewLink href={`${previewHrefBase}&claimId=${result.claimId}`} label={`요청 ${result.reference} 상세 열기`}>{result.reference}</ClaimPreviewLink>
              : <span className="text-muted-foreground">확인 불가</span>}</TableCell>
            <TableCell>{ADMIN_CLAIM_BULK_OUTCOME_LABELS[result.outcome]}</TableCell>
            <TableCell className="whitespace-normal">{adminClaimCopy(result.message)}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
  </section>;
}
