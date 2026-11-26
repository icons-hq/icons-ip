/* eslint-disable @next/next/no-img-element -- 고른 상품의 썸네일은 이미 호스팅된 공개 이미지를 고정 크기로 보인다. */
'use client';

import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { statusTone } from '@/lib/admin/status-tone';
import { MarketingLinkIssuer } from '../marketing/MarketingLinkIssuer';
import { AdminLabelWithHelp } from '../console/AdminHelpTip';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { AdminPickerDialog, type AdminPickerRowView } from '../console/AdminPickerDialog';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from '../AdminGoodsPicker';
import { CategoryTemplatesAvailableProvider } from '../CategoryTemplatesAvailability';
import { CategoryBulkCreatePanel } from '../CategoryBulkCreatePanel';
import { CategoryErpMappingTable } from '../CategoryErpMappingTable';
import { CategoryTree, firstCategoryInTree } from '../CategoryTree';
import { GoodCategoryField } from '../GoodCategoryFields';
import { FoldCard } from '../sections/SectionLayout';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import {
  assignAdminGoodCategoryAction,
  archiveAdminCategoryAction,
  reorderAdminCategoriesAction,
  saveAdminCategoryAction,
  setAdminCategoryActivationAction,
  unarchiveAdminCategoryAction,
  type AdminCategoryActionState,
} from '@/app/admin/category-actions';
import {
  categoriesInTreeOrder,
  categoryArchiveConfirm,
  categoryExportHref,
  categoryMoveOrder,
  categoryParentOptions,
  categoryPath,
  nextCategorySortOrder,
  type AdminCategoryActivation,
  type AdminCategoryErpMapping,
  type AdminCategoryNode,
} from '@/lib/admin/category';
import { usableTemplateCategory } from '@/lib/admin/category-templates';
import { ERP_ITEMS_PATH } from '@/lib/admin/erp-items';
import { adminConfirm, confirmAdminSubmit } from '@/lib/admin/confirm';
import { CATEGORY_HELP } from '@/lib/admin/help/category';
import { adminPickerLocalLoader } from '@/lib/admin/picker';

/** 서버 액션의 결과에 끝난 횟수(round)를 얹는다. 폼은 round로 작업 번호 칸과 입력을 새로 그린다. */
type CategoryFormState = AdminCategoryActionState & { round?: number };
type CategoryAction = (state: AdminCategoryActionState, formData: FormData) => Promise<AdminCategoryActionState>;

const EMPTY: CategoryFormState = {};
/* 라벨 위·입력 아래 칸과 두 칸 격자(템플릿 룩, ADR-0028). */
const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
const FIELD_GRID = 'grid gap-x-6 gap-y-4 sm:grid-cols-2';
const FORM = 'flex min-w-0 flex-col gap-3';
const HINT = 'text-xs font-normal text-muted-foreground';
const CHIP = 'rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground';
const UNKNOWN_CATEGORY = '알 수 없는 카테고리';

