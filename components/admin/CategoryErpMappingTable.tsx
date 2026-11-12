'use client';

import { useActionState, useMemo, useRef, useState } from 'react';
import { saveAdminCategoryErpMappingAction, type AdminCategoryActionState } from '@/app/admin/category-actions';
import type { AdminCategoryErpMapping, AdminCategoryNode } from '@/lib/admin/category';
import { createErpCategoryIndex } from '@/lib/admin/erp-items';
import { toKstDateTimeInput } from '@/lib/admin/goods-price-periods';
import { filterAdminSearchSelectOptions, type AdminSearchSelectOption } from './console/AdminSearchSelect';
import { ConsolePagination } from './console/ConsolePagination';
import { Button } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

const PAGE_SIZE = 50;
const EMPTY: AdminCategoryActionState = {};
const LEAVE_MESSAGE = '저장하지 않은 ERP 분류 매핑이 있습니다. 이 화면을 떠나면 입력이 사라집니다. 이동할까요?';

interface MappingDraft {
  erpCode: string;
  erpName: string;
  source: string;
  verifiedAt: string;
}

interface MappingListRow extends AdminSearchSelectOption {
  code: string;
  mapping: AdminCategoryErpMapping | undefined;
}

function savedValues(mapping: AdminCategoryErpMapping | undefined): MappingDraft {
  return {
    erpCode: mapping?.erpCode ?? '',
    erpName: mapping?.erpName ?? '',
    source: mapping?.source ?? '',
    verifiedAt: toKstDateTimeInput(mapping?.verifiedAt ?? null),
  };
}

function sameValues(left: MappingDraft, right: MappingDraft) {
  return left.erpCode === right.erpCode && left.erpName === right.erpName && left.source === right.source && left.verifiedAt === right.verifiedAt;
}

