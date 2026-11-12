'use client';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { statusTone } from '@/lib/admin/status-tone';
import { MarketingLinkIssuer } from '../marketing/MarketingLinkIssuer';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { CategoryAssignmentField } from '../CategoryAssignmentField';
import { CategoryTemplatesAvailableProvider } from '../CategoryTemplatesAvailability';
import { CategoryBulkCreatePanel } from '../CategoryBulkCreatePanel';
import { CategoryErpMappingTable } from '../CategoryErpMappingTable';
import { CategoryTree, firstCategoryInTree } from '../CategoryTree';
import { GOOD_TYPES } from '@/lib/goods-taxonomy';
import { goodTypeSuggestion } from '@/lib/admin/good-workspace';
import { FoldCard } from '../sections/SectionLayout';
import { AdminSelect } from '../console/AdminSelect';
import { Button, buttonVariants } from '../kit/ui/button';
import { Input } from '../kit/ui/input';
import { Textarea } from '../kit/ui/textarea';
import {
  assignAdminGoodCategoryAction,
  archiveAdminCategoryAction,
  saveAdminCategoryAction,
  saveAdminCategoryTypeMigrationAction,
  setAdminCategoryActivationAction,
  unarchiveAdminCategoryAction,
  type AdminCategoryActionState,
} from '@/app/admin/category-actions';
import {
  categoryActivationLabel,
  categoryExportHref,
  categoryGoodTypeSource,
  categoryParentOptions,
  categoryPath,
  type AdminCategoryActivation,
  type AdminCategoryErpMapping,
  type AdminCategoryMigration,
  type AdminCategoryNode,
} from '@/lib/admin/category';
import { ERP_ITEMS_PATH } from '@/lib/admin/erp-items';
import { adminConfirm } from '@/lib/admin/confirm';

const EMPTY: AdminCategoryActionState = {};
/* 입력 묶음 상자(kit 카드 안의 작은 상자)와 라벨 위·입력 아래 칸(템플릿 룩, ADR-0028). */
const FORM_BOX = 'flex min-w-0 flex-col gap-3 rounded-lg border p-4';
const FIELD = 'flex min-w-0 flex-col gap-2 text-sm font-medium';
const FIELD_GRID = 'grid gap-x-6 gap-y-4 sm:grid-cols-2';
/* 카드 하나에 입력 묶음 하나뿐인 폼은 안쪽 테두리 없이 카드를 그대로 쓴다. */
const FORM_PLAIN = 'flex min-w-0 flex-col gap-3';