function useCategoryAction(action: CategoryAction) {
  return useActionState(async (previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> => ({
    ...await action(previous, formData), round: (previous.round ?? 0) + 1,
  }), EMPTY);
}

/**
 * 폼마다 작업 번호를 하나 쓴다. 번호는 보내는 순간에 만들어 숨은 칸에 적어 두므로 같은 폼을 연달아 보내도 번호가 같고(DB가 한 번만 처리한다),
 * 결과를 받으면(round가 오르면) 칸을 새로 그려 다음 저장은 새 번호를 쓴다.
 * value·defaultValue를 주지 않는다 — 주면 저장 중 다시 그릴 때 React가 적어 둔 번호를 기본값으로 되돌린다(숨은 칸은 값이 곧 기본값이다).
 */
function OperationIdField({ round }: { round: number }) {
  return <input key={round} name="operationId" type="hidden" />;
}

function stampOperationId(form: Pick<HTMLFormElement, 'elements'>) {
  const field = form.elements.namedItem('operationId') as HTMLInputElement | null;
  if (field && !field.value) field.value = crypto.randomUUID();
}

function Notice({ state }: { state: AdminCategoryActionState }) {
  return <>
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
  </>;
}

function FieldError({ children }: { children?: string }) {
  return children ? <span className="text-sm font-normal text-destructive" role="alert">{children}</span> : null;
}

/** 수정 중인 칸의 값이 저장된 값과 다른가. 입력이 비제어라 지금 값은 폼에서 읽는다(상위 카테고리·코드·순서는 숨은 칸이 싣는다). */
export function categoryFormChanged(form: Pick<HTMLFormElement, 'elements'> | null, category: AdminCategoryNode | null) {
  if (!form || !category) return false;
  const current = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
  return current('name') !== category.name
    || current('code') !== category.code
    || current('parentId') !== (category.parentId ?? '')
    || current('sortOrder') !== String(category.sortOrder);
}

interface ParentRow { category: AdminCategoryNode; path: string }
const parentRowKey = (row: ParentRow) => row.category.id;
const parentRowView = (row: ParentRow): AdminPickerRowView => ({ title: row.path, meta: `${row.category.depth}단계 · 카테고리 코드 ${row.category.code}` });

/**
 * 상위 카테고리 고르기. 공용 선택창(화면 규칙 1)에 지금 고를 수 있는 카테고리만 낸다 — 상품이 연결됐거나, 넣으면 4단계를 넘거나, 보관한 카테고리는
 * 저장할 때 거절되므로 목록에서 미리 뺀다(규칙 2). 고른 값은 숨은 칸(name="parentId")이 싣는다.
 */
function ParentCategoryField({ categories, editingId, error, onChange, value }: {
  categories: AdminCategoryNode[]; editingId: string | null; error?: string; onChange: (id: string) => void; value: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo<ParentRow[]>(() => categoryParentOptions(categories, editingId).map((category) => ({ category, path: categoryPath(categories, category.id).join(' > ') })), [categories, editingId]);
  const load = useMemo(() => adminPickerLocalLoader(rows, { textOf: (row) => `${row.path} ${row.category.code}` }), [rows]);
  const chosen = value ? categories.find((category) => category.id === value) : undefined;
  const shown = value ? `${chosen?.archivedAt ? '보관됨 · ' : ''}${categoryPath(categories, value).join(' > ') || UNKNOWN_CATEGORY}` : '';
  const boxId = editingId ? `category-parent-${editingId}` : 'category-parent-new';
  return <div className={FIELD}>
    <label htmlFor={boxId}>상위 카테고리</label>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Input aria-haspopup="dialog" aria-invalid={error ? 'true' : undefined} className="min-w-0 flex-1 basis-40 cursor-pointer truncate font-normal" id={boxId} placeholder="없음 (최상위 카테고리)" readOnly value={shown}
        onClick={() => { if (rows.length) setOpen(true); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); if (rows.length) setOpen(true); } }} />
      <Button disabled={!rows.length} onClick={() => setOpen(true)} type="button" variant="outline">상위 카테고리 고르기</Button>
      {value ? <Button onClick={() => onChange('')} type="button" variant="outline">최상위로</Button> : null}
    </div>
    <input name="parentId" type="hidden" value={value} />
    {/* 버튼이 잠겼으면 이유를 적는다(화면 규칙 5). 다른 카테고리가 하나도 없을 때도 말한다 — 카테고리가 하나뿐인 화면에서 버튼이 이유 없이 흐렸다(QA). */}
    {!rows.length ? <span className={HINT}>{categories.some((category) => category.id !== editingId)
      ? '지금 상위로 둘 수 있는 카테고리가 없습니다. 상품이 연결됐거나 4단계인 카테고리 아래에는 둘 수 없습니다.'
      : '다른 카테고리가 없어 최상위 카테고리로 둡니다.'}</span> : null}
    <FieldError>{error}</FieldError>
    {open ? <AdminPickerDialog<ParentRow>
      emptyText="일치하는 카테고리가 없습니다."
      excludedNote={editingId
        ? '이 카테고리와 그 하위 카테고리, 상품이 연결된 카테고리, 넣으면 4단계를 넘는 카테고리, 보관한 카테고리는 목록에서 뺐습니다.'
        : '상품이 연결된 카테고리, 4단계 카테고리, 보관한 카테고리는 목록에서 뺐습니다.'}
      load={load}
      onClose={() => setOpen(false)}
      onSelect={(row) => { onChange(row.category.id); }}
      rowKey={parentRowKey}
      rowView={parentRowView}
      searchPlaceholder="카테고리명 또는 코드로 찾기"
      selectedKeys={value ? [value] : undefined}
      title="상위 카테고리 고르기"
    /> : null}
  </div>;
}

