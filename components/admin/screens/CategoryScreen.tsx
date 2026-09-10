'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { CategoryAssignmentField } from '../CategoryAssignmentField';
import { CategoryTree } from '../CategoryTree';
import {
  assignAdminGoodCategoryAction,
  archiveAdminCategoryAction,
  saveAdminCategoryAction,
  saveAdminCategoryErpMappingAction,
  saveAdminCategoryTypeMigrationAction,
  setAdminCategoryActivationAction,
  unarchiveAdminCategoryAction,
  type AdminCategoryActionState,
} from '@/app/admin/category-actions';
import {
  categoryActivationLabel,
  categoryExportHref,
  categoryParentOptions,
  type AdminCategoryActivation,
  type AdminCategoryErpMapping,
  type AdminCategoryMigration,
  type AdminCategoryNode,
} from '@/lib/admin/category';

const EMPTY: AdminCategoryActionState = {};

function CategoryForm({ category, categories }: { category?: AdminCategoryNode; categories: AdminCategoryNode[] }) {
  const [state, action, pending] = useActionState(saveAdminCategoryAction, EMPTY);
  const options = categoryParentOptions(categories, category?.id ?? null);
  return <form action={action} className="card col" style={{ gap: 10, padding: 14 }}>
    <input name="id" type="hidden" value={category?.id ?? ''} />
    <input name="expectedUpdatedAt" type="hidden" value={category?.updatedAt ?? ''} />
    <input name="operationId" type="hidden" value="" />
    <label className="col" style={{ gap: 5 }}>코드<input className="admin-field-control" defaultValue={category?.code ?? ''} maxLength={80} name="code" required /></label>
    <label className="col" style={{ gap: 5 }}>이름<input className="admin-field-control" defaultValue={category?.name ?? ''} maxLength={120} name="name" required /></label>
    <label className="col" style={{ gap: 5 }}>부모<select className="admin-field-control" defaultValue={category?.parentId ?? ''} name="parentId"><option value="">최상위</option>{options.map((option) => <option key={option.id} value={option.id}>{'　'.repeat(Math.max(0, option.depth - 1))}{option.name} ({option.code})</option>)}</select></label>
    <label className="col" style={{ gap: 5 }}>순서<input className="admin-field-control" defaultValue={category?.sortOrder ?? 0} min={0} name="sortOrder" type="number" /></label>
    {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.form}</p> : null}
    {state.message ? <p role="status" style={{ color: 'var(--mint)', margin: 0 }}>{state.message}</p> : null}
    <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '저장 중' : category ? '저장' : '카테고리 추가'}</button>
  </form>;
}

function ArchiveForm({ category }: { category: AdminCategoryNode }) {
  const action = category.archivedAt ? unarchiveAdminCategoryAction : archiveAdminCategoryAction;
  const [state, formAction, pending] = useActionState(action, EMPTY);
  return <form action={formAction} className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
    <input name="id" type="hidden" value={category.id} /><input name="expectedUpdatedAt" type="hidden" value={category.updatedAt} /><input name="operationId" type="hidden" value="" />
    <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '처리 중' : category.archivedAt ? '복원' : '보관'}</button>
    {state.errors?.form ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.form}</span> : null}
  </form>;
}

function MappingForm({ category, mapping }: { category: AdminCategoryNode; mapping?: AdminCategoryErpMapping }) {
  const [state, action, pending] = useActionState(saveAdminCategoryErpMappingAction, EMPTY);
  return <form action={action} className="card col" style={{ gap: 8, padding: 14 }}>
    <input name="categoryId" type="hidden" value={category.id} /><input name="operationId" type="hidden" value="" />
    <strong>{category.name} <code>{category.code}</code></strong>
    <div className="admin-form-grid">
      <label className="col" style={{ gap: 5 }}>ERP 코드<input className="admin-field-control" defaultValue={mapping?.erpCode ?? ''} name="erpCode" required /></label>
      <label className="col" style={{ gap: 5 }}>ERP 품명<input className="admin-field-control" defaultValue={mapping?.erpName ?? ''} name="erpName" required /></label>
      <label className="col" style={{ gap: 5 }}>출처<input className="admin-field-control" defaultValue={mapping?.source ?? ''} name="source" placeholder="ERP 분류표 버전/파일" required /></label>
      <label className="col" style={{ gap: 5 }}>검증 시각<input className="admin-field-control" defaultValue={mapping?.verifiedAt ?? ''} name="verifiedAt" type="datetime-local" required /></label>
    </div>
    {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.form}</p> : null}
    {state.message ? <p role="status" style={{ color: 'var(--mint)', margin: 0 }}>{state.message}</p> : null}
    <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '저장 중' : 'ERP 매핑 저장'}</button>
  </form>;
}

