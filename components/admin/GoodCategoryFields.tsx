'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CATEGORY_PATH, categoryPath, type AdminCategoryNode } from '@/lib/admin/category';
import { usableTemplateCategory } from '@/lib/admin/category-templates';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { createPrimaryChangeAnnouncer, searchAssignableCategories } from './CategoryAssignmentField';
import { CategoryTemplatePicker } from './screens/CategoryTemplatesScreen';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS } from './GoodEditorParts';

const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
const RESULT_LIMIT = 50;

/**
 * 상품 등록의 대표 카테고리. 검색 결과와 전체 목록을 한 칸으로 합쳤다(검색칸을 누르면 전체, 입력하면 결과).
 * 제출 값은 숨긴 select(name="categoryId") 하나이고, 대표 카테고리는 상위가 제어한다(ERP 품목 선택이 채울 수 있게).
 */
export function GoodCategoryField({ categories, primary, onPrimaryChange, error }: {
  categories: AdminCategoryNode[]; primary: string; onPrimaryChange: (id: string) => void; error?: string;
}) {
  const [templatePicker, setTemplatePicker] = useState(false), [templateError, setTemplateError] = useState('');
  const [query, setQuery] = useState(''), [browsing, setBrowsing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [announcer] = useState(() => createPrimaryChangeAnnouncer(primary));
  /* 커밋된 뒤 보내야 폼 관찰자(미리보기·브라우저 복구)가 새 값을 읽는다. */
  useEffect(() => { announcer.committed(primary, selectRef.current); }, [announcer, primary]);
  const activeLeaves = useMemo(() => categories.filter((category) => usableTemplateCategory(categories, category.id)), [categories]);
  const searching = Boolean(query.trim());
  const results = useMemo(() => searching ? searchAssignableCategories(categories, query) : activeLeaves, [activeLeaves, categories, query, searching]);
  const selectedArchived = primary ? categories.find((category) => category.id === primary && !usableTemplateCategory(categories, category.id) && category.childCount === 0) : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  function choose(id: string) { onPrimaryChange(id); setTemplateError(''); setQuery(''); setBrowsing(false); }
  const listOpen = browsing || searching;
  return <div className="flex min-w-0 flex-col gap-2" data-good-category="">
    <label className={LABEL_CLASS} htmlFor="good-category-search">대표 카테고리</label>
    <div className="flex min-w-0 max-w-2xl flex-col gap-2" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBrowsing(false); }}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input className={`${GOOD_INPUT_CLASS} min-w-0 flex-1 basis-56`} data-slot="input" id="good-category-search" type="search" aria-describedby="good-category-hint" autoComplete="off" value={query} maxLength={120} placeholder="카테고리명 또는 코드로 찾기"
          onChange={(event) => setQuery(event.target.value)} onClick={() => setBrowsing(true)} onFocus={() => setBrowsing(true)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); if (event.key === 'Escape') { setQuery(''); setBrowsing(false); } }} />
        <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => setTemplatePicker(true)}>카테고리 템플릿</button>
      </div>
      {listOpen ? <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs text-muted-foreground tabular-nums" role="status">{searching ? '검색 결과' : '전체'} {results.length.toLocaleString('ko-KR')}개{results.length > RESULT_LIMIT ? ` · 앞의 ${RESULT_LIMIT}개를 표시합니다. 검색어를 더 입력해주세요.` : ''}</p>
        {results.length ? <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto rounded-lg border p-0" aria-label="카테고리 목록" onMouseDown={(event) => event.preventDefault()}>{results.slice(0, RESULT_LIMIT).map((category) => <li className="border-b last:border-b-0" key={category.id}><button type="button" className="flex min-h-11 w-full flex-col items-start justify-center gap-0.5 px-3 py-2 text-left text-sm wrap-anywhere text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground" aria-pressed={primary === category.id} onClick={() => choose(category.id)}>
          <span>{categoryPath(categories, category.id).join(' > ')}</span><small className="text-xs font-normal text-muted-foreground">{category.code}</small>
        </button></li>)}</ul> : <p className="text-sm text-muted-foreground">일치하는 카테고리가 없습니다.</p>}
      </div> : null}
      {primary ? <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><span className="min-w-0 wrap-anywhere">{selectedArchived ? '보관됨 · ' : ''}{categoryPath(categories, primary).join(' > ') || primary}</span><button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} shrink-0`} data-slot="button" onClick={() => choose('')}>선택 해제</button></div> : null}
    </div>
    {/* R9: 카테고리가 하나도 없으면 검색이 빈 채로 막히므로 먼저 등록할 곳을 알린다. 작성 중인 상품을 잃지 않게 새 탭으로 연다. */}
    {!activeLeaves.length ? <p role="status" className={`${GOOD_NOTE_CLASS} text-muted-foreground`}>등록된 카테고리가 없습니다. 카테고리 관리에서 먼저 등록하세요. <Link className="text-foreground underline underline-offset-4" href={CATEGORY_PATH} target="_blank" rel="noreferrer">카테고리 관리</Link></p> : null}
    {/* 대표 카테고리 값(name="categoryId")은 이 select가 제출한다. 숨길 때는 select와 감싼 칸을 함께 숨긴다. */}
    <NativeSelect className="hidden" hidden aria-hidden="true" tabIndex={-1} aria-invalid={error ? 'true' : undefined} value={primary} id="good-category-primary" name="categoryId" ref={selectRef} onChange={(event) => { announcer.chosen(event.target.value); choose(event.target.value); }}>
      <option value="">미분류</option>
      {leaves.map((category) => <option key={category.id} value={category.id}>{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
    </NativeSelect>
    {templateError ? <p className="text-sm text-destructive" role="alert">{templateError}</p> : null}
    {templatePicker ? <CategoryTemplatePicker onClose={() => setTemplatePicker(false)} onSelect={(template) => {
      if (!template.usable || !usableTemplateCategory(categories, template.categoryId)) { setTemplateError('현재 사용할 수 없는 카테고리입니다. 최신 카테고리를 확인해주세요.'); setTemplatePicker(false); return; }
      choose(template.categoryId); setTemplatePicker(false);
    }} /> : null}
    <span className="text-xs text-muted-foreground" id="good-category-hint">비워도 판매할 수 있습니다.{selectedArchived ? ' 보관된 카테고리는 선택 해제해야 바뀝니다.' : ''}</span>
    {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
  </div>;
}

/** 추가 카테고리(선택). 대표와 같은 분류는 제출하지 않는다. */
export function GoodAdditionalCategoryField({ categories, primary, value, error }: {
  categories: AdminCategoryNode[]; primary: string; value: string; error?: string;
}) {
  const [additional, setAdditional] = useState<string[]>(() => {
    try {
      const values: unknown = JSON.parse(value || '[]');
      return Array.isArray(values) ? values.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  });
  /* 대표로 옮긴 분류는 추가 목록에서 영구히 뺀다(대표를 다시 바꿔도 되살아나지 않는다 — 저장 결과 계약). */
  const [lastPrimary, setLastPrimary] = useState(primary);
  if (primary !== lastPrimary) {
    setLastPrimary(primary);
    if (additional.includes(primary)) setAdditional(additional.filter((id) => id !== primary));
  }
  const activeLeaves = categories.filter((category) => usableTemplateCategory(categories, category.id));
  const visible = additional.filter((id) => id !== primary);
  return <div className="flex min-w-0 flex-col gap-2" data-good-category-additional="">
    <input name="additionalCategoryIds" type="hidden" value={JSON.stringify(visible)} />
    <label className={LABEL_CLASS} htmlFor="good-additional-category">추가 카테고리 (선택)</label>
    <NativeSelect className="w-full max-w-2xl" id="good-additional-category" aria-describedby="good-additional-category-hint" aria-invalid={error ? 'true' : undefined} value="" onChange={(event) => {
      const id = event.target.value;
      if (id) setAdditional((current) => [...new Set([...current, id])]);
    }}>
      <option value="">추가할 카테고리 선택</option>
      {activeLeaves.filter((category) => category.id !== primary && !additional.includes(category.id)).map((category) => <option key={category.id} value={category.id}>{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
    </NativeSelect>
    {visible.map((id) => {
      const category = categories.find((item) => item.id === id);
      return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" key={id}>
        <span className="min-w-0 wrap-anywhere">{category?.archivedAt ? '보관됨 · ' : ''}{category ? categoryPath(categories, id).join(' > ') : id}</span>
        <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" aria-label={`${category?.name ?? id} 추가 카테고리 해제`} onClick={() => setAdditional((current) => current.filter((item) => item !== id))}>해제</button>
      </div>;
    })}
    <span className="text-xs text-muted-foreground" id="good-additional-category-hint">상품 목록에서 대표·추가 카테고리로 찾을 수 있습니다.</span>
    {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
  </div>;
}