/**
 * 카테고리 코드. 새 카테고리는 저장할 때 자동으로 만들어지므로 칸을 닫아 두고, 정해 둔 코드가 있을 때만 [직접 바꾸기]로 연다(ADR-0048과 같은 방식).
 * 닫혀 있는 동안 새 카테고리는 코드를 보내지 않고(서버가 만든다), 고치는 카테고리는 저장된 코드를 그대로 보낸다.
 * 입력 칸은 닫아도 화면에서 감추기만 한다(disabled라 제출되지 않는다) — 적어 둔 코드가 [바꾸지 않기]·[자동코드로 두기] 한 번에
 * 사라지지 않고, 다시 열면 그대로 있다(화면 규칙 7).
 */
function CategoryCodeField({ category, error, typed }: { category?: AdminCategoryNode; error?: string; typed?: string }) {
  const saved = category?.code ?? '';
  const [open, setOpen] = useState(Boolean(error) || (typed !== undefined && typed !== saved));
  const inputId = category ? `category-code-${category.id}` : 'category-code-new';
  return <div className={FIELD}>
    <span className="flex min-h-5 flex-wrap items-center gap-2">
      <label htmlFor={open ? inputId : undefined}>카테고리 코드</label>
      {open ? null : <span className={CHIP}>{category ? category.code : '자동 생성 · 입력할 필요 없음'}</span>}
      <button aria-expanded={open} className={buttonVariants({ variant: 'outline', size: 'xs' })} data-slot="button" onClick={() => setOpen((current) => !current)} type="button">{open ? (category ? '바꾸지 않기' : '자동코드로 두기') : '직접 바꾸기'}</button>
    </span>
    <Input aria-describedby={open ? `${inputId}-hint` : undefined} aria-invalid={error ? 'true' : undefined} className={open ? 'font-normal' : 'hidden font-normal'} defaultValue={typed ?? saved} disabled={!open} id={inputId} maxLength={80} name="code" placeholder="예: stationery-note" required />
    {open
      ? <span className={HINT} id={`${inputId}-hint`}>영문 소문자·숫자·하이픈(-)만 씁니다.{category ? ' 코드를 바꾸면 예전 코드가 적힌 상품 엑셀은 이 카테고리를 찾지 못합니다.' : ''}</span>
      : <input name="code" type="hidden" value={saved} />}
    <FieldError>{error}</FieldError>
  </div>;
}