function ActivationForm({ activation }: { activation: AdminCategoryActivation }) {
  const [state, action, pending] = useActionState(setAdminCategoryActivationAction, EMPTY);
  return <form action={action} className="card col" style={{ gap: 10, padding: 14 }}>
    <input name="operationId" type="hidden" value="" />
    <label><input defaultChecked={activation.customerEnabled} name="customerEnabled" type="checkbox" /> 고객 category 필터·검색 활성화</label>
    <label><input defaultChecked={activation.erpEnabled} name="erpEnabled" type="checkbox" /> ERP mapping 조회·export 활성화</label>
    <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>현재 상태: {categoryActivationLabel(activation)}. 실제 이름·코드·유효 tree와 운영 확인 근거가 없으면 활성화가 거절됩니다.</p>
    <div className="admin-form-grid">
      <label className="col" style={{ gap: 5 }}>고객 분류 근거 출처<input className="admin-field-control" defaultValue={activation.customerEvidence?.source ?? ''} name="customerEvidenceSource" /></label>
      <label className="col" style={{ gap: 5 }}>고객 분류 근거 참조<input className="admin-field-control" defaultValue={activation.customerEvidence?.reference ?? ''} name="customerEvidenceReference" /></label>
      <label className="col" style={{ gap: 5 }}>고객 분류 검증 시각<input className="admin-field-control" defaultValue={activation.customerEvidence?.verifiedAt ?? ''} name="customerEvidenceVerifiedAt" type="datetime-local" /></label>
      <label className="col" style={{ gap: 5 }}>ERP 근거 출처<input className="admin-field-control" defaultValue={activation.erpEvidence?.source ?? ''} name="erpEvidenceSource" /></label>
      <label className="col" style={{ gap: 5 }}>ERP 근거 참조<input className="admin-field-control" defaultValue={activation.erpEvidence?.reference ?? ''} name="erpEvidenceReference" /></label>
      <label className="col" style={{ gap: 5 }}>ERP 검증 시각<input className="admin-field-control" defaultValue={activation.erpEvidence?.verifiedAt ?? ''} name="erpEvidenceVerifiedAt" type="datetime-local" /></label>
    </div>
    {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.form}</p> : null}
    {state.message ? <p role="status" style={{ color: 'var(--mint)', margin: 0 }}>{state.message}</p> : null}
    <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '저장 중' : '활성화 상태 저장'}</button>
  </form>;
}

function MigrationForm({ types, categories }: { types: string[]; categories: AdminCategoryNode[] }) {
  const [state, action, pending] = useActionState(saveAdminCategoryTypeMigrationAction, EMPTY);
  return <form action={action} className="card col" style={{ gap: 8, padding: 14 }}>
    <input name="operationId" type="hidden" value="" />
    <label className="col" style={{ gap: 5 }}>기존 type<select className="admin-field-control" name="type"><option value="">선택</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
    <label className="col" style={{ gap: 5 }}>제안 category<select className="admin-field-control" name="categoryId"><option value="">미설정</option>{categories.filter((category) => !category.archivedAt && category.childCount === 0).map((category) => <option key={category.id} value={category.id}>{category.name} ({category.code})</option>)}</select></label>
    <label className="col" style={{ gap: 5 }}>상태<select className="admin-field-control" defaultValue="suggested" name="status"><option value="suggested">제안</option><option value="confirmed">운영 확인</option><option value="rejected">보류</option></select></label>
    <label className="col" style={{ gap: 5 }}>메모<textarea className="admin-field-control" name="note" rows={2} /></label>
    {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.form}</p> : null}
    <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '저장 중' : '이관 메모 저장'}</button>
  </form>;
}

