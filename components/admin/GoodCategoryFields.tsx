'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AdminLabelWithHelp } from '@/components/admin/console/AdminHelpTip';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { CATEGORY_PATH, categoryPath, categoryTreeOrder } from '@/lib/admin/category';
import { usableTemplateCategory } from '@/lib/admin/category-templates';
import { GOOD_EDITOR_HELP } from '@/lib/admin/help/good-editor';
import { adminPickerLocalPage, type AdminPickerLoader } from '@/lib/admin/picker';
import { categoryErpMatch, createPrimaryChangeAnnouncer, searchAssignableCategories, type CategorySearchNode } from './CategoryAssignmentField';
import { CategoryTemplatePicker } from './screens/CategoryTemplatesScreen';
import { useCategoryTemplatesAvailable } from './CategoryTemplatesAvailability';
import { GOOD_NOTE_CLASS } from './GoodEditorParts';

const LABEL_CLASS = 'text-sm leading-snug font-medium text-foreground';
/* 고른 카테고리를 보이는 읽기 전용 상자. 누르거나 Enter로 선택창을 연다. 입력칸 모양이라 오류 포커스(focusGoodWorkspaceTarget)가 여기로 온다. */
const PICK_BOX_CLASS = 'h-8 min-w-0 flex-1 basis-56 cursor-pointer truncate rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';
const NOT_HIDDEN: ReadonlySet<string> = new Set();
const UNKNOWN_CATEGORY = '알 수 없는 카테고리';

/** 선택창 한 줄: 카테고리와 그 경로, ERP 분류명으로 찾았을 때의 근거. */
export interface CategoryPickerRow { category: CategorySearchNode; path: string; erp: string | null }

/**
 * 대표·추가 카테고리 선택창의 조회(docs/admin-screen-rules.md 규칙 1·2). 카테고리는 화면이 이미 다 가지고 있어 목록을 20개씩 자르기만 한다.
 * 고를 수 있는 마지막 단계 카테고리만 낸다 — 보관됐거나 하위가 있는 카테고리는 목록에 넣지 않는다.
 * 검색 범위는 CategoryAssignmentField와 같다: 경로·코드·연결된 ERP 분류명(`searchAssignableCategories`). `hidden`은 더 뺄 카테고리(추가 카테고리 창의 대표 카테고리).
 */
export function categoryPickerLoader(categories: CategorySearchNode[], hidden: ReadonlySet<string> = NOT_HIDDEN): AdminPickerLoader<CategoryPickerRow> {
  const leaves = categories.filter((category) => usableTemplateCategory(categories, category.id));
  const order = categoryTreeOrder(categories);
  const byTree = (left: CategorySearchNode, right: CategorySearchNode) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
  return async (request) => {
    const query = request.query.trim();
    const rows = [...(query ? searchAssignableCategories(categories, query) : leaves)].sort(byTree)
      .filter((category) => !hidden.has(category.id))
      .map((category) => ({ category, path: categoryPath(categories, category.id).join(' > '), erp: query ? categoryErpMatch(categories, category, query) : null }));
    return adminPickerLocalPage(rows, { ...request, query: '' }, { textOf: () => '' });
  };
}

/* 선택창은 받은 배열 순서가 아니라 카테고리 관리 화면과 같은 순서(lib/admin/category의 categoryTreeOrder)로 보인다 —
   '굿즈 > 인형', '굿즈 > 키링', '굿즈 > 문구 > 스티커'처럼 같은 상위끼리 모여야 찾기 쉽다. */

const categoryRowKey = (row: CategoryPickerRow) => row.category.id;
/* 카테고리 코드는 엑셀의 '카테고리 코드' 열에 넣는 값이다. 무엇인지 알 수 있게 이름표를 붙인다(규칙 8). */
const categoryRowView = (row: CategoryPickerRow): AdminPickerRowView => ({ title: row.path, meta: `카테고리 코드 ${row.category.code}${row.erp ? ` · ERP 분류 ${row.erp}` : ''}` });
/** 로더가 ERP 분류 이름을 실어 준 경우에만 ERP 분류명으로도 찾는다고 알린다. */
const categorySearchPlaceholder = (categories: readonly CategorySearchNode[]) => categories.some((category) => category.erpNames?.length) ? '카테고리명·코드·ERP 분류명으로 찾기' : '카테고리명 또는 코드로 찾기';