/** 이름·코드·상위 카테고리 칸. 저장이 끝날 때마다(성공·거절) 부르는 쪽이 key로 새로 그린다 — 거절이면 적어 둔 값(`values`)에서, 성공이면 저장된 값에서 시작한다. */
export function CategoryFields({ category, categories, errors, values }: {
  category?: AdminCategoryNode; categories: AdminCategoryNode[]; errors?: AdminCategoryActionState['errors']; values?: Record<string, string>;
}) {
  const saved = category?.parentId ?? '';
  const [parent, setParent] = useState({ saved, value: values?.parentId ?? saved });
  /* 저장된 상위가 바뀌면(저장 성공·다른 사람의 변경) 그 값에서 다시 시작한다. */
  if (parent.saved !== saved) setParent({ saved, value: saved });
  /* 순서는 목록의 [위로]·[아래로]로 바꾼다. 여기서는 새 카테고리와 다른 상위로 옮긴 카테고리를 그 상위 아래 맨 끝에 놓는다. */
  const sortOrder = category && parent.value === saved ? category.sortOrder : nextCategorySortOrder(categories, parent.value || null, category?.id ?? null);
  const nameId = category ? `category-name-${category.id}` : 'category-name-new';
  return <>
    <input name="id" type="hidden" value={category?.id ?? ''} />
    <input name="expectedUpdatedAt" type="hidden" value={category?.updatedAt ?? ''} />
    <input name="sortOrder" type="hidden" value={sortOrder} />
    <div className={FIELD_GRID}>
      <div className={FIELD}>
        <label htmlFor={nameId}>카테고리 이름</label>
        <Input aria-invalid={errors?.name ? 'true' : undefined} className="font-normal" defaultValue={values?.name ?? category?.name ?? ''} id={nameId} maxLength={120} name="name" required />
        <FieldError>{errors?.name}</FieldError>
      </div>
      <CategoryCodeField category={category} error={errors?.code} typed={values?.code} />
    </div>
    <ParentCategoryField categories={categories} editingId={category?.id ?? null} error={errors?.parentId} onChange={(value) => setParent({ saved, value })} value={parent.value} />
  </>;
}

function CategoryForm({ category, categories, formRef }: { category?: AdminCategoryNode; categories: AdminCategoryNode[]; formRef?: RefObject<HTMLFormElement | null> }) {
  const [state, action, pending] = useCategoryAction(saveAdminCategoryAction);
  const round = state.round ?? 0;
  return <form action={action} className={FORM} onSubmit={(event) => stampOperationId(event.currentTarget)} ref={formRef}>
    <OperationIdField round={round} />
    <CategoryFields categories={categories} category={category} errors={state.errors} key={round} values={state.errors ? state.values : undefined} />
    <Notice state={state} />
    <Button className="self-start" disabled={pending} type="submit">{pending ? '저장 중' : category ? '저장' : '카테고리 추가'}</Button>
  </form>;
}

/** [보관]·[복원]. 보관은 연결된 상품 수와 고객 화면에서 달라지는 것을 확인창에 적는다. 지금 할 수 없는 쪽은 버튼을 잠그고 이유를 옆에 적는다. */
function ArchiveForm({ category, categories }: { category: AdminCategoryNode; categories: AdminCategoryNode[] }) {
  const archived = Boolean(category.archivedAt);
  const [state, formAction, pending] = useCategoryAction(archived ? unarchiveAdminCategoryAction : archiveAdminCategoryAction);
  const parent = category.parentId ? categories.find((candidate) => candidate.id === category.parentId) : undefined;
  /* DB가 거절하는 경우를 미리 잠근다: 하위가 남은 보관, 보관한 상위 아래로의 복원, 상품이 연결된 상위 아래로의 복원. */
  const blocked = !archived ? category.childCount > 0 ? '하위 카테고리를 먼저 보관하거나 다른 곳으로 옮겨야 보관할 수 있습니다.' : null
    : parent?.archivedAt ? `상위 카테고리(${parent.name})를 먼저 복원해야 복원할 수 있습니다.`
    : parent && parent.assignedGoodCount > 0 ? `상위 카테고리(${parent.name})에 상품이 연결돼 있어 복원할 수 없습니다. 그 상품을 다른 카테고리로 옮긴 뒤 복원해주세요.`
    : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    stampOperationId(event.currentTarget);
    if (!archived) confirmAdminSubmit(event, categoryArchiveConfirm(category));
  }
  return <form action={formAction} className="flex min-w-0 flex-wrap items-center gap-2" onSubmit={submit}>
    <OperationIdField round={state.round ?? 0} />
    <input name="id" type="hidden" value={category.id} /><input name="expectedUpdatedAt" type="hidden" value={category.updatedAt} />
    <Button className={archived ? undefined : 'text-destructive hover:text-destructive'} disabled={pending || Boolean(blocked)} size="sm" type="submit" variant="outline">{pending ? '처리 중' : archived ? '복원' : '보관'}</Button>
    {blocked ? <span className="text-xs text-muted-foreground">{blocked}</span> : null}
    {state.errors?.form ? <span className="text-xs text-destructive" role="alert">{state.errors.form}</span> : null}
  </form>;
}