function AssignmentForm({ categories }: { categories: AdminCategoryNode[] }) {
  const [state, action, pending] = useActionState(assignAdminGoodCategoryAction, EMPTY);
  return <form action={action} className="card col" style={{ gap: 10, padding: 14 }}>
    <input name="operationId" type="hidden" value="" />
    <input name="expectedUpdatedAt" type="hidden" value="" />
    <label className="col" style={{ gap: 5 }}>굿즈 ID<input className="admin-field-control" name="goodId" placeholder="goods-id" required /></label>
    <CategoryAssignmentField categories={categories} error={state.errors?.categoryId} />
    {state.errors?.form ? <p role="alert" style={{ color: 'var(--pink)', margin: 0 }}>{state.errors.form}</p> : null}
    {state.message ? <p role="status" style={{ color: 'var(--mint)', margin: 0 }}>{state.message}</p> : null}
    <button className="wc-admin-kit__button" disabled={pending} type="submit">{pending ? '저장 중' : '상품 편집에서 적용'}</button>
  </form>;
}

export function CategoryScreen({ data, legacyTypes = [] }: { data: { categories: AdminCategoryNode[]; mappings: AdminCategoryErpMapping[]; migrations: AdminCategoryMigration[]; activation: AdminCategoryActivation }; legacyTypes?: string[] }) {
  const activeLeaves = data.categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const mappings = new Map(data.mappings.map((mapping) => [mapping.categoryId, mapping]));
  return <section className="wc-admin-kit">
    <AdminPageHeader title="고객 카테고리" description="최대 4단계 단일 부모 트리와 기본 말단 분류를 관리합니다. 기존 유형과 미분류 상품은 계속 유지됩니다." actions={<Link className="wc-admin-kit__button" href={categoryExportHref()}>분류·ERP CSV</Link>} />
    <AdminSectionCard title="활성화 상태"><AdminStatusBadge tone={data.activation.customerEnabled ? 'success' : 'neutral'}>{categoryActivationLabel(data.activation)}</AdminStatusBadge><ActivationForm activation={data.activation} /></AdminSectionCard>
    <div className="admin-master-detail">
      <AdminSectionCard title={`카테고리 트리 ${data.categories.length}개`}><CategoryTree categories={data.categories} /></AdminSectionCard>
      <div className="col" style={{ gap: 16 }}><AdminSectionCard title="새 카테고리"><CategoryForm categories={data.categories} /></AdminSectionCard>{data.categories.map((category) => <AdminSectionCard key={category.id} title={`${category.name} · ${category.code}`}><CategoryForm category={category} categories={data.categories} /><ArchiveForm category={category} /></AdminSectionCard>)}</div>
    </div>
    <AdminSectionCard title={`ERP 분류 매핑 ${activeLeaves.length}개 말단`}><p className="muted">실제 ERP 코드·품명·출처·검증 시각이 없는 매핑은 활성화하지 않습니다. 미매핑은 export에서 미설정으로 표시합니다.</p>{activeLeaves.map((category) => <MappingForm category={category} key={category.id} mapping={mappings.get(category.id)} />)}</AdminSectionCard>
    <AdminSectionCard title="기존 8종 이관 메모"><p className="muted">유사 이름으로 자동 이관하지 않습니다. 확인된 항목만 선택적으로 기록하며, 전체 category 기능의 활성화 조건은 아닙니다.</p><MigrationForm categories={data.categories} types={legacyTypes} />{data.migrations.length ? <ul>{data.migrations.map((migration) => <li key={migration.type}>{migration.type} · {migration.status} · {migration.categoryId ?? '미설정'}</li>)}</ul> : null}</AdminSectionCard>
    <AdminSectionCard title="굿즈 기본 카테고리 적용"><p className="muted">상품 편집 폼과 일괄 저장은 동일한 말단·미분류 계약을 사용합니다. 이 독립 action은 공유 상품 폼 통합 전에도 운영자가 한 건을 적용할 수 있습니다.</p><AssignmentForm categories={data.categories} /></AdminSectionCard>
  </section>;
}
