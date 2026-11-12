'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { CATEGORY_PATH, categoryPath, type AdminCategoryNode } from '@/lib/admin/category';
import { CATEGORY_TEMPLATES_PATH, usableTemplateCategory } from '@/lib/admin/category-templates';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CategoryTemplatePicker } from './screens/CategoryTemplatesScreen';
import { useCategoryTemplatesAvailable } from './CategoryTemplatesAvailability';
import { GOOD_INPUT_CLASS, GOOD_NOTE_CLASS } from './GoodEditorParts';

const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
/** 찾기 방식 전환(구분 선택). 누른 값은 aria-pressed로 알린다. */
const METHOD_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

/** 카테고리 찾기 대상. 상품·그룹 편집 로더(loadGoodsCategoryOptions)는 연결된 ERP 분류 이름(`erpNames`)을 함께 싣는다(SHEET-042). */
export type CategorySearchNode = AdminCategoryNode & { erpNames?: readonly string[] };

const searchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR');
/* 검색어는 공백과 경로 구분자 `>`로 나눈다. ERP 분류는 `문구>키링`처럼 붙여 쓰므로 `문구 > 키링` 경로와 같은 낱말이 된다. */
const searchWords = (query: string) => searchText(query).trim().split(/[\s>]+/).filter(Boolean);

/**
 * 카테고리 찾기 검색. 카테고리 경로·코드에 더해 연결된 ERP 분류 이름으로도 찾는다(SHEET-042).
 * 검색어의 낱말이 모두 경로·코드·ERP 분류 이름 어딘가에 있어야 한다.
 */
export function searchAssignableCategories(categories: CategorySearchNode[], query: string) {
  const words = searchWords(query);
  if (!words.length) return [];
  return categories.filter(category => usableTemplateCategory(categories, category.id)).filter(category => {
    const label = searchText(`${categoryPath(categories, category.id).join(' ')} ${category.code} ${(category.erpNames ?? []).join(' ')}`);
    return words.every(word => label.includes(word));
  });
}

/** 카테고리 경로·코드만으로는 찾지 못하고 ERP 분류 이름으로 찾은 결과면 그 이름을 돌려준다(검색 결과에 근거로 보인다). */
export function categoryErpMatch(categories: CategorySearchNode[], category: CategorySearchNode, query: string): string | null {
  const words = searchWords(query);
  if (!words.length || !category.erpNames?.length) return null;
  const own = searchText(`${categoryPath(categories, category.id).join(' ')} ${category.code}`);
  if (words.every(word => own.includes(word))) return null;
  return category.erpNames.find(name => words.some(word => searchText(name).includes(word))) ?? null;
}

/**
 * 상위가 대표 카테고리를 바꾸면(예: ERP 카테고리로 바꾸기) select에 bubbling change 이벤트를 보낸다.
 * 상품 폼의 미리보기·브라우저 복구 기록은 input/change 이벤트로 폼을 다시 읽기 때문이다.
 * 사용자가 select에서 직접 고른 값은 이미 change가 났으므로 다시 보내지 않는다.
 */
