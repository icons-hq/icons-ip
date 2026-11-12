'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { unstable_rethrow, useRouter } from 'next/navigation';
import { setErpCategoryMappingAction, setErpCategoryMappingsAction, type ErpCategoryMappingResult, type ErpCategoryMappingsResult } from '@/app/admin/erp-item-actions';
import type { AdminCategoryErpMapping, AdminCategoryNode } from '@/lib/admin/category';
import {
  conflictingCategoryErpMapping,
  createErpCategoryIndex,
  ERP_CATEGORY_MAPPING_BATCH_LIMIT,
  erpCategoryMappingBatchMessage,
  type ErpCategoryIndex,
  type ErpCategoryMappingEntry,
  type ErpCategoryMappingRow,
  type ErpCategorySuggestion,
} from '@/lib/admin/erp-items';
import { AdminStatusBadge } from './console/AdminKit';
import { AdminSearchSelect, type AdminSearchSelectOption } from './console/AdminSearchSelect';
import { ConsoleBulkActionBar } from './console/ConsoleBulkActionBar';
import { Button } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';
import { useErpItemsWorkspace } from './ErpItemsWorkspace';

/* 선택지는 칸을 열 때만 그려 행이 늘어도 가볍다. 한 번에 저장할 수 있는 만큼만 보여 '전체 선택'이 보이는 행만 고르게 한다. */
const VISIBLE_LIMIT = ERP_CATEGORY_MAPPING_BATCH_LIMIT;
const LEAVE_MESSAGE = '저장하지 않은 ERP 분류 연결이 있습니다. 이 화면을 떠나면 고른 연결이 사라집니다. 이동할까요?';

const NO_LINK: AdminSearchSelectOption = { value: '', label: '연결 안 함' };
const NO_LINK_ONLY = [NO_LINK];
const NO_LOCAL_VALUES: ReadonlyMap<string, string> = new Map();
const UNCONFIRMED = '저장 결과를 확인하지 못했습니다. 고른 값은 그대로이니 다시 저장해주세요. 같은 값을 다시 저장해도 안전합니다.';

function suggestionText(basis: ErpCategorySuggestion['basis']) {
  return basis === 'erp_mapping' ? '고객 카테고리의 ERP 분류 매핑대로 연결' : '같은 경로로 연결';
}

/* 제안을 그대로 고른 것은 어긋남이 아니다. 제안은 공백·대소문자를 무시해 고르고 경고는 글자를 그대로 비교해서, 같은 매핑을 다른 분류라고 말하게 된다. */
function mappingConflict(erpCategory: string, categoryId: string, index: ErpCategoryIndex, mappings: Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[]) {
  return index.suggest(erpCategory)?.categoryId === categoryId ? null : conflictingCategoryErpMapping(erpCategory, categoryId, mappings);
}

