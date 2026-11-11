'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setErpCategoryMappingAction } from '@/app/admin/erp-item-actions';
import type { AdminCategoryErpMapping, AdminCategoryNode } from '@/lib/admin/category';
import {
  conflictingCategoryErpMapping,
  createErpCategoryIndex,
  type ErpCategoryIndex,
  type ErpCategoryMappingRow,
  type ErpCategorySuggestion,
} from '@/lib/admin/erp-items';
import { AdminStatusBadge } from './console/AdminKit';
import { AdminSearchSelect, type AdminSearchSelectOption } from './console/AdminSearchSelect';
import { Button } from './kit/ui/button';
import { Input } from './kit/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './kit/ui/table';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';

const VISIBLE_LIMIT = 200;
const LEAVE_MESSAGE = '저장하지 않은 ERP 분류 연결이 있습니다. 이 화면을 떠나면 고른 연결이 사라집니다. 이동할까요?';

const NO_LINK: AdminSearchSelectOption = { value: '', label: '연결 안 함' };
const NO_LINK_ONLY = [NO_LINK];

function suggestionText(basis: ErpCategorySuggestion['basis']) {
  return basis === 'erp_mapping' ? '고객 카테고리의 ERP 분류 매핑대로 연결' : '같은 경로로 연결';
}