/**
 * 고객 화면에 카테고리 보이기. 켜기·끄기 하나다(근거 칸은 없앴다 — 누가 언제 바꿨는지는 감사 기록이 남긴다).
 *
 * 'ERP 분류 사용' 값(erp_enabled)은 읽는 곳이 없어 스위치를 두지 않는다(2026-11-26 확인: 저장 함수와 이 화면 말고는 쓰지 않는다).
 * 값은 저장돼 있던 대로 실어 보낸다. 다만 DB는 그 값이 켜져 있으면 마지막 단계 카테고리마다 ERP 코드가 있어야 저장을 받으므로,
 * ERP 코드가 빈 카테고리가 생긴 뒤에는 끈 값으로 보낸다 — 보이지 않는 값 때문에 고객 화면 스위치가 잠기지 않게 한다.
 */
function ActivationForm({ activation, activeCategories, missingErpCodes }: { activation: AdminCategoryActivation; activeCategories: number; missingErpCodes: number }) {
  const [state, action, pending] = useCategoryAction(setAdminCategoryActivationAction);
  const turningOn = !activation.customerEnabled;
  /* 저장할 때 거절되는 경우는 버튼을 잠그고 풀 방법을 적는다(화면 규칙 5). */
  const blocked = turningOn && activeCategories === 0 ? '카테고리가 하나 이상 있어야 켤 수 있습니다. 아래에서 카테고리를 먼저 등록해주세요.' : null;
  return <form action={action} className={FORM} onSubmit={(event) => stampOperationId(event.currentTarget)}>
    <OperationIdField round={state.round ?? 0} />
    <input name="customerEnabled" type="hidden" value={turningOn ? 'on' : ''} />
    <input name="erpEnabled" type="hidden" value={activation.erpEnabled && missingErpCodes === 0 ? 'on' : ''} />
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <AdminLabelWithHelp help={CATEGORY_HELP.customerCategories} label="고객 화면에 카테고리 보이기">
        <span className="text-sm font-medium">{activation.customerEnabled ? '지금 고객 화면에 카테고리가 보입니다.' : '지금 고객 화면에는 카테고리가 보이지 않습니다.'}</span>
      </AdminLabelWithHelp>
      <Button disabled={pending || Boolean(blocked)} type="submit" variant={turningOn ? 'default' : 'outline'}>{pending ? '저장 중' : turningOn ? '켜기' : '끄기'}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{blocked ?? (turningOn ? '켜면 고객 화면에 바로 반영됩니다.' : '끄면 고객 화면에서 카테고리 메뉴가 바로 사라집니다. 상품은 그대로 판매됩니다.')}</p>
    <Notice state={state} />
  </form>;
}

/**
 * 접힌 카드(`<details>`) 안의 내용을 처음 펼칠 때 그린다.
 * 마지막 단계 카테고리가 300개면 ERP 코드 입력칸만으로 화면 DOM의 절반이 넘는다(2026-11-10 측정). 접어 둔 채 일하는 날이 대부분이다.
 * 다른 화면의 안내 링크가 카드 id를 해시로 가리키면 펼쳐 그 자리로 간다. 해시 이동은 접힘을 풀어 주지 않고, 스트리밍 중에는 맨 위에 멈추기도 한다.
 */
function RenderOnFirstOpen({ children }: { children: ReactNode }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const details = marker.current?.closest('details');
    if (!details) return undefined;
    const reveal = () => { if (details.open) setOpened(true); };
    if (details.id && details.id === window.location.hash.slice(1)) {
      details.open = true;
      details.scrollIntoView();
    }
    reveal();
    details.addEventListener('toggle', reveal);
    return () => details.removeEventListener('toggle', reveal);
  }, []);
  return <><span hidden ref={marker} />{opened ? children : null}</>;
}

