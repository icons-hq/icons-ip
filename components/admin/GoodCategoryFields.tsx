'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { CATEGORY_PATH, categoryGoodType, categoryPath, type AdminCategoryNode } from '@/lib/admin/category';
import { usableTemplateCategory } from '@/lib/admin/category-templates';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { createPrimaryChangeAnnouncer, searchAssignableCategories } from './CategoryAssignmentField';
import { CategoryTemplatePicker } from './screens/CategoryTemplatesScreen';
import { useCategoryTemplatesAvailable } from './CategoryTemplatesAvailability';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS } from './GoodEditorParts';

const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
const RESULT_LIMIT = 50;
const LISTBOX_ID = 'good-category-listbox';
const optionId = (index: number) => `good-category-option-${index}`;

/** ↑↓로 옮긴 뒤의 강조 위치. 끝에서 멈춘다(ERP 분류 연결 표의 검색형 선택과 같다). */
export function moveCategoryActive(key: 'ArrowDown' | 'ArrowUp', active: number, count: number): number {
  return key === 'ArrowDown' ? Math.min(active + 1, count - 1) : Math.max(active - 1, 0);
}

/** 강조한 항목이 보이게 목록만 스크롤한다(scrollIntoView는 페이지까지 움직인다). */
export function keepOptionInView(list: Pick<HTMLElement, 'scrollTop' | 'clientHeight'>, option: Pick<HTMLElement, 'offsetTop' | 'offsetHeight'>) {
  if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
  else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
}

/**
 * 상품 등록의 대표 카테고리. 입력칸에 바로 타이핑하면 찾고, 칸을 누르면 전체 목록이 입력칸 아래에 겹쳐 뜬다(폼을 밀지 않는다).
 * 키보드는 combobox 패턴이다: ↑↓ 강조, Enter 선택, Esc 닫기. 포커스는 입력칸에 남는다.
 * 포커스만으로는 열지 않는다 — 임시 저장 복구·오류 안내가 이 칸으로 포커스를 옮겨도 목록이 저절로 펼쳐지면 안 된다.
 * 제출 값은 숨긴 select(name="categoryId") 하나이고, 대표 카테고리는 상위가 제어한다(ERP 품목 선택이 채울 수 있게).
 */