function Notice({ state }: { state: AdminCategoryActionState }) {
  return <>
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    {state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
  </>;
}

function Labeled({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <label className={FIELD}>{label}{children}</label>;
}

/** 수정 중인 칸의 값이 저장된 값과 다른가. 입력이 비제어라 지금 값은 폼에서 읽는다. */
export function categoryFormChanged(form: Pick<HTMLFormElement, 'elements'> | null, category: AdminCategoryNode | null, categories: readonly AdminCategoryNode[]) {
  if (!form || !category) return false;
  const current = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  /* 보관된 상위는 선택지에 없어 칸이 '최상위'로 보인다 — 그 값은 사용자가 바꾼 것이 아니다. */
  const shownParent = categoryParentOptions(categories, category.id).some((option) => option.id === category.parentId) ? category.parentId : '';
  return current('name') !== category.name
    || current('code') !== category.code
    || current('parentId') !== (shownParent ?? '')
    || current('sortOrder') !== String(category.sortOrder)
    || current('goodType') !== (category.goodType ?? '');
}

/**
 * 카테고리의 상품 유형 연결 칸(SHEET-003·ADR-0037). 상품 유형 = 대표 카테고리(없으면 가까운 상위)의 연결값이다.
 * 바꾸면 이 카테고리(하위 포함) 초안 상품의 유형이 바로 바뀌고 KC를 다시 검토한다. 공개 중 상품은 저장된 유형을 유지한다.
 */
function GoodTypeField({ category, categories }: { category?: AdminCategoryNode; categories: AdminCategoryNode[] }) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const applied = category ? categoryGoodTypeSource(categories, category.id) : null;
  const suggestion = category && !category.goodType ? goodTypeSuggestion(categoryPath(categories, category.id)) : null;
  const parentName = applied?.inherited && applied.categoryId ? categories.find((node) => node.id === applied.categoryId)?.name : null;
  return <div className="flex min-w-0 flex-col gap-2" data-category-good-type-field="">
    <Labeled label="상품 유형 연결"><AdminSelect defaultValue={category?.goodType ?? ''} name="goodType" ref={selectRef} wrapperClassName="w-full">
      <option value="">연결 안 함 · 상위 카테고리를 따름</option>
      {GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
    </AdminSelect></Labeled>
    <p className="text-sm text-muted-foreground">
      {applied ? applied.type ? <>지금 이 카테고리 상품의 유형은 <strong className="font-medium text-foreground">{applied.type}</strong>입니다{parentName ? ` (상위 ‘${parentName}’ 연결)` : ''}. </> : <>지금은 이 카테고리와 상위에 연결된 유형이 없어 이 카테고리 상품은 공개할 수 없습니다. </> : null}
      바꾸면 이 카테고리(하위 포함) 초안 상품의 유형이 바로 바뀌고 KC를 다시 검토해야 공개할 수 있습니다. 공개 중인 상품은 저장된 유형을 유지하고 판매 준비에 경고가 보입니다.
    </p>
    {suggestion ? <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground" data-category-good-type-suggestion="">이름 기준 추천 <Button size="sm" type="button" variant="soft" onClick={() => {
      const select = selectRef.current;
      if (select) { select.value = suggestion; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }}>{suggestion} 선택</Button></p> : null}
  </div>;
}

function CategoryForm({ category, categories, formRef }: { category?: AdminCategoryNode; categories: AdminCategoryNode[]; formRef?: RefObject<HTMLFormElement | null> }) {
  const [state, action, pending] = useActionState(saveAdminCategoryAction, EMPTY);
  const options = categoryParentOptions(categories, category?.id ?? null);
  return <form action={action} className={FORM_PLAIN} ref={formRef}>
    <input name="id" type="hidden" value={category?.id ?? ''} />
    <input name="expectedUpdatedAt" type="hidden" value={category?.updatedAt ?? ''} />
    <input name="operationId" type="hidden" value="" />
    <div className={FIELD_GRID}>
      <Labeled label="카테고리 이름"><Input defaultValue={category?.name ?? ''} maxLength={120} name="name" required /></Labeled>
      <Labeled label="카테고리 코드 (영문)"><Input defaultValue={category?.code ?? ''} maxLength={80} name="code" required /></Labeled>
      <Labeled label="상위 카테고리"><AdminSelect defaultValue={category?.parentId ?? ''} key={category?.parentId ?? ''} name="parentId" wrapperClassName="w-full"><option value="">최상위</option>{options.map((option) => <option key={option.id} value={option.id}>{'　'.repeat(Math.max(0, option.depth - 1))}{option.name} ({option.code})</option>)}</AdminSelect></Labeled>
      <Labeled label="노출 순서 (작을수록 앞)"><Input className="tabular-nums" defaultValue={category?.sortOrder ?? 0} min={0} name="sortOrder" type="number" /></Labeled>
    </div>
    <GoodTypeField category={category} categories={categories} />
    {state.errors?.goodType ? <p className="text-sm text-destructive" role="alert">{state.errors.goodType}</p> : null}
    <Notice state={state} />
    <Button className="self-start" disabled={pending} type="submit">{pending ? '저장 중' : category ? '저장' : '카테고리 추가'}</Button>
  </form>;
}

function ArchiveForm({ category }: { category: AdminCategoryNode }) {
  const action = category.archivedAt ? unarchiveAdminCategoryAction : archiveAdminCategoryAction;
  const [state, formAction, pending] = useActionState(action, EMPTY);
  return <form action={formAction} className="flex flex-wrap items-center gap-2">
    <input name="id" type="hidden" value={category.id} /><input name="expectedUpdatedAt" type="hidden" value={category.updatedAt} /><input name="operationId" type="hidden" value="" />
    <Button className={category.archivedAt ? undefined : 'text-destructive hover:text-destructive'} size="sm" variant="outline" disabled={pending} type="submit">{pending ? '처리 중' : category.archivedAt ? '복원' : '보관'}</Button>
    {state.errors?.form ? <span className="text-xs text-destructive" role="alert">{state.errors.form}</span> : null}
  </form>;
}

function ActivationForm({ activation }: { activation: AdminCategoryActivation }) {
  const [state, action, pending] = useActionState(setAdminCategoryActivationAction, EMPTY);
  return <form action={action} className={FORM_BOX}>
    <input name="operationId" type="hidden" value="" />
    <label className="flex cursor-pointer items-center gap-2 text-sm"><input defaultChecked={activation.customerEnabled} name="customerEnabled" type="checkbox" /> 고객 화면 카테고리 조회·검색 사용</label>
    <label className="flex cursor-pointer items-center gap-2 text-sm"><input defaultChecked={activation.erpEnabled} name="erpEnabled" type="checkbox" /> ERP 분류 조회·내보내기 사용</label>
    <p className="text-sm text-muted-foreground">현재 상태: {categoryActivationLabel(activation)}. 실제 이름·코드와 카테고리 구조, 운영 확인 근거가 없으면 켜지지 않습니다.</p>
    <div className={FIELD_GRID}>
      <Labeled label="고객 분류 근거 출처"><Input defaultValue={activation.customerEvidence?.source ?? ''} name="customerEvidenceSource" /></Labeled>
      <Labeled label="고객 분류 근거 참조"><Input defaultValue={activation.customerEvidence?.reference ?? ''} name="customerEvidenceReference" /></Labeled>
      <Labeled label="고객 분류 검증 시각"><Input defaultValue={activation.customerEvidence?.verifiedAt ?? ''} name="customerEvidenceVerifiedAt" type="datetime-local" /></Labeled>
      <Labeled label="ERP 근거 출처"><Input defaultValue={activation.erpEvidence?.source ?? ''} name="erpEvidenceSource" /></Labeled>
      <Labeled label="ERP 근거 참조"><Input defaultValue={activation.erpEvidence?.reference ?? ''} name="erpEvidenceReference" /></Labeled>
      <Labeled label="ERP 검증 시각"><Input defaultValue={activation.erpEvidence?.verifiedAt ?? ''} name="erpEvidenceVerifiedAt" type="datetime-local" /></Labeled>
    </div>
    <Notice state={state} />
    <Button className="self-start" disabled={pending} type="submit">{pending ? '저장 중' : '활성화 상태 저장'}</Button>
  </form>;
}

/**
 * 접힌 카드(`<details>`) 안의 내용을 처음 펼칠 때 그린다.
 * 말단 300개면 ERP 분류 매핑 입력 묶음만 DOM 4,500개로 화면 DOM의 절반이 넘는다(2026-11-10 측정). 접어 둔 채 일하는 날이 대부분이다.
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

function MigrationForm({ types, categories }: { types: string[]; categories: AdminCategoryNode[] }) {
  const [state, action, pending] = useActionState(saveAdminCategoryTypeMigrationAction, EMPTY);
  return <form action={action} className={FORM_BOX}>
    <input name="operationId" type="hidden" value="" />
    <div className={FIELD_GRID}>
      <Labeled label="기존 유형"><AdminSelect name="type" wrapperClassName="w-full"><option value="">선택</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</AdminSelect></Labeled>
      <Labeled label="제안 카테고리"><AdminSelect name="categoryId" wrapperClassName="w-full"><option value="">미설정</option>{categories.filter((category) => !category.archivedAt && category.childCount === 0).map((category) => <option key={category.id} value={category.id}>{category.name} ({category.code})</option>)}</AdminSelect></Labeled>
      <Labeled label="상태"><AdminSelect defaultValue="suggested" name="status" wrapperClassName="w-full"><option value="suggested">제안</option><option value="confirmed">운영 확인</option><option value="rejected">보류</option></AdminSelect></Labeled>
    </div>
    <Labeled label="메모"><Textarea name="note" rows={2} /></Labeled>
    {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
    <Button className="self-start" variant="outline" disabled={pending} type="submit">{pending ? '저장 중' : '이관 메모 저장'}</Button>
  </form>;
}

function AssignmentForm({ categories }: { categories: AdminCategoryNode[] }) {
  const [state, action, pending] = useActionState(assignAdminGoodCategoryAction, EMPTY);
  return <form action={action} className={FORM_BOX}>
    <input name="operationId" type="hidden" value="" />
    <input name="expectedUpdatedAt" type="hidden" value="" />
    <Labeled label={adminGoodsCopy("굿즈 ID")}><Input className="sm:max-w-sm" name="goodId" placeholder="goods-id" required /></Labeled>
    {/* 이 화면 위에 일괄 등록·새 카테고리 카드가 있어 0건 안내가 같은 화면을 새 탭으로 열지 않게 한다. */}
    <CategoryAssignmentField categories={categories} error={state.errors?.categoryId} emptyGuide="here" />
    <Notice state={state} />
    <Button className="self-start" disabled={pending} type="submit">{pending ? '저장 중' : '대표 분류 저장'}</Button>
  </form>;
}