export function createPrimaryChangeAnnouncer(initial: string) {
  let announced = initial;
  return {
    /** select에서 직접 고른 값 */
    chosen(value: string) { announced = value; },
    /** 화면에 반영된 값. 알리지 않은 변경이면 change를 보내고 true */
    committed(value: string, target: EventTarget | null | undefined): boolean {
      if (value === announced) return false;
      announced = value;
      target?.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
  };
}

/**
 * 대표·추가 고객 카테고리 선택. 기본은 내부 상태를 갖는 비제어 입력이다.
 * `primary`·`onPrimaryChange`를 함께 주면 대표 카테고리를 상위에서 제어한다
 * (예: 옵션의 ERP 품목 선택이 대표 카테고리를 채울 때). DOM 값만 바꾸면 React 상태와 어긋난다.
 */
export function CategoryAssignmentField({
  categories,
  value = '',
  error,
  additionalValue,
  additionalError,
  primary: controlledPrimary,
  onPrimaryChange,
  emptyGuide = 'link',
}: {
  categories: CategorySearchNode[];
  /** 비제어 모드의 초기 대표 카테고리 */
  value?: string;
  error?: string;
  additionalValue?: string;
  additionalError?: string;
  /** 제어 모드의 현재 대표 카테고리 */
  primary?: string;
  onPrimaryChange?: (id: string) => void;
  /**
   * 카테고리가 하나도 없을 때의 안내. 상품 편집처럼 다른 화면이면 카테고리 관리 링크(새 탭)를,
   * 카테고리 관리 화면 안이면 같은 화면을 다시 열지 않고 위의 등록 카드를 가리킨다.
   */
  emptyGuide?: 'link' | 'here';
}) {
  const [uncontrolledPrimary, setUncontrolledPrimary] = useState(value);
  const [templatePicker, setTemplatePicker] = useState(false), [templateError, setTemplateError] = useState('');
  const [mode, setMode] = useState<'search' | 'select'>('search'), [query, setQuery] = useState('');
  const templatesAvailable = useCategoryTemplatesAvailable();
  const controlled = controlledPrimary !== undefined && onPrimaryChange !== undefined;
  const primary = controlled ? controlledPrimary : uncontrolledPrimary;
  const setPrimary = controlled ? onPrimaryChange : setUncontrolledPrimary;
  const selectRef = useRef<HTMLSelectElement>(null);
  const [announcer] = useState(() => createPrimaryChangeAnnouncer(primary));
  /* 커밋된 뒤 보내야 폼 관찰자가 새 값을 읽는다. */
  useEffect(() => { announcer.committed(primary, selectRef.current); }, [announcer, primary]);
  const [additional, setAdditional] = useState<string[]>(() => {
    try {
      const values: unknown = JSON.parse(additionalValue ?? '[]');
      return Array.isArray(values) ? values.filter((id): id is string => typeof id === 'string' && id !== value) : [];
    } catch { return []; }
  });
  const activeLeaves = categories.filter((category) => usableTemplateCategory(categories, category.id));
  const matches = useMemo(() => searchAssignableCategories(categories, query), [categories, query]);
  /* 로더가 ERP 분류 이름을 실어 준 경우(상품·그룹 편집)에만 ERP 분류명으로도 찾는다고 알린다. */
  const erpSearch = useMemo(() => categories.some(category => category.erpNames?.length), [categories]);
  const selectedArchived = primary
    ? categories.find((category) => category.id === primary && !usableTemplateCategory(categories, category.id) && category.childCount === 0)
    : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  function choose(id: string) { setPrimary(id); setAdditional(current => current.filter(value => value !== id)); setTemplateError(''); }
  return (
    <div className="flex min-w-0 flex-col gap-3" data-good-category="">
      <label className={LABEL_CLASS} htmlFor={mode === 'search' ? 'category-assignment-search' : 'category-assignment'}>대표 카테고리</label>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="카테고리 찾기 방식">
        <span className="inline-flex rounded-lg bg-muted p-0.5">
          <button type="button" className={METHOD_CLASS} aria-pressed={mode === 'search'} onClick={() => setMode('search')}>카테고리명 검색</button>
          <button type="button" className={METHOD_CLASS} aria-pressed={mode === 'select'} onClick={() => setMode('select')}>카테고리명 선택</button>
        </span>
        {templatesAvailable ? <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => setTemplatePicker(true)}>자주 쓰는 카테고리</button> : null}
      </div>
      {/* R9: 카테고리가 하나도 없으면 검색·선택이 빈 채로 막히므로 먼저 등록할 곳을 알린다. 작성 중인 상품을 잃지 않게 새 탭으로 연다. */}
      {!activeLeaves.length ? <p role="status" className={`${GOOD_NOTE_CLASS} text-muted-foreground`}>{emptyGuide === 'here'
        ? '등록된 카테고리가 없습니다. 위 카테고리 일괄 등록이나 새 카테고리에서 먼저 등록하세요.'
        : <>등록된 카테고리가 없습니다. 카테고리 관리에서 먼저 등록하세요. <Link className="text-foreground underline underline-offset-4" href={CATEGORY_PATH} target="_blank" rel="noreferrer">카테고리 관리</Link></>}</p> : null}
      {mode === 'search' ? <div className="flex min-w-0 max-w-2xl flex-col gap-2">
        <input className={GOOD_INPUT_CLASS} data-slot="input" id="category-assignment-search" type="search" aria-label={erpSearch ? '카테고리명·코드 또는 ERP 분류명' : '카테고리명 또는 코드'} aria-describedby="category-assignment-hint" value={query} maxLength={120} placeholder={erpSearch ? '카테고리명·코드 또는 ERP 분류명 입력' : '카테고리명 또는 코드 입력'}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
        {query.trim() ? <><p className="text-xs text-muted-foreground tabular-nums" role="status">검색 결과 {matches.length.toLocaleString('ko-KR')}개{matches.length > 50 ? ' · 앞의 50개를 표시합니다. 검색어를 더 입력해주세요.' : ''}</p>
          {matches.length ? <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto rounded-lg border p-0" aria-label="카테고리 검색 결과">{matches.slice(0, 50).map(category => ({ category, erp: categoryErpMatch(categories, category, query) })).map(({ category, erp }) => <li className="border-b last:border-b-0" key={category.id}><button type="button" className="flex min-h-11 w-full flex-col items-start justify-center gap-0.5 px-3 py-2 text-left text-sm wrap-anywhere text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground" aria-pressed={primary === category.id} onClick={() => choose(category.id)}>
            <span>{categoryPath(categories, category.id).join(' > ')}</span><small className="text-xs font-normal text-muted-foreground">{category.code}{erp ? ` · ERP 분류 ${erp}` : ''}</small>
          </button></li>)}</ul> : <p className="text-sm text-muted-foreground">일치하는 사용 가능한 마지막 단계 카테고리가 없습니다.</p>}</> : <p className="text-sm text-muted-foreground">{erpSearch ? '카테고리명·코드나 연결된 ERP 분류명을' : '카테고리명이나 코드를'} 입력하거나 카테고리명 선택을 이용해주세요.</p>}
        {primary ? <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"><span className="min-w-0 wrap-anywhere">{selectedArchived ? '보관됨 · ' : ''}{categoryPath(categories, primary).join(' > ') || primary}</span><button type="button" className={`${buttonVariants({ variant: 'outline', size: 'sm' })} shrink-0`} data-slot="button" onClick={() => choose('')}>선택 해제</button></div> : null}
      </div> : null}
      {/* 검색 방식에서도 대표 카테고리 값(name="categoryId")은 이 select가 제출한다. 숨길 때는 select와 감싼 칸을 함께 숨긴다. */}
      <NativeSelect className={mode !== 'select' ? 'hidden' : 'w-full max-w-2xl'} hidden={mode !== 'select'} aria-describedby="category-assignment-hint" aria-invalid={error ? 'true' : undefined} value={primary} id="category-assignment" name="categoryId" ref={selectRef} onChange={(event) => {
        announcer.chosen(event.target.value);
        choose(event.target.value);
      }}>
        <option value="">미분류</option>
        {leaves.map((category) => <option aria-disabled={category.archivedAt ? 'true' : undefined} key={category.id} value={category.id}>{category.archivedAt ? '보관됨 · ' : ''}{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
      </NativeSelect>
      {templatesAvailable ? <Link className="w-fit text-sm underline underline-offset-4" href={CATEGORY_TEMPLATES_PATH} target="_blank" rel="noreferrer">자주 쓰는 카테고리 관리 ↗</Link> : null}
      {templateError ? <p className="text-sm text-destructive" role="alert">{templateError}</p> : null}
      {templatePicker ? <CategoryTemplatePicker onClose={() => setTemplatePicker(false)} onSelect={template => {
        if (!template.usable || !usableTemplateCategory(categories, template.categoryId)) { setTemplateError('현재 사용할 수 없는 카테고리입니다. 최신 카테고리를 확인해주세요.'); setTemplatePicker(false); return; }
        choose(template.categoryId); setTemplatePicker(false);
      }} /> : null}
      <span className="text-xs text-muted-foreground" id="category-assignment-hint">
        마지막 단계 카테고리 하나를 대표로 고릅니다. ERP 분류는 대표 카테고리를 사용합니다. 보관된 현재 값은 명시적으로 미분류를 선택해야 해제됩니다. 비워도 기존 유형과 전체 상품 판매는 유지됩니다.
      </span>
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
      {additionalValue !== undefined && <details className="group/additional min-w-0 rounded-lg border" data-good-category-additional="" open={Boolean(additionalError) || additional.length > 0}><summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none group-open/additional:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/additional:rotate-90 motion-reduce:transition-none" />추가 카테고리 (선택)</summary><div className="flex min-w-0 flex-col gap-3 border-t px-3 py-4">
        {/* 상위에서 대표를 바꿔도 같은 분류가 추가 분류에 중복 저장되지 않는다. */}
        <input name="additionalCategoryIds" type="hidden" value={JSON.stringify(additional.filter(id => id !== primary))} />
        <label className={LABEL_CLASS} htmlFor="additional-category-assignment">추가 카테고리 (선택)</label>
        <NativeSelect className="w-full max-w-2xl" id="additional-category-assignment" aria-describedby="additional-category-hint" aria-invalid={additionalError ? 'true' : undefined} value="" onChange={(event) => {
          const id = event.target.value;
          if (id) setAdditional(current => [...new Set([...current, id])]);
        }}>
          <option value="">추가할 카테고리 선택</option>
          {activeLeaves.filter(category => category.id !== primary && !additional.includes(category.id)).map(category =>
            <option key={category.id} value={category.id}>{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
        </NativeSelect>
        {additional.filter(id => id !== primary).map(id => {
          const category = categories.find(category => category.id === id);
          return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" key={id}>
            <span className="min-w-0 wrap-anywhere">{category?.archivedAt ? '보관됨 · ' : ''}{category ? categoryPath(categories, id).join(' > ') : id}</span>
            <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" aria-label={`${category?.name ?? id} 추가 분류 해제`} onClick={() => setAdditional(current => current.filter(value => value !== id))}>해제</button>
          </div>;
        })}
        <span className="text-xs text-muted-foreground" id="additional-category-hint">관리자 목록에서 대표·추가 분류와 하위 분류로 찾을 수 있습니다. 기본 상품 저장으로 반영합니다.</span>
        {additionalError && <span className="text-sm text-destructive" role="alert">{additionalError}</span>}
      </div></details>}
    </div>
  );
}