export function GoodCategoryField({ categories, primary, onPrimaryChange, error }: {
  categories: AdminCategoryNode[]; primary: string; onPrimaryChange: (id: string) => void; error?: string;
}) {
  const [templatePicker, setTemplatePicker] = useState(false), [templateError, setTemplateError] = useState('');
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const templatesAvailable = useCategoryTemplatesAvailable();
  const selectRef = useRef<HTMLSelectElement>(null), inputRef = useRef<HTMLInputElement>(null), listRef = useRef<HTMLUListElement>(null);
  const [announcer] = useState(() => createPrimaryChangeAnnouncer(primary));
  /* 커밋된 뒤 보내야 폼 관찰자(미리보기·브라우저 복구)가 새 값을 읽는다. */
  useEffect(() => { announcer.committed(primary, selectRef.current); }, [announcer, primary]);
  const activeLeaves = useMemo(() => categories.filter((category) => usableTemplateCategory(categories, category.id)), [categories]);
  const searching = Boolean(query.trim());
  const results = useMemo(() => searching ? searchAssignableCategories(categories, query) : activeLeaves, [activeLeaves, categories, query, searching]);
  const selectedArchived = primary ? categories.find((category) => category.id === primary && !usableTemplateCategory(categories, category.id) && category.childCount === 0) : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  const visible = useMemo(() => results.slice(0, RESULT_LIMIT), [results]);
  function choose(id: string) { onPrimaryChange(id); setTemplateError(''); setQuery(''); setOpen(false); }
  /* 지금 대표 카테고리가 목록에 있으면 그 줄을 강조해서 연다. */
  function openList() { setOpen(true); setActive(Math.max(0, visible.findIndex((category) => category.id === primary))); }
  useLayoutEffect(() => {
    const list = listRef.current, option = list?.children[active] as HTMLElement | undefined;
    if (open && list && option) keepOptionInView(list, option);
  }, [active, open, query]);
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    /* 폼 안 입력칸이라 Enter가 저장으로 이어지지 않게 늘 막는다. 한글 조합 중의 키는 조합을 끝내는 키다. */
    if (event.key === 'Enter') event.preventDefault();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) setActive(moveCategoryActive(event.key, active, visible.length)); else openList();
    } else if (event.key === 'Enter') {
      if (open && visible[active]) choose(visible[active].id);
    } else if (event.key === 'Escape') {
      setQuery(''); setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }
  return <div className="flex min-w-0 flex-col gap-2" data-good-category="">
    <label className={LABEL_CLASS} htmlFor="good-category-search">대표 카테고리</label>
    <div className="flex min-w-0 max-w-2xl flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {/* 옆의 버튼은 이 묶음 밖이다. 버튼으로 넘어가면 목록을 닫는다. */}
        <div className="relative min-w-0 flex-1 basis-56" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
          <input aria-activedescendant={open && visible.length ? optionId(active) : undefined} aria-autocomplete="list" aria-controls={open && visible.length ? LISTBOX_ID : undefined} aria-describedby="good-category-hint" aria-expanded={open} className={GOOD_INPUT_CLASS} data-slot="input" id="good-category-search" role="combobox" type="text" autoComplete="off" value={query} maxLength={120} placeholder="카테고리명 또는 코드로 찾기" ref={inputRef}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }} onClick={() => { if (!open) openList(); }}
            onKeyDown={onSearchKeyDown} />
          {open ? <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10" data-good-category-list="" onMouseDown={(event) => event.preventDefault()}>
            <p className="border-b px-3 py-1.5 text-xs text-muted-foreground tabular-nums" role="status">{searching ? '검색 결과' : '전체'} {results.length.toLocaleString('ko-KR')}개{results.length > RESULT_LIMIT ? ` · 앞의 ${RESULT_LIMIT}개를 표시합니다. 검색어를 더 입력해주세요.` : ''}</p>
            {visible.length ? <ul aria-label="카테고리 목록" className="relative m-0 flex max-h-72 list-none flex-col overflow-y-auto overscroll-contain p-0 [scrollbar-width:thin]" id={LISTBOX_ID} ref={listRef} role="listbox">{visible.map((category, index) => <li aria-checked={primary === category.id} aria-selected={index === active} className="flex min-h-11 shrink-0 cursor-pointer flex-col items-start justify-center gap-0.5 border-b px-3 py-2 text-left text-sm wrap-anywhere text-foreground last:border-b-0 aria-checked:font-medium aria-checked:text-primary-soft-foreground aria-selected:bg-muted" id={optionId(index)} key={category.id} onClick={() => choose(category.id)} onMouseMove={() => { if (index !== active) setActive(index); }} role="option">
              <span>{categoryPath(categories, category.id).join(' > ')}</span><small className="text-xs font-normal text-muted-foreground">{category.code} · 상품 유형 {categoryGoodType(categories, category.id) || '연결 없음'}</small>
            </li>)}</ul> : <p className="px-3 py-2 text-sm text-muted-foreground">일치하는 카테고리가 없습니다.</p>}
          </div> : null}
        </div>
        {/* 등록해 둔 바로가기가 있을 때만 보인다. 없으면 눌러도 빈 창이라 검색만 둔다. */}
        {templatesAvailable ? <button type="button" className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => setTemplatePicker(true)}>자주 쓰는 카테고리</button> : null}
      </div>
      {primary ? <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><span className="min-w-0 wrap-anywhere">{selectedArchived ? '보관됨 · ' : ''}{categoryPath(categories, primary).join(' > ') || primary}</span><button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} shrink-0`} data-slot="button" onClick={() => { choose(''); inputRef.current?.focus(); }}>선택 해제</button></div> : null}
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
    {/* SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)에 연결한 값이라 공개하려면 연결된 카테고리가 필요하다. */}
    <span className="text-xs text-muted-foreground" id="good-category-hint">상품 유형은 이 카테고리(없으면 가까운 상위)에 연결한 값으로 정해지고, 상품 유형이 연결된 카테고리여야 공개할 수 있습니다.{selectedArchived ? ' 보관된 카테고리는 선택 해제해야 바뀝니다.' : ''}</span>
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