export function CategoryScreen({ data, legacyTypes = [], canManagePlatform = true, hasCategoryTemplates = false }: { data: { categories: AdminCategoryNode[]; mappings: AdminCategoryErpMapping[]; migrations: AdminCategoryMigration[]; activation: AdminCategoryActivation }; legacyTypes?: string[]; canManagePlatform?: boolean; hasCategoryTemplates?: boolean }) {
  const activeLeaves = data.categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const mappedIds = new Set(data.mappings.map((mapping) => mapping.categoryId));
  /* 오른쪽 입력 묶음은 트리에서 고른 항목 하나다. 아직 안 골랐으면 트리 맨 위 항목을 연다. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.categories.find((category) => category.id === selectedId) ?? firstCategoryInTree(data.categories);
  const editForm = useRef<HTMLFormElement>(null);
  /* 오른쪽 입력 묶음은 고른 항목마다 새로 그려져 저장 안 한 입력이 사라진다 — 말없이 잃지 않게 한 번 묻는다. */
  async function selectCategory(category: AdminCategoryNode) {
    if (category.id === selected?.id) return;
    if (categoryFormChanged(editForm.current, selected, data.categories) && !await adminConfirm('저장하지 않은 변경이 있습니다. 다른 카테고리를 고르면 입력이 사라집니다. 이동할까요?')) return;
    setSelectedId(category.id);
  }
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="categories">
    <AdminPageHeader title="카테고리 관리" description="카테고리를 최대 4단계로 구성하고 상품에 대표·추가 분류로 연결합니다. 상품 유형은 대표 카테고리(없으면 가까운 상위)에 연결한 값으로 정해집니다." actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={categoryExportHref()}><Download aria-hidden="true" />{canManagePlatform ? '분류·ERP CSV' : '분류 CSV'}</Link>} />
    {canManagePlatform ? <FoldCard title="활성화 상태" badge={<AdminStatusBadge tone={data.activation.customerEnabled ? statusTone('display', 'active') : 'warning'}>{data.activation.customerEnabled ? '고객 화면 적용 중' : '고객 화면 미적용'}</AdminStatusBadge>} cue={data.activation.customerEnabled ? undefined : '펼쳐서 켜기'} summary={data.activation.customerEnabled ? categoryActivationLabel(data.activation) : '고객 화면에는 아직 기존 유형이 보입니다. 트리를 다 만든 뒤 펼쳐서 켜주세요.'}><ActivationForm activation={data.activation} /></FoldCard> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,0.45fr)_minmax(0,1fr)]" data-category-screen="master-detail">
      <AdminSectionCard title={`카테고리 트리 ${data.categories.length}개`} summary="이름을 누르면 오른쪽에서 수정합니다."><CategoryTree activeId={selected?.id ?? null} categories={data.categories} onSelect={selectCategory} /></AdminSectionCard>
      {/* 트리가 길어도 고르는 동안 입력 묶음이 함께 보이게 붙어 따라온다. 새 등록은 접어 저장 버튼이 한 화면에 하나만 보이게 한다. */}
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-16">
        {selected ? <AdminSectionCard key={selected.id} title={`${selected.name} 수정`}>
          <CategoryForm category={selected} categories={data.categories} formRef={editForm} />
          <div className="flex flex-wrap items-center gap-2 border-t pt-3"><ArchiveForm category={selected} /><MarketingLinkIssuer size="sm" source="category" targetIds={[selected.id]} /></div>
        </AdminSectionCard> : null}
        <FoldCard open={!selected} title="새 카테고리 등록"><CategoryForm categories={data.categories} /></FoldCard>
      </div>
    </div>
    <FoldCard title="카테고리 일괄 등록"><CategoryBulkCreatePanel /></FoldCard>
    {canManagePlatform ? <FoldCard id="category-erp-mapping" title="ERP 분류 매핑" summary={`맨 아래 단계 ${activeLeaves.length}개 · 미설정 ${activeLeaves.filter((category) => !mappedIds.has(category.id)).length}개`}>
      {/* 이름이 비슷한 ERP 품목 화면의 연결과 헷갈리지 않게 여기서 하는 일과 저기서 하는 일을 함께 말한다. */}
      <p className="text-sm text-muted-foreground">카테고리마다 ERP 코드·품명을 근거와 함께 적어 두는 곳입니다. 분류·ERP CSV와 ERP 활성화에 쓰이고, 상품은 바뀌지 않습니다. 실제 ERP 코드·품명·출처·검증 시각이 없는 매핑은 쓰지 않습니다. 매핑이 없으면 내보내기에서 미설정으로 표시합니다.</p>
      <p className="text-sm text-muted-foreground">반입한 ERP 분류를 고객 카테고리에 잇는 일(상품 옵션의 카테고리 제안)은 <Link className="text-foreground underline underline-offset-4" href={`${ERP_ITEMS_PATH}#erp-category-mapping`}>ERP 품목 화면의 연결 표</Link>에서 합니다.</p>
      <RenderOnFirstOpen><CategoryErpMappingTable categories={data.categories} mappings={data.mappings} /></RenderOnFirstOpen>
    </FoldCard> : null}
    {canManagePlatform ? <FoldCard title="기존 유형 이관 메모"><p className="text-sm text-muted-foreground">유사 이름으로 자동 이관하지 않습니다. 확인된 항목만 선택적으로 기록하며, 전체 카테고리 기능을 켜는 조건은 아닙니다.</p><MigrationForm categories={data.categories} types={legacyTypes} />{data.migrations.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{data.migrations.map((migration) => <li key={migration.type}>{migration.type} · {migration.status} · {migration.categoryId ?? '미설정'}</li>)}</ul> : null}</FoldCard> : null}
    <AdminSectionCard title={adminGoodsCopy("굿즈 기본 카테고리 적용")}><p className="text-sm text-muted-foreground">대표 분류 하나를 바로 변경합니다. 추가 분류는 상품 편집에서 확인하고 저장하며 ERP는 대표 분류를 사용합니다.</p><CategoryTemplatesAvailableProvider available={hasCategoryTemplates}><AssignmentForm categories={data.categories} /></CategoryTemplatesAvailableProvider></AdminSectionCard>
  </section>;
}