function MappingRow({ row, options, index, categoryErpMappings, draft, onDraftChange }: {
  row: ErpCategoryMappingRow;
  options: readonly AdminSearchSelectOption[];
  index: ErpCategoryIndex;
  categoryErpMappings: Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[];
  /** 고르고 아직 저장하지 않은 값. */
  draft: string | undefined;
  onDraftChange: (erpCategory: string, value: string | undefined) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(row.categoryId ?? '');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = draft ?? saved;
  /* 새 연결이 없으면 DB가 자동으로 잇는 말단: 고객 카테고리의 정본 ERP 분류 매핑(이름·코드 정확히 일치, 하나뿐) → `대>중>소` 전체 경로 일치. */
  const fallback = !saved && row.fallbackCategoryId ? row.fallbackCategoryId : null;
  const fallbackBasis = fallback ? index.fallbackBasis(row.erpCategory, fallback) : null;
  const suggestion = saved || fallback ? null : index.suggest(row.erpCategory);
  const conflict = selected ? conflictingCategoryErpMapping(row.erpCategory, selected, categoryErpMappings) : null;
  const pathOf = (id: string) => index.pathLabel(id) ?? '삭제된 카테고리';
  /* 현재 연결이 보관됐거나 하위가 생긴 분류여도 칸이 엉뚱한 값을 보여 주지 않게 따로 표시한다. */
  const pinned = saved && !index.isLeaf(saved)
    ? [NO_LINK, { value: saved, label: `${pathOf(saved)} · 지금은 연결할 수 없음` }]
    : NO_LINK_ONLY;

  /* 지난 저장 결과는 그때의 값에 대한 것이다. 값을 바꿨는데 초록 문구가 남으면 지금 값이 저장된 줄로 읽힌다. */
  const choose = (value: string) => {
    if (value !== selected) setStatus(null);
    onDraftChange(row.erpCategory, value === saved ? undefined : value);
  };

  const save = (categoryId: string) => {
    setStatus(null);
    startTransition(async () => {
      const result = await setErpCategoryMappingAction({ erpCategory: row.erpCategory, categoryId: categoryId || null });
      if (!result.ok) { setStatus({ tone: 'error', text: result.error }); return; }
      setSaved(result.categoryId ?? '');
      onDraftChange(row.erpCategory, undefined);
      setStatus({ tone: 'ok', text: result.message });
      if (result.changed) router.refresh();
    });
  };

  return <TableRow>
    {/* 첫 줄 글자를 선택 칸 글자와 같은 높이에 맞춘다(칸 위 여백 8 + 선택 칸 안 여백 6). */}
    <TableHead scope="row" className="h-auto pt-3.5 pb-2 align-top text-sm font-normal wrap-anywhere whitespace-normal text-foreground">{row.erpCategory}</TableHead>
    <TableCell className="pt-3.5 text-right align-top tabular-nums">{row.itemCount.toLocaleString('ko-KR')}</TableCell>
    <TableCell className="align-top whitespace-normal">
      <div className="flex min-w-0 flex-col gap-1">
        <AdminSearchSelect aria-label={`${row.erpCategory} 고객 카테고리`} disabled={pending} emptyMessage="일치하는 카테고리가 없습니다." onValueChange={choose} options={options} pinnedOptions={pinned} searchPlaceholder="카테고리 이름으로 찾기" value={selected} />
        {/* 저장하면 생기거나 사라지는 표시는 이 한 줄에 모으고 높이를 늘 잡아 둔다. 저장해도 아래 행이 움직이지 않는다. */}
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
          {/* 연결 칸에서 처리할 분류만 표시한다. 자동으로 이어지는 분류는 표시하지 않는다. */}
          {!saved && !fallback ? <AdminStatusBadge tone="warning">연결 필요</AdminStatusBadge> : null}
          {suggestion ? <Button className="h-auto min-h-5 px-1.5 py-0 text-left text-xs whitespace-normal" size="sm" variant="ghost" type="button" disabled={pending}
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
          <span aria-live="polite" className={`text-xs ${status?.tone === 'error' ? 'text-destructive' : 'text-success'}`}>{status?.text ?? ''}</span>
        </div>
      </div>
    </TableCell>
    {/* 선택 칸(32px)과 가운데가 맞게 버튼(28px)을 2px 내린다. */}
    <TableCell className="pt-2.5 align-top">
      {/* 저장된 연결도 고른 카테고리도 없으면 할 일이 없으므로 버튼을 두지 않는다(제안 연결 저장 중에는 '저장 중'을 보인다). 연결 해제는 저장된 연결을 비웠을 때만 보인다. */}
      {saved || selected || pending ? <Button size="sm" variant="outline" type="button" disabled={pending || selected === saved} onClick={() => save(selected)}>
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
  const [query, setQuery] = useState('');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  /* 표 안쪽을 내린 채 찾으면 결과 앞줄이 스크롤 위로 가려진다. 조건이 바뀌면 처음부터 보이게 한다. */
  const tableScroller = useRef<HTMLDivElement>(null);
  /* 저장하지 않고 고른 값(ERP 분류 → 카테고리). 표에 하나만 두어 행이 검색으로 잠시 빠져도 남고, 떠날 때 행 수와 상관없이 한 번만 묻는다. */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  /* 위쪽 품목 표의 페이지 넘김·검색은 쿼리만 바꿔 이 표의 입력이 그대로 남는다. */
  useAdminLeaveGuard({ dirty: drafts.size > 0, message: LEAVE_MESSAGE, survivesQueryChange: true });
  const setDraft = (erpCategory: string, value: string | undefined) => setDrafts((current) => {
    const next = new Map(current);
    if (value === undefined) next.delete(erpCategory);
    else next.set(erpCategory, value);
    return next;
  });
  /* 색인·선택지는 표 전체가 한 벌을 나눠 쓴다. 행마다 만들면 행×카테고리만큼 계산이 늘어난다. */
  const index = useMemo(() => createErpCategoryIndex(categories, categoryErpMappings), [categories, categoryErpMappings]);
  /* ERP 분류 원문은 `문구>키링`처럼 붙여 쓰므로 붙여 쓴 경로로도 찾게 한다. */
  const options = useMemo<AdminSearchSelectOption[]>(() => index.leaves.map((leaf) => ({ value: leaf.id, label: leaf.label, keywords: leaf.label.replaceAll(' > ', '>') })), [index]);
  const needle = query.trim().toLowerCase();
  const isLinked = (row: ErpCategoryMappingRow) => Boolean(row.categoryId || row.fallbackCategoryId);
  const filtered = rows.filter((row) => (!needle || row.erpCategory.toLowerCase().includes(needle)) && (!unlinkedOnly || !isLinked(row)));
  const linked = rows.filter(isLinked).length;

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
    </div>
    <div ref={tableScroller} className="relative max-h-[520px] min-w-0 overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 print:max-h-none print:overflow-visible [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-muted" role="region" aria-label="ERP 분류 연결" tabIndex={0}>
      {/* 열 폭을 고정한다. 내용 폭으로 정하면 저장 결과 문구가 나타날 때 고객 카테고리 열이 좁아진다. */}
      <table className="w-full min-w-[720px] table-fixed caption-top text-sm" data-slot="table">
        <caption className="px-2 py-2 text-left text-sm text-muted-foreground">ERP 분류별 고객 카테고리{filtered.length > VISIBLE_LIMIT ? ` · 앞 ${VISIBLE_LIMIT}개만 표시, 검색으로 좁혀주세요` : ''}</caption>
        <colgroup><col className="w-[28%]" /><col className="w-20" /><col /><col className="w-28" /></colgroup>
        <TableHeader><TableRow className="bg-muted/50"><TableHead scope="col">ERP 분류</TableHead><TableHead scope="col" className="text-right">품목 수</TableHead><TableHead scope="col">고객 카테고리</TableHead><TableHead scope="col">저장</TableHead></TableRow></TableHeader>
        <TableBody>
          {filtered.slice(0, VISIBLE_LIMIT).map((row) => <MappingRow key={row.erpCategory} row={row} options={options} index={index} categoryErpMappings={categoryErpMappings} draft={drafts.get(row.erpCategory)} onDraftChange={setDraft} />)}
          {!filtered.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={4}>조건에 맞는 ERP 분류가 없습니다.</TableCell></TableRow> : null}
        </TableBody>
      </table>
    </div>
  </div>;
}