function MappingRow({ row, options, index, categoryErpMappings, draft, onDraftChange, saved, suggestion, onSaved, selected: checked, onSelect, locked, notice, batchRun }: {
  row: ErpCategoryMappingRow;
  options: readonly AdminSearchSelectOption[];
  index: ErpCategoryIndex;
  categoryErpMappings: Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[];
  /** 고르고 아직 저장하지 않은 값. */
  draft: string | undefined;
  onDraftChange: (erpCategory: string, value: string | undefined) => void;
  /** 지금 저장돼 있는 연결. 없으면 빈 문자열. */
  saved: string;
  suggestion: ErpCategorySuggestion | null;
  onSaved: (erpCategory: string, categoryId: string) => void;
  selected: boolean;
  onSelect: (erpCategory: string, selected: boolean) => void;
  /** 일괄 저장 중이면 이 행도 잠근다. */
  locked: boolean;
  /** 일괄 저장에서 이 행이 거절된 사유. */
  notice: string | undefined;
  /** 일괄 저장을 시작한 횟수. 그 전에 이 행을 저장한 결과 문구는 더 이상 지금 값에 대한 말이 아니다. */
  batchRun: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string; batchRun: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = draft ?? saved;
  /* 새 연결이 없으면 DB가 자동으로 잇는 말단: 고객 카테고리의 정본 ERP 분류 매핑(이름·코드 정확히 일치, 하나뿐) → `대>중>소` 전체 경로 일치. */
  const fallback = !saved && row.fallbackCategoryId ? row.fallbackCategoryId : null;
  const fallbackBasis = fallback ? index.fallbackBasis(row.erpCategory, fallback) : null;
  const conflict = selected ? mappingConflict(row.erpCategory, selected, index, categoryErpMappings) : null;
  const pathOf = (id: string) => index.pathLabel(id) ?? '삭제된 카테고리';
  /* 현재 연결이 보관됐거나 하위가 생긴 분류여도 칸이 엉뚱한 값을 보여 주지 않게 따로 표시한다. */
  /* 자동 연결이 있는 분류에 '연결 안 함'이라고 쓰면 아무것도 연결되지 않은 줄로 읽힌다(2026-11-10 사람 눈 시험). 비우면 실제로 일어나는 일을 쓴다. */
  const empty = row.fallbackCategoryId ? { value: '', label: `자동 연결 · ${pathOf(row.fallbackCategoryId)}` } : NO_LINK;
  const pinned = saved && !index.isLeaf(saved)
    ? [empty, { value: saved, label: `${pathOf(saved)} · 지금은 연결할 수 없음` }]
    : empty === NO_LINK ? NO_LINK_ONLY : [empty];
  const disabled = pending || locked;

  /* 지난 저장 결과는 그때의 값에 대한 것이다. 값을 바꿨는데 초록 문구가 남으면 지금 값이 저장된 줄로 읽힌다. */
  const choose = (value: string) => {
    if (value !== selected) setStatus(null);
    onDraftChange(row.erpCategory, value === saved ? undefined : value);
  };

  const save = (categoryId: string) => {
    setStatus(null);
    startTransition(async () => {
      let result: ErpCategoryMappingResult;
      /* 응답을 못 받아도(네트워크·새 배포) 오류 화면으로 넘어가면 다른 행에 고른 값까지 사라진다. 로그인 이동은 그대로 흘려보낸다. */
      try { result = await setErpCategoryMappingAction({ erpCategory: row.erpCategory, categoryId: categoryId || null }); }
      catch (error) { unstable_rethrow(error); setStatus({ tone: 'error', text: UNCONFIRMED, batchRun }); return; }
      if (!result.ok) { setStatus({ tone: 'error', text: result.error, batchRun }); return; }
      onSaved(row.erpCategory, result.categoryId ?? '');
      onDraftChange(row.erpCategory, undefined);
      setStatus({ tone: 'ok', text: result.message, batchRun });
      if (result.changed) router.refresh();
    });
  };

  /* 일괄 저장 뒤에는 그 결과가 이 행의 최신 소식이다. 지난 개별 저장 문구가 거절 사유를 가리면 안 된다. */
  const message = notice ? { tone: 'error' as const, text: notice } : status?.batchRun === batchRun ? status : null;
  return <TableRow>
    <TableCell className="p-0 align-top">
      <label className="flex cursor-pointer justify-center pt-3.5 pb-2"><input aria-label={`${row.erpCategory} 선택`} checked={checked} disabled={locked} onChange={(event) => onSelect(row.erpCategory, event.target.checked)} type="checkbox" /></label>
    </TableCell>
    {/* 첫 줄 글자를 선택 칸 글자와 같은 높이에 맞춘다(칸 위 여백 8 + 선택 칸 안 여백 6). */}
    <TableHead scope="row" className="h-auto pt-3.5 pb-2 align-top text-sm font-normal wrap-anywhere whitespace-normal text-foreground">{row.erpCategory}</TableHead>
    <TableCell className="pt-3.5 text-right align-top tabular-nums">{row.itemCount.toLocaleString('ko-KR')}</TableCell>
    <TableCell className="align-top whitespace-normal">
      <div className="flex min-w-0 flex-col gap-1">
        <AdminSearchSelect aria-label={`${row.erpCategory} 고객 카테고리`} disabled={disabled} emptyMessage="일치하는 카테고리가 없습니다." onValueChange={choose} options={options} pinnedOptions={pinned} searchPlaceholder="카테고리 이름으로 찾기" value={selected} />
        {/* 저장하면 생기거나 사라지는 표시는 이 한 줄에 모으고 높이를 늘 잡아 둔다. 저장해도 아래 행이 움직이지 않는다. */}
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
          {/* 연결 칸에서 처리할 분류만 표시한다. 자동으로 이어지는 분류는 표시하지 않는다. */}
          {!saved && !fallback ? <AdminStatusBadge tone="warning">연결 필요</AdminStatusBadge> : null}
          {suggestion ? <Button className="h-auto min-h-5 px-1.5 py-0 text-left text-xs whitespace-normal" size="sm" variant="ghost" type="button" disabled={disabled}
            aria-label={`${row.erpCategory}: ${suggestionText(suggestion.basis)} · ${suggestion.label}`}
            onClick={() => save(suggestion.categoryId)}>
            {suggestionText(suggestion.basis)} · {suggestion.label}
          </Button> : null}
          {fallback && !selected ? <p className="text-xs text-muted-foreground">
            {fallbackBasis === 'same_path'
              ? <>같은 경로의 ‘{pathOf(fallback)}’ 카테고리에 자동으로 연결됩니다. 다른 카테고리를 쓰려면 골라 저장해주세요.</>
              : <>고객 카테고리의 ERP 분류 매핑에 따라 ‘{pathOf(fallback)}’ 카테고리를 제안합니다. 다른 카테고리를 쓰려면 골라 저장해주세요.</>}
          </p> : null}
          {conflict ? <p className="text-xs text-warning" role="status">
            고른 카테고리는 고객 카테고리 화면에서 다른 ERP 분류(‘{conflict.erpName}’, {conflict.erpCode})에 매핑돼 있습니다. 맞는 카테고리인지 확인해주세요.
          </p> : null}
          <span aria-live="polite" className={`text-xs ${message?.tone === 'error' ? 'text-destructive' : 'text-success'}`}>{message?.text ?? ''}</span>
        </div>
      </div>
    </TableCell>
    {/* 선택 칸(32px)과 가운데가 맞게 버튼(28px)을 2px 내린다. */}
    <TableCell className="pt-2.5 align-top">
      {/* 저장된 연결도 고른 카테고리도 없으면 할 일이 없으므로 버튼을 두지 않는다(제안 연결 저장 중에는 '저장 중'을 보인다). 연결 해제는 저장된 연결을 비웠을 때만 보인다. */}
      {saved || selected || pending ? <Button size="sm" variant="outline" type="button" disabled={disabled || selected === saved} onClick={() => save(selected)}>
        {pending ? '저장 중' : selected ? '연결 저장' : '연결 해제'}
      </Button> : null}
    </TableCell>
  </TableRow>;
}

/** ERP 분류 ↔ 고객 카테고리 활성 말단 연결 표. 연결해 두면 옵션에서 ERP 품목을 고를 때 카테고리를 제안한다. */
export function ErpCategoryMappingPanel({ rows, categories, categoryErpMappings }: {
  rows: ErpCategoryMappingRow[];
  categories: AdminCategoryNode[];
  categoryErpMappings: Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  /* 표 안쪽을 내린 채 찾으면 결과 앞줄이 스크롤 위로 가려진다. 조건이 바뀌면 처음부터 보이게 한다. */
  const tableScroller = useRef<HTMLDivElement>(null);
  /* 1027T-016: 반입 결과의 '미연결 분류 N건 — 연결하기'가 이 표를 연결 필요만 보이게 열고 그 자리로 옮긴다. */
  const workspace = useErpItemsWorkspace();
  useEffect(() => {
    if (!workspace) return undefined;
    workspace.registerUnlinked(() => {
      setQuery('');
      setUnlinkedOnly(true);
      tableScroller.current?.scrollTo({ top: 0 });
      const section = document.getElementById('erp-category-mapping');
      section?.scrollIntoView({ block: 'start' });
      section?.focus({ preventScroll: true });
    });
    return () => workspace.registerUnlinked(null);
  }, [workspace]);
  /* 저장하지 않고 고른 값(ERP 분류 → 카테고리). 표에 하나만 두어 행이 검색으로 잠시 빠져도 남고, 떠날 때 행 수와 상관없이 한 번만 묻는다. */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  /* 위쪽 품목 표의 페이지 넘김·검색은 쿼리만 바꿔 이 표의 입력이 그대로 남는다.
     품목을 지워 목록에서 사라진 분류의 고른 값은 고칠 칸이 없으니 묻지도 저장하지도 않는다. */
  useAdminLeaveGuard({ dirty: rows.some((row) => drafts.has(row.erpCategory)), message: LEAVE_MESSAGE, survivesQueryChange: true });
  /* 일괄 처리할 행(체크한 ERP 분류). 지금 보이는 행만 실제로 처리한다. */
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkStatus, setBulkStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  /* 일괄 저장에서 거절된 행의 사유. 행을 고치면 그 행 사유만 지운다. */
  const [rowNotices, setRowNotices] = useState<ReadonlyMap<string, string>>(() => new Map());
  /* 저장 직후 새 목록이 오기 전까지 저장한 값을 표에 먼저 쓴다. 새 목록이 오면 서버 값이 기준이다(rows가 바뀌면 버린다). */
  const [localValues, setLocalValues] = useState<{ rows: ErpCategoryMappingRow[]; values: ReadonlyMap<string, string> }>(() => ({ rows, values: NO_LOCAL_VALUES }));
  const [batchRun, setBatchRun] = useState(0);
  const [bulkPending, startBulk] = useTransition();
  const locals = localValues.rows === rows ? localValues.values : NO_LOCAL_VALUES;
  const savedOf = (row: ErpCategoryMappingRow) => locals.get(row.erpCategory) ?? row.categoryId ?? '';
  const remember = (saved: readonly (readonly [string, string])[]) => setLocalValues((current) => ({
    rows,
    values: new Map([...(current.rows === rows ? current.values : NO_LOCAL_VALUES), ...saved]),
  }));
  const forgetNotice = (erpCategory: string) => setRowNotices((current) => {
    if (!current.has(erpCategory)) return current;
    const next = new Map(current);
    next.delete(erpCategory);
    return next;
  });
  const setDraft = (erpCategory: string, value: string | undefined) => {
    forgetNotice(erpCategory);
    setDrafts((current) => {
      const next = new Map(current);
      if (value === undefined) next.delete(erpCategory);
      else next.set(erpCategory, value);
      return next;
    });
  };
  /* 색인·선택지는 표 전체가 한 벌을 나눠 쓴다. 행마다 만들면 행×카테고리만큼 계산이 늘어난다. */
  const index = useMemo(() => createErpCategoryIndex(categories, categoryErpMappings), [categories, categoryErpMappings]);
  /* ERP 분류 원문은 `문구>키링`처럼 붙여 쓰므로 붙여 쓴 경로로도 찾게 한다. */
  const options = useMemo<AdminSearchSelectOption[]>(() => index.leaves.map((leaf) => ({ value: leaf.id, label: leaf.label, keywords: leaf.label.replaceAll(' > ', '>') })), [index]);
  const needle = query.trim().toLowerCase();
  const isLinked = (row: ErpCategoryMappingRow) => Boolean(savedOf(row) || row.fallbackCategoryId);
  const filtered = rows.filter((row) => (!needle || row.erpCategory.toLowerCase().includes(needle)) && (!unlinkedOnly || !isLinked(row)));
  const linked = rows.filter(isLinked).length;
  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const selectedRows = visible.filter((row) => checked.has(row.erpCategory));
  const someSelected = selectedRows.length > 0 && selectedRows.length < visible.length;
  const allSelected = visible.length > 0 && selectedRows.length === visible.length;
  /* 자동 연결된 분류는 이미 쓰이고 있어 저장 대상이 아니다. 저장하면 나중에 카테고리 구조가 바뀌어도 따라가지 않는다. */
  const suggestionOf = (row: ErpCategoryMappingRow) => savedOf(row) || row.fallbackCategoryId ? null : index.suggest(row.erpCategory);
  const suggestedEntries: ErpCategoryMappingEntry[] = visible.flatMap((row) => {
    const suggestion = drafts.has(row.erpCategory) ? null : suggestionOf(row);
    return suggestion ? [{ erpCategory: row.erpCategory, categoryId: suggestion.categoryId }] : [];
  });
  const draftEntries: ErpCategoryMappingEntry[] = rows.flatMap((row) => {
    const categoryId = drafts.get(row.erpCategory);
    return categoryId === undefined ? [] : [{ erpCategory: row.erpCategory, categoryId: categoryId || null }];
  });
  const count = (value: number) => value.toLocaleString('ko-KR');

  const select = (erpCategory: string, selected: boolean) => setChecked((current) => {
    const next = new Set(current);
    if (selected) next.add(erpCategory);
    else next.delete(erpCategory);
    return next;
  });
  const selectAll = (selected: boolean) => setChecked((current) => {
    const next = new Set(current);
    for (const row of visible) {
      if (selected) next.add(row.erpCategory);
      else next.delete(row.erpCategory);
    }
    return next;
  });

  const saveBatch = (entries: ErpCategoryMappingEntry[]) => {
    setBulkStatus(null);
    setRowNotices(new Map());
    setBatchRun((current) => current + 1);
    startBulk(async () => {
      /* 행마다 고른 값은 검색을 오가며 서버 상한(500건)보다 많이 쌓일 수 있다. 상한만큼 나눠 차례로 보내고,
         중간에 실패하면 저장된 묶음만 반영하고 나머지 체크와 고른 값은 그대로 둔다. */
      const rejected = new Map<string, string>();
      const done: ErpCategoryMappingEntry[] = [];
      let changed = 0;
      let unchanged = 0;
      let failure: string | null = null;
      for (let start = 0; start < entries.length && failure === null; start += ERP_CATEGORY_MAPPING_BATCH_LIMIT) {
        const chunk = entries.slice(start, start + ERP_CATEGORY_MAPPING_BATCH_LIMIT);
        let result: ErpCategoryMappingsResult;
        /* 응답을 못 받아도 체크와 고른 값을 지키고 다시 누르게 한다. DB는 같은 내용을 변경 없음으로 처리한다. 로그인 이동은 그대로 흘려보낸다. */
        try { result = await setErpCategoryMappingsAction(chunk); }
        catch (error) { unstable_rethrow(error); failure = UNCONFIRMED; break; }
        if (!result.ok) { failure = result.error; break; }
        changed += result.changed;
        unchanged += result.unchanged;
        for (const entry of result.rejected) rejected.set(entry.erpCategory, entry.error);
        done.push(...chunk.filter((entry) => !rejected.has(entry.erpCategory)));
      }
      remember(done.map((entry) => [entry.erpCategory, entry.categoryId ?? ''] as const));
      const doneNames = new Set(done.map((entry) => entry.erpCategory));
      setDrafts((current) => new Map([...current].filter(([erpCategory]) => !doneNames.has(erpCategory))));
      /* 거절된 행은 체크를 남겨 다른 카테고리로 바로 다시 처리하게 한다. */
      setChecked((current) => new Set([...current].filter((erpCategory) => !doneNames.has(erpCategory))));
      setRowNotices(rejected);
      const summary = erpCategoryMappingBatchMessage({ changed, unchanged, rejected: [...rejected] }, entries.every((entry) => entry.categoryId === null));
      /* 끝난 묶음의 행은 저장·변경 없음·거절 중 하나로 세어진다. */
      const processed = changed + unchanged + rejected.size;
      if (failure) {
        setBulkStatus({ tone: 'error', text: processed ? `${summary} 나머지 ${count(entries.length - processed)}건은 저장하지 못했습니다. ${failure}` : failure });
      } else {
        setBulkTarget('');
        setBulkStatus({ tone: rejected.size ? 'error' : 'ok', text: summary });
      }
      /* 거절은 대개 그사이 카테고리가 바뀐 경우라, 고칠 수 있게 선택지도 새로 받는다. */
      if (changed || rejected.size) router.refresh();
    });
  };

  const submitBulk = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (bulkPending || !selectedRows.length) return;
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.name;
    if (action !== 'link' && action !== 'unlink') return;
    if (action === 'unlink') {
      const linkedRows = selectedRows.filter((row) => savedOf(row));
      if (!linkedRows.length) return;
      if (!window.confirm(`선택한 ERP 분류 중 직접 연결한 ${count(linkedRows.length)}건의 연결을 해제할까요? 같은 경로나 ERP 분류 매핑이 맞는 카테고리가 있으면 자동 연결로 돌아갑니다.`)) return;
      saveBatch(linkedRows.map((row) => ({ erpCategory: row.erpCategory, categoryId: null })));
      return;
    }
    if (!bulkTarget) return;
    /* 자동 연결도 이미 쓰이는 연결이다. 직접 연결로 바꾸면 그 분류의 상품 옵션 제안이 달라진다. */
    const replaced = selectedRows.filter((row) => {
      const current = savedOf(row) || row.fallbackCategoryId;
      return current && current !== bulkTarget;
    }).length;
    if (replaced && !window.confirm(`이미 다른 카테고리에 연결된 ${count(replaced)}건(자동 연결 포함)이 들어 있습니다. 선택한 ${count(selectedRows.length)}건을 모두 ‘${index.pathLabel(bulkTarget) ?? ''}’에 연결할까요?`)) return;
    saveBatch(selectedRows.map((row) => ({ erpCategory: row.erpCategory, categoryId: bulkTarget })));
  };
  const saveSuggestions = () => {
    if (bulkPending || !suggestedEntries.length) return;
    if (!window.confirm(`제안된 카테고리로 ERP 분류 ${count(suggestedEntries.length)}건을 연결할까요? 상품은 바뀌지 않고, 연결은 표에서 다시 바꿀 수 있습니다.`)) return;
    saveBatch(suggestedEntries);
  };

  const bulkConflict = bulkTarget
    ? selectedRows.map((row) => mappingConflict(row.erpCategory, bulkTarget, index, categoryErpMappings)).find(Boolean) ?? null
    : null;
  const bulkLine = bulkConflict
    ? { tone: 'warning', text: `고른 카테고리는 고객 카테고리 화면에서 다른 ERP 분류(‘${bulkConflict.erpName}’, ${bulkConflict.erpCode})에 매핑돼 있습니다. 맞는 카테고리인지 확인해주세요.` }
    : bulkStatus;
  const bulkLineTone = (line: typeof bulkLine) => line?.tone === 'error' ? 'text-destructive' : line?.tone === 'warning' ? 'text-warning' : 'text-success';

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">반입한 품목에 ERP 분류가 없습니다. 반입할 때 ERP 분류 열을 골라주세요.</p>;
  }
  return <div className="flex min-w-0 flex-col gap-3" data-erp-items="mapping">
    <p className="text-sm text-muted-foreground">ERP 분류 {rows.length.toLocaleString('ko-KR')}개 중 {linked.toLocaleString('ko-KR')}개 연결됨 · {rows.length > linked ? <strong className="font-semibold text-warning">연결 필요 {(rows.length - linked).toLocaleString('ko-KR')}개</strong> : '연결 필요 0개'}. 여기서 연결해도 상품은 바뀌지 않습니다. 상품 옵션에서 ERP 품목을 고를 때 연결된 카테고리를 제안하는 데만 씁니다.</p>
    <p className="text-sm text-muted-foreground">직접 연결하지 않은 분류는 자동으로 연결됩니다. 카테고리 관리의 ERP 분류 매핑에 이름이나 코드가 똑같은 마지막 단계 카테고리가 하나뿐이면 그 카테고리에, 없으면 ‘대&gt;중&gt;소’ 전체 경로가 똑같은 마지막 단계 카테고리에 연결합니다. 이름만 같고 경로가 다르면 연결하지 않습니다. 여기서 직접 연결하면 자동 연결보다 먼저 적용됩니다.</p>
    {!options.length ? <p className="text-sm text-destructive" role="alert">연결할 마지막 단계 카테고리가 없습니다. 카테고리 관리에서 먼저 만들어주세요.</p> : null}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="text-sm font-medium" htmlFor="erp-category-filter">ERP 분류 찾기</label>
      <Input className="w-full sm:w-64" id="erp-category-filter" type="search" value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); tableScroller.current?.scrollTo({ top: 0 }); }} />
      <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={unlinkedOnly} onChange={(event) => { setUnlinkedOnly(event.target.checked); tableScroller.current?.scrollTo({ top: 0 }); }} /> 연결 필요만</label>
      {suggestedEntries.length || draftEntries.length ? <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {suggestedEntries.length ? <Button size="sm" variant="outline" type="button" disabled={bulkPending} onClick={saveSuggestions}>제안대로 {count(suggestedEntries.length)}건 연결</Button> : null}
        {draftEntries.length ? <Button size="sm" type="button" disabled={bulkPending} onClick={() => saveBatch(draftEntries)}>{bulkPending ? '저장 중' : `고른 ${count(draftEntries.length)}건 저장`}</Button> : null}
      </div> : null}
    </div>
    {/* 첫 칸을 체크할 때 표가 밀리지 않게 막대 높이를 비워 둔다. */}
    <form className="min-h-[50px]" onSubmit={submitBulk}>
      {selectedRows.length ? <ConsoleBulkActionBar
        label="선택한 ERP 분류"
        selectedCount={selectedRows.length}
        controls={<AdminSearchSelect aria-label="선택한 ERP 분류에 연결할 고객 카테고리" className="w-full bg-background sm:w-80" disabled={bulkPending} emptyMessage="일치하는 카테고리가 없습니다." onValueChange={setBulkTarget} options={options} placeholder="연결할 카테고리 선택" searchPlaceholder="카테고리 이름으로 찾기" value={bulkTarget} />}
        actions={[
          { label: bulkPending ? '저장 중' : '선택한 분류 연결', name: 'link', disabled: bulkPending || !bulkTarget },
          { label: '연결 해제', name: 'unlink', variant: 'ghost', disabled: bulkPending || !selectedRows.some((row) => savedOf(row)) },
        ]}
      /> : <p className={`py-2 text-sm ${bulkStatus ? bulkLineTone(bulkStatus) : 'text-muted-foreground'}`} role="status">{bulkStatus?.text ?? '표 왼쪽 칸을 체크하면 여러 ERP 분류를 같은 카테고리로 한 번에 연결합니다. 검색으로 좁힌 뒤 머리글 칸을 체크하면 보이는 행 전체를 고릅니다.'}</p>}
    </form>
    {selectedRows.length && bulkLine ? <p className={`text-sm ${bulkLineTone(bulkLine)}`} role="status">{bulkLine.text}</p> : null}
    <div ref={tableScroller} className="relative max-h-[520px] min-w-0 overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:max-h-none print:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted" role="region" aria-label="ERP 분류 연결" tabIndex={0}>
      {/* 열 폭을 고정한다. 내용 폭으로 정하면 저장 결과 문구가 나타날 때 고객 카테고리 열이 좁아진다. */}
      <table className="w-full min-w-[760px] table-fixed caption-top text-sm" data-slot="table">
        <caption className="px-2 py-2 text-left text-sm text-muted-foreground">ERP 분류별 고객 카테고리{filtered.length > VISIBLE_LIMIT ? ` · 앞 ${VISIBLE_LIMIT}개만 표시, 검색으로 좁혀주세요` : ''}</caption>
        <colgroup><col className="w-10" /><col className="w-[28%]" /><col className="w-20" /><col /><col className="w-28" /></colgroup>
        <TableHeader><TableRow className="bg-muted/50"><TableHead className="p-0" scope="col"><label className="flex h-10 cursor-pointer items-center justify-center"><input aria-label="보이는 ERP 분류 전체 선택" checked={allSelected} disabled={!visible.length || bulkPending} onChange={(event) => selectAll(event.target.checked)} ref={(element) => { if (element) element.indeterminate = someSelected; }} type="checkbox" /></label></TableHead><TableHead scope="col">ERP 분류</TableHead><TableHead scope="col" className="text-right">품목 수</TableHead><TableHead scope="col">고객 카테고리</TableHead><TableHead scope="col">저장</TableHead></TableRow></TableHeader>
        <TableBody>
          {visible.map((row) => <MappingRow key={row.erpCategory} row={row} options={options} index={index} categoryErpMappings={categoryErpMappings} draft={drafts.get(row.erpCategory)} onDraftChange={setDraft}
            saved={savedOf(row)} suggestion={suggestionOf(row)} onSaved={(erpCategory, categoryId) => { forgetNotice(erpCategory); remember([[erpCategory, categoryId]]); }}
            selected={checked.has(row.erpCategory)} onSelect={select} locked={bulkPending} notice={rowNotices.get(row.erpCategory)} batchRun={batchRun} />)}
          {!filtered.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>조건에 맞는 ERP 분류가 없습니다.</TableCell></TableRow> : null}
        </TableBody>
      </table>
    </div>
  </div>;
}