/**
 * 상품 하나의 대표 카테고리 바꾸기. 상품은 공용 상품 선택창에서, 카테고리는 상품 등록과 같은 대표 카테고리 칸에서 고른다.
 * 상품과 카테고리를 모두 골라야 [대표 카테고리 바꾸기]가 눌린다 — 고르지 않은 채 저장해 대표 카테고리가 지워지는 일이 없다.
 * 지우는 일은 [미분류로 되돌리기]가 따로 맡고 한 번 묻는다. 공개 중인 상품은 지울 수 없어 그 버튼을 보이지 않는다.
 */
function AssignmentForm({ categories }: { categories: AdminCategoryNode[] }) {
  const [state, action, pending] = useCategoryAction(assignAdminGoodCategoryAction);
  const round = state.round ?? 0;
  const [good, setGood] = useState<AdminGoodsPickerRow | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [picking, setPicking] = useState(false);
  /* 방금 보낸 변경. 저장되면 고른 상품의 '지금 대표 카테고리'를 그 값으로 바꿔 결과를 그 자리에서 보인다. */
  const [sent, setSent] = useState<{ clearing: boolean; categoryId: string } | null>(null);
  /* 다른 상품을 고르면 앞 상품의 저장 결과 줄을 내린다(그 결과는 새로 고른 상품의 것이 아니다). */
  const [quietRound, setQuietRound] = useState(-1);
  const result: AdminCategoryActionState = quietRound === round ? {} : state;
  const [applied, setApplied] = useState(round);
  if (applied !== round) {
    setApplied(round);
    if (!state.errors && good && sent) {
      setGood({ ...good, categoryName: sent.clearing ? null : categories.find((category) => category.id === sent.categoryId)?.name ?? good.categoryName });
      setCategoryId('');
    }
  }
  const canPick = useMemo(() => categories.some((category) => usableTemplateCategory(categories, category.id)), [categories]);
  const filterCategories = useMemo(() => categoriesInTreeOrder(categories).map((category) => ({
    id: category.id, name: `${'　'.repeat(Math.max(0, category.depth - 1))}${category.name}${category.archivedAt ? ' (보관)' : ''}`,
  })), [categories]);
  function submit(event: FormEvent<HTMLFormElement>) {
    stampOperationId(event.currentTarget);
    const submitter = (event.nativeEvent as { submitter?: HTMLButtonElement | null }).submitter;
    const clearing = submitter?.value === 'clear';
    setSent({ clearing, categoryId });
    if (clearing && good) confirmAdminSubmit(event, {
      title: `'${good.name}'의 대표 카테고리를 지울까요?`,
      message: `지금 대표 카테고리는 ${good.categoryName ?? '미분류'}입니다. 지우면 미분류가 되고, 대표 카테고리를 다시 고르기 전에는 이 상품을 공개할 수 없습니다.`,
      confirmLabel: '미분류로 되돌리기',
    });
  }
  return <form action={action} className={FORM} onSubmit={submit}>
    <OperationIdField round={round} />
    <input name="goodId" type="hidden" value={good?.id ?? ''} />
    {good ? <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-3" data-category-assign-good="">
      {good.imageUrl ? <img alt="" className="size-12 shrink-0 rounded-md bg-muted object-cover" height={48} src={good.imageUrl} width={48} /> : <span aria-hidden="true" className="size-12 shrink-0 rounded-md bg-muted" />}
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5 wrap-anywhere">
        <strong className="font-medium">{good.name}</strong>
        <small className="text-xs text-muted-foreground">{good.code} · 지금 대표 카테고리 {good.categoryName ?? '미분류'} · {good.published ? '공개' : '초안'}</small>
      </div>
      <Button onClick={() => setPicking(true)} type="button" variant="outline">다른 상품 고르기</Button>
    </div> : <div><Button onClick={() => setPicking(true)} type="button" variant="outline">상품 고르기</Button></div>}
    {/* 이 화면 위에 일괄 등록·새 카테고리 카드가 있어, 카테고리가 없을 때는 같은 화면을 새 탭으로 여는 링크 대신 위 카드를 가리킨다. */}
    {!good ? null : canPick
      ? <GoodCategoryField categories={categories} error={result.errors?.categoryId} onPrimaryChange={setCategoryId} primary={categoryId} />
      : <p className="text-sm text-muted-foreground" role="status">고를 수 있는 카테고리가 없습니다. 위 카테고리 일괄 등록이나 새 카테고리 등록에서 먼저 등록하세요.</p>}
    <Notice state={result} />
    {good ? <div className="flex flex-wrap items-center gap-2">
      <Button disabled={pending || !categoryId} type="submit">{pending ? '저장 중' : '대표 카테고리 바꾸기'}</Button>
      {good.categoryName && !good.published ? <button className={buttonVariants({ variant: 'outline' })} data-slot="button" disabled={pending} name="intent" type="submit" value="clear">미분류로 되돌리기</button> : null}
    </div> : null}
    {picking ? <AdminGoodsPicker
      categories={filterCategories}
      excludedNote="보관한 상품은 목록에서 뺐습니다."
      onClose={() => setPicking(false)}
      onSelect={(row) => { setGood(row); setCategoryId(''); setSent(null); setQuietRound(round); }}
      selectedKeys={good ? [good.id] : undefined}
      title="상품 고르기"
    /> : null}
  </form>;
}