/**
 * 상품 등록의 대표 카테고리. 고른 카테고리의 경로를 읽기 전용 상자에 보이고, [카테고리 선택]·[바꾸기]가 공용 선택창(검색 + 20개씩 목록)을 연다.
 * 선택창에는 고를 수 있는 마지막 단계 카테고리만 나온다. 상자를 누르거나 Enter·↓를 눌러도 같은 창이 열린다 — 입력칸이 아니라 폼 저장으로 번지지 않게 Enter는 늘 막는다.
 * 제출 값은 숨긴 select(name="categoryId") 하나이고, 대표 카테고리는 상위가 제어한다(ERP 품목 선택이 채울 수 있게).
 * 로더가 연결된 ERP 분류 이름(`erpNames`)을 실어 주면 ERP 분류명으로도 찾고, 그렇게 찾은 줄에 'ERP 분류 X' 근거를 붙인다(CategoryAssignmentField와 같다).
 */
export function GoodCategoryField({ categories, primary, onPrimaryChange, error }: {
  categories: CategorySearchNode[]; primary: string; onPrimaryChange: (id: string) => void; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false), [templateError, setTemplateError] = useState('');
  const templatesAvailable = useCategoryTemplatesAvailable();
  const selectRef = useRef<HTMLSelectElement>(null), pickRef = useRef<HTMLButtonElement>(null);
  const [announcer] = useState(() => createPrimaryChangeAnnouncer(primary));
  /* 커밋된 뒤 보내야 폼 관찰자(미리보기·브라우저 복구)가 새 값을 읽는다. */
  useEffect(() => { announcer.committed(primary, selectRef.current); }, [announcer, primary]);
  const activeLeaves = useMemo(() => categories.filter((category) => usableTemplateCategory(categories, category.id)), [categories]);
  const searchPlaceholder = useMemo(() => categorySearchPlaceholder(categories), [categories]);
  const load = useMemo(() => categoryPickerLoader(categories), [categories]);
  const selectedArchived = primary ? categories.find((category) => category.id === primary && !usableTemplateCategory(categories, category.id) && category.childCount === 0) : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  const canPick = activeLeaves.length > 0;
  const pathText = primary ? `${selectedArchived ? '보관됨 · ' : ''}${categoryPath(categories, primary).join(' > ') || UNKNOWN_CATEGORY}` : '';
  const describedBy = [selectedArchived ? 'good-category-archived' : '', error ? 'good-category-error' : ''].filter(Boolean).join(' ') || undefined;
  function choose(id: string) { onPrimaryChange(id); setTemplateError(''); }
  return <div className="flex min-w-0 flex-col gap-2" data-good-category="">
    <AdminLabelWithHelp help={GOOD_EDITOR_HELP.primaryCategory} label="대표 카테고리"><label className={LABEL_CLASS} htmlFor="good-category-display">대표 카테고리</label></AdminLabelWithHelp>
    <div className="flex min-w-0 max-w-2xl flex-wrap items-center gap-2">
      <input aria-describedby={describedBy} aria-haspopup="dialog" aria-invalid={error ? 'true' : undefined} className={PICK_BOX_CLASS} data-slot="input" id="good-category-display" placeholder="아직 고르지 않았습니다" readOnly type="text" value={pathText}
        onClick={() => { if (canPick) setOpen(true); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); if (canPick) setOpen(true); } }} />
      <button aria-haspopup="dialog" aria-label={primary ? '대표 카테고리 바꾸기' : undefined} className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={!canPick} onClick={() => setOpen(true)} ref={pickRef} type="button">{primary ? '바꾸기' : '카테고리 선택'}</button>
      {primary ? <button aria-label="대표 카테고리 선택 해제" className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => { choose(''); pickRef.current?.focus(); }} type="button">선택 해제</button> : null}
      {/* 등록해 둔 바로가기가 있을 때만 보인다. 없으면 눌러도 빈 창이라 선택창만 둔다. */}
      {templatesAvailable ? <button className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => setTemplatePicker(true)} type="button">자주 쓰는 카테고리</button> : null}
    </div>
    {selectedArchived ? <p className="text-xs text-warning" id="good-category-archived" role="status">보관된 카테고리입니다. 다른 카테고리로 바꿔주세요.</p> : null}
    {/* R9: 카테고리가 하나도 없으면 고를 곳이 없으므로 먼저 등록할 곳을 알린다. 작성 중인 상품을 잃지 않게 새 탭으로 연다. */}
    {!canPick ? <p role="status" className={`${GOOD_NOTE_CLASS} text-muted-foreground`}>등록된 카테고리가 없습니다. 카테고리 관리에서 먼저 등록하세요. <Link className="text-foreground underline underline-offset-4" href={CATEGORY_PATH} target="_blank" rel="noreferrer">카테고리 관리</Link></p> : null}
    {/* 대표 카테고리 값(name="categoryId")은 이 select가 제출한다. 숨길 때는 select와 감싼 칸을 함께 숨긴다. */}
    <NativeSelect className="hidden" hidden aria-hidden="true" tabIndex={-1} aria-invalid={error ? 'true' : undefined} value={primary} id="good-category-primary" name="categoryId" ref={selectRef} onChange={(event) => { announcer.chosen(event.target.value); choose(event.target.value); }}>
      <option value="">미분류</option>
      {leaves.map((category) => <option key={category.id} value={category.id}>{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
    </NativeSelect>
    {templateError ? <p className="text-sm text-destructive" role="alert">{templateError}</p> : null}
    {open ? <AdminPickerDialog<CategoryPickerRow>
      emptyText="일치하는 카테고리가 없습니다."
      excludedNote="하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다."
      load={load}
      onClose={() => setOpen(false)}
      onSelect={(row) => { choose(row.category.id); }}
      rowKey={categoryRowKey}
      rowView={categoryRowView}
      searchPlaceholder={searchPlaceholder}
      selectedKeys={primary ? [primary] : undefined}
      title="대표 카테고리 선택"
    /> : null}
    {templatePicker ? <CategoryTemplatePicker onClose={() => setTemplatePicker(false)} onSelect={(template) => {
      if (!template.usable || !usableTemplateCategory(categories, template.categoryId)) { setTemplateError('현재 사용할 수 없는 카테고리입니다. 최신 카테고리를 확인해주세요.'); setTemplatePicker(false); return; }
      choose(template.categoryId); setTemplatePicker(false);
    }} /> : null}
    {error ? <span className="text-sm text-destructive" id="good-category-error" role="alert">{error}</span> : null}
  </div>;
}

/** 추가 카테고리(선택). 대표와 같은 분류는 제출하지 않는다. */
export function GoodAdditionalCategoryField({ categories, primary, value, error }: {
  categories: CategorySearchNode[]; primary: string; value: string; error?: string;
}) {
  const [additional, setAdditional] = useState<string[]>(() => {
    try {
      const values: unknown = JSON.parse(value || '[]');
      return Array.isArray(values) ? values.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  });
  const [open, setOpen] = useState(false);
  /* 대표로 옮긴 분류는 추가 목록에서 영구히 뺀다(대표를 다시 바꿔도 되살아나지 않는다 — 저장 결과 계약). */
  const [lastPrimary, setLastPrimary] = useState(primary);
  if (primary !== lastPrimary) {
    setLastPrimary(primary);
    if (additional.includes(primary)) setAdditional(additional.filter((id) => id !== primary));
  }
  const visible = additional.filter((id) => id !== primary);
  const load = useMemo(() => categoryPickerLoader(categories, primary ? new Set([primary]) : NOT_HIDDEN), [categories, primary]);
  return <div aria-labelledby="good-additional-category-label" className="flex min-w-0 flex-col gap-2" data-good-category-additional="" role="group">
    <input name="additionalCategoryIds" type="hidden" value={JSON.stringify(visible)} />
    <AdminLabelWithHelp help={GOOD_EDITOR_HELP.additionalCategory} label="추가 카테고리"><span className={LABEL_CLASS} id="good-additional-category-label">추가 카테고리 (선택)</span></AdminLabelWithHelp>
    {visible.map((id) => {
      const category = categories.find((item) => item.id === id);
      return <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm" key={id}>
        <span className="min-w-0 wrap-anywhere">{category?.archivedAt ? '보관됨 · ' : ''}{category ? categoryPath(categories, id).join(' > ') : UNKNOWN_CATEGORY}</span>
        <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" aria-label={`${category?.name ?? UNKNOWN_CATEGORY} 추가 카테고리에서 빼기`} onClick={() => setAdditional((current) => current.filter((item) => item !== id))}>빼기</button>
      </div>;
    })}
    <div><button aria-haspopup="dialog" className={buttonVariants({ variant: 'outline' })} data-slot="button" id="good-additional-category" onClick={() => setOpen(true)} type="button">카테고리 추가</button></div>
    {open ? <AdminPickerDialog<CategoryPickerRow>
      emptyText="일치하는 카테고리가 없습니다."
      excludedNote={primary ? '대표 카테고리와, 하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.' : '하위 카테고리가 있거나 보관한 카테고리는 목록에서 뺐습니다.'}
      load={load}
      multiple
      onClose={() => setOpen(false)}
      onDeselect={(row) => setAdditional((current) => current.filter((id) => id !== row.category.id))}
      onSelect={(row) => { setAdditional((current) => [...new Set([...current, row.category.id])]); }}
      rowKey={categoryRowKey}
      rowView={categoryRowView}
      searchPlaceholder={categorySearchPlaceholder(categories)}
      selectedKeys={visible}
      title="추가 카테고리 선택"
    /> : null}
    {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
  </div>;
}
