'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { saveGoodsGroupCommonAction } from '@/app/admin/goods-group-common-actions';
import { goodsGroupCommonHref, goodsGroupHref, normalizeGoodsGroupCommonForm, type GoodsGroupCommonSnapshot } from '@/lib/admin/goods-group-common';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { GOOD_TYPES } from '@/lib/goods-taxonomy';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import { EMPTY_GOODS_AFTER_SALES, type GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { parseGoodsSizeChart } from '@/lib/goods-size-chart';
import { GOODS_HTML_MAX_LENGTH, sanitizeGoodsDescription } from '@/lib/goods-description';
import { goodsAttributeSubmissionReady } from '@/lib/admin/goods-attributes';
import { GroupCompleted, GroupOperationStatus, useGoodsGroupOperation, useGoodsGroupSession, GROUP_BUTTON, GROUP_PRIMARY } from './GoodsGroupOperation';
import { AdminSectionCard } from './console/AdminKit';
import { Field, SelectField, TextArea } from './fields';
import { CategoryAssignmentField } from './CategoryAssignmentField';
import { GoodsAttributeEditor } from './GoodsAttributeEditor';
import { GoodNoticePicker } from './GoodNoticePicker';
import { GoodsOriginField } from './CountryNameFinder';
import { GoodsAfterSalesFields } from './GoodsAfterSalesFields';
import { GoodsAfterSalesTemplatePicker } from './screens/GoodsAfterSalesTemplatesScreen';
import { GoodsSizeChartFields } from './GoodsSizeChartFields';
import { GoodsSizeTemplatePicker } from './screens/GoodsSizeTemplatesScreen';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { GoodsDescriptionTools } from './GoodsDescriptionTools';
import { ArtworkUploadField } from './ArtworkUploadField';

export function GoodsGroupCommonEditor({ snapshot: initialSnapshot, actorId, sessionId, categories, ips }: {
  snapshot: GoodsGroupCommonSnapshot; actorId: string; sessionId: string | null; categories: AdminCategoryNode[];
  ips: { id: string; title: string; archivedAt: string | null }[];
}) {
  // Revalidation must preserve the receipt and the version this draft started
  // from. A fresh server snapshot cannot silently rebase unsaved form fields.
  const [snapshot] = useState(initialSnapshot);
  const session = useGoodsGroupSession(actorId, sessionId), identity = sessionId ? { actorId, sessionId } : null;
  const operation = useGoodsGroupOperation(identity, `common:${snapshot.group.id}`, session.current, session.deny);
  const [categoryId, setCategoryId] = useState(snapshot.fields.categoryId), [attributes, setAttributes] = useState('');
  const [afterSales, setAfterSales] = useState<GoodsAfterSalesValues>(snapshot.afterSales), [sizeChart, setSizeChart] = useState(snapshot.sizeChart.values);
  const [afterSalesEnabled, setAfterSalesEnabled] = useState(Boolean(snapshot.afterSales.phone || snapshot.afterSales.guide || snapshot.afterSales.sellerSpecialNotes));
  const [asTemplates, setAsTemplates] = useState(false), [sizeTemplates, setSizeTemplates] = useState(false);
  const [format, setFormat] = useState(snapshot.fields.descriptionFormat), [description, setDescription] = useState(snapshot.fields.description);
  const [errors, setErrors] = useState<Record<string,string>>({}), [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const locked = session.blocked || operation.locked || operation.receipt !== null;
  const ready = goodsAttributeSubmissionReady(attributes, categoryId);
  const onAttributes = useCallback((submission: string, _draft: string, initialize: boolean) => { setAttributes(submission); if (!initialize) setDirty(true); }, []);
  function leave(event: { preventDefault: () => void }) {
    if (operation.pending) event.preventDefault();
  }
  useEffect(() => {
    if ((!dirty || operation.receipt) && !operation.pending) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (operation.pending || !window.confirm('저장하지 않은 공통정보 입력을 두고 이동할까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', prevent); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', prevent); document.removeEventListener('click', navigate, true); };
  }, [dirty, operation.receipt, operation.pending]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || !identity || !ready) return;
    const form = new FormData(event.currentTarget), normalized = normalizeGoodsGroupCommonForm(form);
    if (!normalized.ok) { setErrors(normalized.errors); return; }
    setErrors({});
    const metadata = { ...identity, version: 1 as const, command: 'common' as const, groupId: snapshot.group.id,
      expectedRevision: snapshot.group.revision, operationId: crypto.randomUUID() };
    operation.execute(metadata, () => saveGoodsGroupCommonAction(metadata, form));
  }
  function applyNotice(notice: GoodsNoticeInfo) {
    for (const field of GOODS_NOTICE_FIELDS) {
      const input = formRef.current?.elements.namedItem(field.formName);
      if (input instanceof HTMLInputElement) { input.value = notice[field.key] ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    setDirty(true);
  }
  const preview = format === 'html' ? sanitizeGoodsDescription(description) : null;
  return <div className="wc-admin-kit col">
    <AdminSectionCard title={`${snapshot.group.name} · 공통정보 편집`}>
      <p>연결된 {snapshot.group.members.length}개 상품에 아래 정보를 한 번에 적용합니다. 저장하면 모두 미공개로 전환되고 KC를 다시 검토해야 합니다.</p>
      <p>그룹명·옵션명·옵션값은 <Link href={goodsGroupHref(snapshot.group.id)} onNavigate={leave}>그룹 구성</Link>에서 수정합니다.</p>
      <p>가격·재고·상품이미지·결제 설정은 개별 상품에서 관리합니다. 입력 내용은 이 화면에만 유지되며 진행 내역에는 요청 식별 정보만 보관됩니다.</p>
    </AdminSectionCard>
    {session.blocked ? <p role="alert">로그인이 변경되었습니다. 화면을 다시 열어주세요.</p> : null}
    <GroupOperationStatus operation={operation} disabled={session.blocked} />
    {operation.receipt?.state === 'completed' ? <GroupCompleted receipt={operation.receipt}><a className={GROUP_BUTTON} href={goodsGroupCommonHref(operation.receipt.group)}>최신 공통정보 다시 열기</a></GroupCompleted>
      : operation.receipt ? <a className={GROUP_BUTTON} href={goodsGroupCommonHref(snapshot.group)}>최신 공통정보 다시 열기</a> : null}
    <form ref={formRef} onSubmit={submit} onInput={event => { setDirty(true); if (event.target instanceof HTMLTextAreaElement && event.target.name === 'description') setDescription(event.target.value); }}>
      <fieldset disabled={locked} className="col" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, gap: 18 }}>
        <legend className="wc-sr-only">그룹 공통정보 입력</legend>
        <AdminSectionCard title="카테고리·상품속성">
          <CategoryAssignmentField categories={categories} value={snapshot.fields.categoryId} primary={categoryId} onPrimaryChange={setCategoryId}
            additionalValue={snapshot.fields.additionalCategoryIds} error={errors.categoryId} additionalError={errors.additionalCategoryIds} />
          <GoodsAttributeEditor categoryId={categoryId} goodId={snapshot.group.commonGoodId} onChange={onAttributes} error={errors.productAttributes} />
        </AdminSectionCard>
        <AdminSectionCard title="연결 IP·유형·검색 설정"><div className="admin-form-grid">
          <SelectField name="ipId" label="연결 IP" defaultValue={snapshot.fields.ipId} error={errors.ipId}><option value="">선택</option>{ips.map(ip => <option key={ip.id} value={ip.id} disabled={Boolean(ip.archivedAt)}>{ip.title}</option>)}</SelectField>
          <SelectField name="type" label="상품 유형" defaultValue={snapshot.fields.type} error={errors.type}><option value="">선택</option>{GOOD_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</SelectField>
          <Field name="nameEn" label="영문 상품명" defaultValue={snapshot.fields.nameEn} maxLength={200} error={errors.nameEn} />
        </div><TextArea name="searchKeywords" label="검색 키워드" defaultValue={snapshot.fields.searchKeywords} maxLength={4200} error={errors.searchKeywords} /></AdminSectionCard>
        <AdminSectionCard title="상품정보고시"><GoodNoticePicker copyKcTemplate={false} onApply={applyNotice} readOnly={locked} /><div className="admin-form-grid">
          {GOODS_NOTICE_FIELDS.map(field => field.key === 'origin' ? <GoodsOriginField key={field.key} defaultValue={snapshot.fields[field.formName]} label={field.label} error={errors[field.formName]} disabled={locked} readOnly={false} required={false} />
            : <Field key={field.key} name={field.formName} label={field.label} defaultValue={snapshot.fields[field.formName]} error={errors[field.formName]} />)}
        </div></AdminSectionCard>
        <AdminSectionCard title="상세설명">
          <SelectField name="descriptionFormat" label="상세설명 형식" value={format} onChange={event => setFormat(event.target.value)}><option value="plain">일반 텍스트</option><option value="html">HTML 문서</option></SelectField>
          {format === 'html' ? <GoodsDescriptionTools accountId={actorId} formRef={formRef} disabled={locked} /> : null}
          <TextArea name="description" label="상세설명" defaultValue={snapshot.fields.description} maxLength={format === 'html' ? GOODS_HTML_MAX_LENGTH : 2000} error={errors.description} />
          {format === 'html' ? <><ArtworkUploadField autoUpload allowRemove currentPath={null} currentUrl={null} fieldId="group-description-image" kind="good" label="HTML 이미지 업로드" name="descriptionUploadPath" />
            <Field name="descriptionImageAlt" label="HTML 이미지 대체 설명" maxLength={300} />
            <button className={GROUP_BUTTON} type="button" onClick={() => {
              const form = formRef.current, input = form?.elements.namedItem('description'); if (!form || !(input instanceof HTMLTextAreaElement)) return;
              const data = new FormData(form), alt = String(data.get('descriptionImageAlt') ?? '').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
              const fragment = sanitizeGoodsDescription(`<img src="${String(data.get('descriptionUploadPath') ?? '')}" alt="${alt}">`).html;
              if (!fragment) return; input.setRangeText(fragment, input.selectionStart, input.selectionEnd, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); setDescription(input.value);
            }}>업로드한 이미지를 설명에 넣기</button></> : null}
          {preview?.warnings.length ? <ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
          <details><summary>상세설명 미리보기</summary><GoodsDescription description={description} format={format === 'html' ? 'html' : 'plain'} imagePaths={preview?.imagePaths} /></details>
        </AdminSectionCard>
        <AdminSectionCard title="A/S 안내·판매자 특이사항">
          <label><input type="checkbox" checked={afterSalesEnabled} onChange={event => { setAfterSalesEnabled(event.target.checked); setDirty(true); }} /> A/S 안내 사용</label>
          {afterSalesEnabled ? <GoodsAfterSalesFields values={afterSales} onChange={value => { setAfterSales(value); setDirty(true); }} /> : <p>설정안함으로 저장하면 모든 연결 상품의 A/S 안내와 판매자 특이사항을 비웁니다.</p>}
          <button className={GROUP_BUTTON} type="button" onClick={() => setAsTemplates(true)}>A/S 템플릿 불러오기</button>
          <input type="hidden" name="groupAfterSales" value={JSON.stringify(afterSalesEnabled ? afterSales : EMPTY_GOODS_AFTER_SALES)} />
        </AdminSectionCard>
        <AdminSectionCard title="사이즈 안내">
          <label>공개 표시<select value={String(sizeChart.enabled)} onChange={event => { setSizeChart({ ...sizeChart, enabled: event.target.value === 'true' }); setDirty(true); }}><option value="false">설정안함</option><option value="true">설정함</option></select></label>
          <p>설정안함은 작성한 표를 보존하고 공개 표시만 중지합니다.</p>
          <GoodsSizeChartFields chart={sizeChart.chart} onChange={chart => { setSizeChart({ ...sizeChart, chart }); setDirty(true); }} />
          <button className={GROUP_BUTTON} type="button" onClick={() => setSizeTemplates(true)}>사이즈 템플릿 불러오기</button>
          <input type="hidden" name="groupSizeChart" value={JSON.stringify(sizeChart)} />
          <GoodSizeChart chart={parseGoodsSizeChart(sizeChart.chart)} />
        </AdminSectionCard>
        {Object.keys(errors).length ? <ul role="alert">{Object.entries(errors).map(([key, error]) => <li key={key}>{error}</li>)}</ul> : null}
        <div className="wc-admin-kit__actions"><button className={GROUP_PRIMARY} disabled={!ready}>{operation.pending ? '저장 중…' : `연결된 ${snapshot.group.members.length}개 상품에 공통정보 적용`}</button><Link className={GROUP_BUTTON} href={goodsGroupHref(snapshot.group.id)} onNavigate={leave}>취소</Link></div>
      </fieldset>
    </form>
    {asTemplates && !locked ? <GoodsAfterSalesTemplatePicker onClose={() => setAsTemplates(false)} onSelect={template => { setAfterSales(template); setAfterSalesEnabled(true); setAsTemplates(false); setDirty(true); }} /> : null}
    {sizeTemplates && !locked ? <GoodsSizeTemplatePicker onClose={() => setSizeTemplates(false)} onSelect={template => { setSizeChart({ ...sizeChart, chart: structuredClone(template.chart) }); setSizeTemplates(false); setDirty(true); }} /> : null}
  </div>;
}