export function CategoryScreen({ data, canManagePlatform = true, hasCategoryTemplates = false }: { data: { categories: AdminCategoryNode[]; mappings: AdminCategoryErpMapping[]; activation: AdminCategoryActivation }; canManagePlatform?: boolean; hasCategoryTemplates?: boolean }) {
  const activeLeaves = data.categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const mappedIds = new Set(data.mappings.map((mapping) => mapping.categoryId));
  const missingErpCodes = activeLeaves.filter((category) => !mappedIds.has(category.id)).length;
  /* 오른쪽 입력 묶음은 목록에서 고른 항목 하나다. 처음에는 목록 맨 위 항목을 연다 — 그 항목을 고른 것으로 두어, 순서나 상위를 바꿔 맨 위가 아니게 돼도 고치던 항목이 그대로 열려 있다. */
  const [selectedId, setSelectedId] = useState<string | null>(() => firstCategoryInTree(data.categories)?.id ?? null);
  const selected = data.categories.find((category) => category.id === selectedId) ?? firstCategoryInTree(data.categories);
  const editForm = useRef<HTMLFormElement>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const moveRunning = useRef(false);
  /* 오른쪽 입력 묶음은 고른 항목마다 새로 그려져 저장 안 한 입력이 사라진다 — 말없이 잃지 않게 한 번 묻는다. */
  async function selectCategory(category: AdminCategoryNode) {
    if (category.id === selected?.id) return;
    if (categoryFormChanged(editForm.current, selected) && !await adminConfirm('저장하지 않은 변경이 있습니다. 다른 카테고리를 고르면 입력이 사라집니다. 이동할까요?')) return;
    setMoveError('');
    setSelectedId(category.id);
  }
  /* [위로]·[아래로]는 누르면 바로 저장한다. 같은 상위 아래의 카테고리 전체를 새 순서대로 보낸다. */
  async function moveCategory(category: AdminCategoryNode, direction: 'up' | 'down') {
    const order = categoryMoveOrder(data.categories, category.id, direction);
    if (!order || moveRunning.current) return;
    moveRunning.current = true; setMoving(true); setMoveError('');
    try {
      const result = await reorderAdminCategoriesAction({ operationId: crypto.randomUUID(), ...order });
      if (!result.ok) setMoveError(result.error);
    } catch {
      setMoveError('순서를 바꿨는지 확인하지 못했습니다. 새로고침해 카테고리 목록을 확인해주세요.');
    } finally {
      moveRunning.current = false; setMoving(false);
    }
  }
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="categories">
    <AdminPageHeader title="카테고리 관리" description="카테고리를 최대 4단계로 만들고 상품에 연결합니다. 상품은 대표 카테고리가 있어야 공개할 수 있습니다." actions={/* 파일 내려받기 API라 Link(미리 가져오기·화면 이동)가 아니라 일반 링크다. */<a className={buttonVariants({ variant: 'outline' })} data-slot="button" href={categoryExportHref()}><Download aria-hidden="true" />카테고리 목록 내려받기</a>} />
    {canManagePlatform ? <FoldCard title="고객 화면에 카테고리 보이기" badge={<AdminStatusBadge tone={data.activation.customerEnabled ? statusTone('display', 'active') : 'warning'}>{data.activation.customerEnabled ? '켜짐' : '꺼짐'}</AdminStatusBadge>} cue={data.activation.customerEnabled ? undefined : '펼쳐서 켜기'}>
      <ActivationForm activation={data.activation} activeCategories={data.categories.filter((category) => !category.archivedAt).length} missingErpCodes={missingErpCodes} />
    </FoldCard> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,0.45fr)_minmax(0,1fr)]" data-category-screen="master-detail">
      <AdminSectionCard title={`카테고리 목록 ${data.categories.length}개`} summary="이름을 누르면 오른쪽에서 고칩니다.">
        <CategoryTree activeId={selected?.id ?? null} categories={data.categories} moving={moving} onMove={moveCategory} onSelect={selectCategory} />
        {moveError ? <p className="text-sm text-destructive" role="alert">{moveError}</p> : null}
      </AdminSectionCard>
      {/* 목록이 길어도 고르는 동안 입력 묶음이 함께 보이게 붙어 따라온다. 새 등록은 접어 저장 버튼이 한 화면에 하나만 보이게 한다. */}
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-16">
        {selected ? <AdminSectionCard key={selected.id} title={`${selected.name} 수정`}>
          <CategoryForm category={selected} categories={data.categories} formRef={editForm} />
          <div className="flex flex-wrap items-center gap-2 border-t pt-3"><ArchiveForm categories={data.categories} category={selected} /><MarketingLinkIssuer size="sm" source="category" targetIds={[selected.id]} /></div>
        </AdminSectionCard> : null}
        <FoldCard open={!selected} title="새 카테고리 등록"><CategoryForm categories={data.categories} /></FoldCard>
      </div>
    </div>
    <FoldCard title="카테고리 일괄 등록"><CategoryBulkCreatePanel /></FoldCard>
    {canManagePlatform ? <FoldCard id="category-erp-mapping" title="카테고리별 ERP 코드" summary={`마지막 단계 ${activeLeaves.length}개 · ERP 코드 없음 ${missingErpCodes}개`}>
      {/* 이름이 비슷한 ERP 품목 화면의 연결 표와 헷갈리지 않게, 여기 적은 값이 어디에 쓰이는지와 그 표와의 관계를 함께 말한다. */}
      <p className="text-sm text-muted-foreground">여기 적은 ERP 코드·품명은 [카테고리 목록 내려받기] 파일에 실립니다. ERP 품목의 분류 이름과 같게 적어 두면 <Link className="text-foreground underline underline-offset-4" href={`${ERP_ITEMS_PATH}#erp-category-mapping`}>ERP 품목 화면의 연결 표</Link>에서 그 분류가 이 카테고리에 자동으로 연결됩니다.</p>
      <RenderOnFirstOpen><CategoryErpMappingTable categories={data.categories} mappings={data.mappings} /></RenderOnFirstOpen>
    </FoldCard> : null}
    <AdminSectionCard title="대표 카테고리 바꾸기"><CategoryTemplatesAvailableProvider available={hasCategoryTemplates}><AssignmentForm categories={data.categories} /></CategoryTemplatesAvailableProvider></AdminSectionCard>
  </section>;
}