function MappingRow({ row, draft, onDraftChange }: {
  row: MappingListRow;
  draft: MappingDraft | undefined;
  onDraftChange: (categoryId: string, draft: MappingDraft | undefined) => void;
}) {
  /* 저장을 누른 때의 입력. 그 뒤 값을 고치면 지난 실패 문구는 지금 값에 대한 말이 아니다. */
  const [submitted, setSubmitted] = useState<MappingDraft | undefined>(undefined);
  const [state, action, pending] = useActionState(async (previous: AdminCategoryActionState, formData: FormData) => {
    setSubmitted(draft);
    const next = await saveAdminCategoryErpMappingAction(previous, formData);
    if (next.message) onDraftChange(row.value, undefined);
    return next;
  }, EMPTY);
  const formId = `category-erp-mapping-${row.value}`;
  const saved = savedValues(row.mapping);
  const values = draft ?? saved;
  const change = (field: keyof MappingDraft, value: string) => {
    const next = { ...values, [field]: value };
    onDraftChange(row.value, sameValues(next, saved) ? undefined : next);
  };
  const error = draft && draft === submitted ? state.errors?.form ?? state.errors?.erpCode ?? state.errors?.erpName ?? state.errors?.source ?? state.errors?.categoryId : undefined;
  const field = (name: keyof MappingDraft, label: string, extra: { placeholder?: string; type?: string } = {}) => <TableCell className="align-top">
    <Input aria-label={`${row.label} ${label}`} disabled={pending} form={formId} name={name} onChange={(event) => change(name, event.target.value)} required value={values[name]} {...extra} />
  </TableCell>;
  return <TableRow>
    <TableHead scope="row" className="h-auto pt-3 pb-2 align-top text-sm font-normal wrap-anywhere whitespace-normal text-foreground">
      {row.label}
      <code className="ml-1 rounded bg-muted px-1 py-0.5 text-xs">{row.code}</code>
    </TableHead>
    {field('erpCode', 'ERP 코드')}
    {field('erpName', 'ERP 품명')}
    {field('source', '출처', { placeholder: 'ERP 분류표 버전/파일' })}
    {field('verifiedAt', '검증 시각', { type: 'datetime-local' })}
    <TableCell className="align-top whitespace-normal">
      <form action={action} className="flex flex-wrap items-center gap-x-2 gap-y-1" id={formId}>
        <input name="categoryId" type="hidden" value={row.value} /><input name="operationId" type="hidden" value="" />
        <Button size="sm" variant="outline" type="submit" disabled={pending || !draft}>{pending ? '저장 중' : '저장'}</Button>
        <span className="text-xs text-success" role="status">{!draft && state.message ? '저장됨' : ''}</span>
      </form>
      {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
    </TableCell>
  </TableRow>;
}

/**
 * 고객 카테고리 마지막 단계별 ERP 코드·품명 입력 표(정본 매핑). 카드를 카테고리마다 펼치면 화면이 카테고리 수만큼 길어진다
 * (2026-11-10 사람 눈 시험: 336개에 10만 px). 경로로 찾고 행에서 고치며, 높이와 그리는 행 수는 카테고리 수와 무관하다.
 */
export function CategoryErpMappingTable({ categories, mappings }: {
  categories: readonly AdminCategoryNode[];
  mappings: readonly AdminCategoryErpMapping[];
}) {
  const rows = useMemo<MappingListRow[]>(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    const mappingById = new Map(mappings.map((mapping) => [mapping.categoryId, mapping]));
    return createErpCategoryIndex(categories).leaves.map((leaf) => {
      const code = byId.get(leaf.id)?.code ?? '';
      const mapping = mappingById.get(leaf.id);
      return { value: leaf.id, label: leaf.label, code, mapping, keywords: [leaf.label.replaceAll(' > ', '>'), code, mapping?.erpCode, mapping?.erpName].filter(Boolean).join(' ') };
    });
  }, [categories, mappings]);
  const [query, setQuery] = useState('');
  const [unsetOnly, setUnsetOnly] = useState(false);
  const [page, setPage] = useState(1);
  /* 저장하지 않은 입력(카테고리 id → 값). 표에 하나만 두어 검색·페이지 이동으로 행이 빠져도 남고, 떠날 때 한 번만 묻는다. */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, MappingDraft>>(() => new Map());
  useAdminLeaveGuard({ dirty: drafts.size > 0, message: LEAVE_MESSAGE });
  const tableScroller = useRef<HTMLDivElement>(null);
  const setDraft = (categoryId: string, draft: MappingDraft | undefined) => setDrafts((current) => {
    const next = new Map(current);
    if (draft) next.set(categoryId, draft);
    else next.delete(categoryId);
    return next;
  });
  const goToPage = (next: number) => { setPage(next); tableScroller.current?.scrollTo({ top: 0 }); };
  const filtered = filterAdminSearchSelectOptions(rows, query).filter((row) => !unsetOnly || !row.mapping);
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, lastPage);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const unset = rows.filter((row) => !row.mapping).length;

  if (!rows.length) return <p className="text-sm text-muted-foreground">ERP 분류를 매핑할 마지막 단계 카테고리가 없습니다. 위에서 카테고리를 먼저 등록해주세요.</p>;
  return <div className="flex min-w-0 flex-col gap-3" data-category-erp-mapping="table">
    <p className="text-sm text-muted-foreground">마지막 단계 카테고리 {rows.length.toLocaleString('ko-KR')}개 중 {(rows.length - unset).toLocaleString('ko-KR')}개 입력됨 · {unset ? <strong className="font-semibold text-warning">미설정 {unset.toLocaleString('ko-KR')}개</strong> : '미설정 0개'}</p>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="text-sm font-medium" htmlFor="category-erp-mapping-filter">카테고리·ERP 코드 찾기</label>
      <Input className="w-full sm:w-64" id="category-erp-mapping-filter" maxLength={100} onChange={(event) => { setQuery(event.target.value); goToPage(1); }} placeholder="예: 문구 > 키링, ERP-001" type="search" value={query} />
      <label className="flex cursor-pointer items-center gap-2 text-sm"><input checked={unsetOnly} onChange={(event) => { setUnsetOnly(event.target.checked); goToPage(1); }} type="checkbox" /> 미설정만</label>
    </div>
    <div ref={tableScroller} className="relative max-h-[520px] min-w-0 overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:max-h-none print:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted" role="region" aria-label="카테고리별 ERP 분류 매핑" tabIndex={0}>
      <table className="w-full min-w-[1040px] table-fixed caption-top text-sm" data-slot="table">
        <caption className="px-2 py-2 text-left text-sm text-muted-foreground">마지막 단계 카테고리별 ERP 코드·품명. 검증 시각은 KST입니다.</caption>
        <colgroup><col className="w-[26%]" /><col className="w-36" /><col /><col className="w-44" /><col className="w-48" /><col className="w-32" /></colgroup>
        <TableHeader><TableRow className="bg-muted/50"><TableHead scope="col">카테고리 경로</TableHead><TableHead scope="col">ERP 코드</TableHead><TableHead scope="col">ERP 품명</TableHead><TableHead scope="col">출처</TableHead><TableHead scope="col">검증 시각</TableHead><TableHead scope="col">저장</TableHead></TableRow></TableHeader>
        <TableBody>
          {pageRows.map((row) => <MappingRow draft={drafts.get(row.value)} key={row.value} onDraftChange={setDraft} row={row} />)}
          {!pageRows.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>조건에 맞는 카테고리가 없습니다.</TableCell></TableRow> : null}
        </TableBody>
      </table>
    </div>
    <ConsolePagination label="ERP 분류 매핑 페이지" onPageChange={goToPage} page={current} pageSize={PAGE_SIZE} total={filtered.length} unit="개" />
  </div>;
}
