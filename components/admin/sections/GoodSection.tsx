'use client';

import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { GoodsShippingNoticeOption } from '@/components/admin/GoodsShippingNoticeField';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { GOODS_DESCRIPTION_MAX_LENGTH, GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { goodEditorValues, GOOD_LOCAL_DRAFT_FIELDS, type GoodNoticeDefaults } from '@/lib/admin/good-editor';
import { initialGoodsOptionRows, restoreGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { preservedFormValues } from '@/lib/admin/form-state';
import { withLocalRecoveryValues } from '@/lib/admin/local-autosave';
import { publicMediaUrl } from '@/lib/media';
import { AdminFormGrid, AdminSectionCard, AdminStatusBadge } from '../console/AdminKit';
import { GoodsClaimPolicyFields } from '../GoodsClaimPolicyFields';
import { readGoodsClaimPolicy } from '@/lib/admin/goods-claim-policy';
import { CategoryAssignmentField } from '../CategoryAssignmentField';
import { GoodsShippingNoticeField } from '../GoodsShippingNoticeField';
import type { GoodShippingPolicy } from '@/lib/fulfillment';
import { GoodsFulfillmentFields } from '../GoodsFulfillmentFields';
import { GoodsOptionEditor } from '../GoodsOptionEditor';
import { GoodsSalePolicyFields } from '../GoodsSalePolicyFields';
import { GoodsPurchaseCostsPanel } from '../GoodsPurchaseCostsPanel';
import { GoodsAdditionalPanel } from '../GoodsAdditionalPanel';
import { GoodsKcPanel } from '../GoodsKcPanel';
import { GoodsPreordersPanel } from '../GoodsPreordersPanel';
import { GoodsPricePeriodsPanel } from '../GoodsPricePeriodsPanel';
import { GoodNoticePicker } from '../GoodNoticePicker';
import { useAdminLocalAutosave } from '../useAdminLocalAutosave';
import { AdminLocalDraftNotice } from '../AdminLocalDraftNotice';
import { buildGoodPreview, goodFormValues } from '@/lib/admin/good-preview';
import { GOODS_HTML_MAX_LENGTH, sanitizeGoodsDescription } from '@/lib/goods-description';
import type { Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOOD_BADGES, GOOD_TYPES, goodDisplayBadges } from '@/lib/goods-taxonomy';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import {
  adminCatalogArchiveCounts,
  filterAdminCatalogRecords,
  formatAdminCatalogRecordLabel,
  type AdminCatalogArchiveFilter,
} from '../../../lib/admin/catalog-archive';
import { GoodDetailView } from '@/components/screens/GoodDetail';
import { ProductCard } from '@/components/wc/ProductCard';
import { VariantStockAdjustmentForm } from '../VariantStockAdjustmentForm';
import { GoodsGalleryFields } from '../GoodsGalleryFields';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { CatalogArchiveControl, CatalogArchiveFilter } from '../CatalogArchiveControls';
import { GoodVariantsPanel } from '../GoodVariantsPanel';
import { GoodIdentifierFields } from '../GoodIdentifierFields';
import { GoodClonePanel } from '../GoodClonePanel';
import { GoodPublishControls } from '../GoodPublishControls';
import { GoodWorkspaceNavigation, GoodWorkspaceErrors, GoodOptionalFields, GoodOperationSection, focusGoodWorkspaceTarget } from '../GoodWorkspace';
import { GOOD_EDITOR_SECTIONS, GOOD_PUBLISHED_LOCKS, changedGoodLockedFields } from '@/lib/admin/good-workspace';
import { goodsReadinessAnchor, type AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { ADMIN_STOCK_LABELS, ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { ActionNotice, ErrorText, Field, RecordList, SelectField, TextArea } from '../fields';


/*
 * 고시정보 입력 (#171). 항목·라벨·폼 이름은 lib/goods-notice.ts 하나에서 나온다.
 * 여기에 필드를 직접 늘리면 공개 상세페이지 표와 어긋난다.
 */
function GoodsNoticeFields({
  notice,
  state,
  required,
  locked = false,
}: {
  notice: GoodsNoticeInfo | null;
  state: AdminCatalogActionState;
  required: boolean;
  locked?: boolean;
}) {
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, margin: 0, padding: 14 }}>
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        {ADMIN_VOCABULARY.noticeInfo} (전자상거래 필수 표기)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        공개하려면 전 항목을 채워주세요. 초안에는 일부만 저장할 수 있고, 공개한 내용은 상품 상세페이지에 표시됩니다.
      </p>
      <div className="admin-form-grid">
        {GOODS_NOTICE_FIELDS.map((field) => (
          <Field
            defaultValue={notice?.[field.key] ?? ''}
            error={state.errors?.[field.formName]}
            key={field.key}
            label={`${field.label}${locked && field.formName in GOOD_PUBLISHED_LOCKS ? ' · 공개 중 잠금' : ''}`}
            readOnly={locked && field.formName in GOOD_PUBLISHED_LOCKS}
            name={field.formName}
            placeholder={field.placeholder}
            required={required}
          />
        ))}
      </div>
    </fieldset>
  );
}

/*
 * 저장 전 입력값 미리보기 (#184).
 *
 * 공개 화면 컴포넌트를 그대로 쓴다 — 따로 그리면 "실제 상세페이지와 동일하게"라는
 * 조건이 첫 수정에서 깨진다. `embedded` 가 구매 패널·위시 하트를 비활성으로 그려
 * 미리보기가 장바구니나 카탈로그를 건드리지 않게 한다.
 */
function GoodPreviewPanel({ detail, ip, shippingPolicy }: { detail: GoodDetailContent; ip: Ip | null; shippingPolicy?: GoodShippingPolicy | null }) {
  const good = detail.good;
  /* 아직 저장하지 않은 신규 굿즈는 갈 곳이 없다 — 없는 상세로 보내는 대신 목록으로 둔다. */
  const href = good.id ? `/shop/${good.id}` : '/shop';

  return (
    /* details 에 display 를 덮어쓰면 접힘이 깨지는 브라우저가 있어 기본 display 를 유지한다. */
    <details className="card" style={{ borderRadius: 10, padding: 18 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>공개 화면 미리보기</summary>
      <div className="col" style={{ gap: 14, marginTop: 14 }}>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          지금 폼에 입력된 값으로 그린 화면입니다. 저장하기 전 모습이며, 미리보기는 카탈로그를 바꾸지 않습니다.
        </p>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>굿즈샵 목록 카드</span>
          {/* wc 토큰은 .wc-root 스코프 안에서만 산다 — 어드민 표면에서도 같은 래퍼가 필요하다. */}
          <div className="wc-root" style={{ maxWidth: 280 }}>
            <ProductCard
              badges={goodDisplayBadges(good)}
              brand={ip?.title ?? null}
              compareAtPrice={good.compareAtPrice}
              href={href}
              imageBackground={good.img}
              name={good.name}
              price={good.price}
              priceMax={good.priceMax}
              soldOut={good.stock === 'soldout' || good.stockQty <= 0}
            />
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{ADMIN_VOCABULARY.goods} 상세페이지</span>
          <div className="wc-root">
            <GoodDetailView detail={detail} embedded shippingPolicy={shippingPolicy} />
          </div>
        </div>
      </div>
    </details>
  );
}

function goodFormData(values: Record<string, string>): FormData {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  return form;
}

function GoodEditor({ action, catalogIps, ipOptions, pending, selected, state, initialIpId, variants, origins, noticeDefaults, categories, shippingNoticeOptions, regionSummaries, formRef, onSubmitCapture }: {
  action: (payload: FormData) => void; catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  pending: boolean; selected: AdminGoodRecord | null; state: AdminCatalogActionState;
  initialIpId?: string; variants: AdminGoodsVariant[]; origins: FulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  categories: AdminCategoryNode[]; shippingNoticeOptions: GoodsShippingNoticeOption[]; regionSummaries: GoodShippingRegionSummary[];
  formRef: (form: HTMLFormElement | null) => void | (() => void); onSubmitCapture: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initial = goodEditorValues(selected, state, initialIpId, noticeDefaults);
  const rows = restoreGoodsOptionRows(initial.variants) ?? initialGoodsOptionRows(variants, Number(initial.price));
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initial, variants: JSON.stringify(rows) }));
  const editorRef = useRef<HTMLFormElement | null>(null);
  const baselineFingerprint = useRef<string | null>(null);
  const [dirty, setDirty] = useState(Boolean(state.values));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const errors = { ...state.errors, ...clientErrors };
  const locked = Boolean(selected?.publishedAt);
  const lockedValues = goodEditorValues(selected, {}, initialIpId, noticeDefaults);
  function fingerprint(form: HTMLFormElement) {
    return JSON.stringify(Array.from(new FormData(form).entries()).filter(([name, value]) => typeof value === 'string' && GOOD_LOCAL_DRAFT_FIELDS.includes(name)).sort(([a], [b]) => a.localeCompare(b)));
  }
  const attachForm = useCallback((form: HTMLFormElement | null) => {
    editorRef.current = form;
    if (!form) return;
    if (baselineFingerprint.current === null) baselineFingerprint.current = fingerprint(form);
    const cleanup = formRef(form);
    const capture = () => {
      setValues(goodFormValues(new FormData(form)));
      setDirty(Boolean(state.values) || fingerprint(form) !== baselineFingerprint.current);
    };
    const observer = new MutationObserver((changes) => {
      if (changes.some(({ target }) => target instanceof HTMLInputElement && target.type === 'hidden')) capture();
    });
    observer.observe(form, { attributes: true, attributeFilter: ['value'], subtree: true });
    return () => { observer.disconnect(); if (typeof cleanup === 'function') cleanup(); };
  }, [formRef, state.values]);
  useEffect(() => {
    if (!dirty || pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);
  const [suggestedCode, setSuggestedCode] = useState(selected?.code ?? '');
  const syncOptions = useCallback((options: GoodsOptionRow[]) => setValues((current) => ({ ...current, variants: JSON.stringify(options) })), []);
  const imageUrl = (name: string, savedPath?: string | null, savedUrl?: string | null) => initial[name] === (savedPath ?? '') ? savedUrl ?? null : publicMediaUrl(initial[name]);
  const [imageUrls, setImageUrls] = useState<Record<string, string | null>>(() => ({
    imagePath: imageUrl('imagePath', selected?.imagePath, selected?.imageUrl),
    detailImagePath: imageUrl('detailImagePath', selected?.detailImagePath, selected?.detailImageUrl),
    ...Object.fromEntries(Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => [`galleryPath${i}`, imageUrl(`galleryPath${i}`, selected?.galleryPaths[i], selected?.galleryUrls[i])])),
  }));
  let baseline = variants.filter((v) => !v.archivedAt).map((v) => v.id);
  try { if (initial.variantBaseline) baseline = JSON.parse(initial.variantBaseline); } catch { /* server validation reports malformed input */ }
  function syncValues(event: FormEvent<HTMLFormElement>) {
    setValues(goodFormValues(new FormData(event.currentTarget)));
    setDirty(Boolean(state.values) || fingerprint(event.currentTarget) !== baselineFingerprint.current);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending) { event.preventDefault(); return; }
    const changes = locked ? changedGoodLockedFields(lockedValues, goodFormValues(new FormData(event.currentTarget))) : [];
    if (changes.length) {
      event.preventDefault(); setClientErrors(Object.fromEntries(changes));
      focusGoodWorkspaceTarget('good-section-basic'); return;
    }
    setClientErrors({}); onSubmitCapture(event);
  }
  function showInvalidFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = Array.from(event.currentTarget.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.willValidate && !element.validity.valid);
    setClientErrors(Object.fromEntries(invalid.map((input) => {
      const artworkName = input.closest('.wc-admin-artwork-upload-field')?.querySelector<HTMLInputElement>('input[type="hidden"][name]')?.name;
      const name = input.name || artworkName || (input.closest('.admin-option-editor') ? 'variants' : 'form');
      return [name, input.validity.customError ? input.validationMessage : `${input.labels?.[0]?.textContent?.trim() || name} 입력값을 확인해주세요. ${input.validationMessage}`];
    })));
    for (const input of invalid) {
      for (let ancestor: HTMLElement | null = input.parentElement; ancestor && ancestor !== event.currentTarget; ancestor = ancestor.parentElement) {
        if (ancestor.hidden) ancestor.hidden = false;
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
    }
    invalid[0]?.scrollIntoView({ block: 'center', behavior: 'instant' });
    invalid[0]?.focus({ preventScroll: true });
  }
  function insertDescription(fragment?: string) {
    const form = editorRef.current;
    const input = form?.elements.namedItem('description');
    if (!form || !(input instanceof HTMLTextAreaElement)) return;
    if (fragment === undefined) {
      const data = new FormData(form);
      const path = String(data.get('descriptionUploadPath') ?? '');
      const alt = String(data.get('descriptionImageAlt') ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      fragment = sanitizeGoodsDescription(`<img src="${path}" alt="${alt}">`).html;
      if (!fragment) return;
    }
    input.setRangeText(fragment, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setValues(goodFormValues(new FormData(form)));
    input.focus();
  }
  function setImageUrl(name: string, url: string | null) { setImageUrls((current) => ({ ...current, [name]: url })); }
  function applyNotice(notice: GoodsNoticeInfo) {
    const form = editorRef.current;
    if (!form) return;
    for (const field of GOODS_NOTICE_FIELDS) {
      const input = form.elements.namedItem(field.formName);
      if (input instanceof HTMLInputElement) { input.value = notice[field.key] ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    setValues(goodFormValues(new FormData(form)));
  }
  const previewOrigin = origins.find((origin) => origin.id === values.originId);
  const previewNotice = shippingNoticeOptions.find((option) => `${option.code}@${option.version}` === values.shippingNoticeTemplate)
    ?? (values.shippingNoticeTemplate === initial.shippingNoticeTemplate ? selected?.shippingNoticeSnapshot : null);
  const shippingPolicy: GoodShippingPolicy | null = previewOrigin ? {
    originId: previewOrigin.id, originName: previewOrigin.name, baseFee: previewOrigin.baseFee, freeThreshold: previewOrigin.freeThreshold,
    feeType: (['policy', 'free', 'individual'].includes(values.shippingFeeType) ? values.shippingFeeType : 'policy') as GoodShippingPolicy['feeType'],
    individualFee: Number(values.individualFee) || 0, returnAddress: previewOrigin.returnAddress,
    claimPolicy: readGoodsClaimPolicy(goodFormData(values)).value ?? null,
    ...(previewNotice ? { shippingNotice: previewNotice.shippingNotice, returnExchangeNotice: previewNotice.returnExchangeNotice, cs: { name: previewNotice.csName, phone: previewNotice.csPhone, email: previewNotice.csEmail } } : {}),
  } : null;
  const previewIp = catalogIps.find((ip) => ip.id === values.ipId) ?? null;
  const preview = buildGoodPreview({ fallbackBg: selected?.bg ?? null, imageUrls, ip: previewIp, stockQty: selected?.stockQty ?? 0, values });
  const compare = Number(values.compareAtPrice);
  const previewDetail: GoodDetailContent = { ...preview, good: { ...preview.good, compareAtPrice: Number.isInteger(compare) && compare > preview.good.price ? compare : null } };
  const notice = Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.key, initial[field.formName]])) as GoodsNoticeInfo;
  const htmlDescription = values.descriptionFormat === 'html';
  const descriptionWarnings = htmlDescription ? sanitizeGoodsDescription(values.description ?? '').warnings : [];
  const errorCount = (key: string) => GOOD_EDITOR_SECTIONS.find((section) => section.key === key)?.fields.filter((field) => errors[field]).length ?? 0;
  return <>
    <GoodWorkspaceNavigation />
    <form action={action} className="wc-admin-kit col admin-good-workspace__form" onChange={syncValues} onInput={syncValues} onInvalidCapture={showInvalidFields} onSubmitCapture={submit} ref={attachForm} style={{ gap: 20 }}>
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
      <input name="published" type="hidden" value={String(Boolean(selected?.publishedAt))} />
      <input name="bg" type="hidden" value={selected?.bg ?? ''} />
      <GoodWorkspaceErrors errors={errors} />
      <AdminSectionCard title="기본 정보" id="good-section-basic" requirement="초안 필수 · 상품명, 연결 IP" status={values.name?.trim() && values.ipId ? '작성 완료' : '미입력'} errorCount={errorCount('basic')} summary={`${values.name || '상품명 미입력'} · ${ipOptions.find((ip) => ip.id === values.ipId)?.title || 'IP 미선택'}${dirty ? ' · 미저장 입력' : ''}`}>
        <p><AdminStatusBadge>{selected?.archivedAt ? '보관' : selected?.publishedAt ? '공개' : '초안'}</AdminStatusBadge> · 초안은 상품명과 연결 IP만으로 저장할 수 있습니다. 공개는 유형·대표 이미지·고시정보·출고지·옵션·KC 검토를 별도로 확인합니다.</p>
        {locked && <div className="admin-good-workspace__lock"><strong>공개 중 잠금: 상품명·유형·연결 IP·제조자·제조국·소재·크기</strong><p>실제 모델과 검토 근거를 일치시키기 위한 잠금입니다. 초안으로 전환 후 수정하고 KC를 재검토해야 재공개할 수 있습니다.</p><a href="#good-operation-publish" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-publish'); }}>초안으로 전환 후 수정</a></div>}
        <div className="admin-form-grid">
          <SelectField defaultValue={initial.ipId} error={errors.ipId} label={locked ? "연결 IP · 공개 중 잠금" : "연결 IP (초안 필수)"} disabled={locked} name="ipId"><option value="">선택</option>{ipOptions.map((ip) => <option disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)} key={ip.id} value={ip.id}>{ip.archivedAt ? `[보관] ${ip.title}` : ip.title}</option>)}</SelectField>
          {locked && <input type="hidden" name="ipId" value={values.ipId} />}
          <Field readOnly={locked} defaultValue={initial.name} error={errors.name} label={`${ADMIN_VOCABULARY.goods} 이름${locked ? ' · 공개 중 잠금' : ' (초안 필수)'}`} name="name" />
          <CategoryAssignmentField categories={categories} value={initial.categoryId} error={errors.categoryId} />
          <SelectField defaultValue={initial.type} error={errors.type} label={locked ? "유형 · 공개 중 잠금" : "유형 (공개 필수)"} disabled={locked} name="type"><option value="">선택</option>{GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</SelectField>
          {locked && <input type="hidden" name="type" value={values.type} />}
          <SelectField defaultValue={initial.badge} error={errors.badge} label="배지" name="badge"><option value="">없음</option>{GOOD_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</SelectField>
          <SelectField defaultValue={initial.stock} error={errors.stock} label="운영 상태" name="stock">{Object.entries(ADMIN_STOCK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        </div>
        <p className="muted">연결 IP는 브랜드·작품, 고객용 카테고리는 쇼핑 분류, 유형은 상품의 형태를 나타냅니다.</p>
        {values.ipId && <a href={`/admin/catalog/ips/${encodeURIComponent(values.ipId)}`} target="_blank" rel="noreferrer">연결 IP의 공개 상태 확인 (새 탭)</a>}
        <GoodOptionalFields title="추가 정보 · 검색·진열·식별자" summary={`${values.nameEn || '영문명 없음'} · 진열 ${values.displayOrder || '기본'} · ${values.code || suggestedCode || '상품코드 자동 생성'} · ${values.id || 'URL 자동 생성'}`} hasErrors={['nameEn', 'displayOrder', 'searchKeywords', 'code', 'id', 'defaultVariantCode'].some((key) => Boolean(errors[key]))}>
        <AdminFormGrid>          <Field defaultValue={initial.nameEn} error={errors.nameEn} label="영문 상품명 (선택)" name="nameEn" maxLength={200} />
          <Field defaultValue={initial.displayOrder} error={errors.displayOrder} label="진열 순서 (선택)" name="displayOrder" min={0} type="number" />
        </AdminFormGrid>
        <TextArea
          defaultValue={initial.searchKeywords}
          error={errors.searchKeywords}
          label="검색 키워드 (선택)"
          maxLength={4200}
          name="searchKeywords"
          placeholder="한 줄에 하나 또는 쉼표로 구분해 입력해주세요."
        />
        <p className="muted">고객 통합 검색과 어드민 상품 검색에만 쓰이며, 공개 상세에는 표시하지 않습니다.</p>
        <GoodIdentifierFields code={initial.code} defaultVariantCode={initial.defaultVariantCode ?? variants.find((v) => v.isDefault)?.code} hideVariantCode onCodeSuggestion={setSuggestedCode} errors={state.errors ?? {}} ipId={values.ipId} name={values.name} slug={initial.id} slugLocked={Boolean(selected?.firstPublishedAt)} />
        </GoodOptionalFields>
      </AdminSectionCard>
      <AdminSectionCard title="이미지와 상세 설명" requirement="대표 이미지 · 공개 필수 / 갤러리·설명 · 선택" status={values.imagePath ? '대표 이미지 있음' : '대표 이미지 미입력'} summary={`갤러리 ${Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => values[`galleryPath${i}`]).filter(Boolean).length}장 · ${values.description ? '상세 설명 작성됨' : '상세 설명 없음'}`} >
        <ArtworkUploadField compact showPath={false} showGuidance={false} ariaDescribedBy="goods-gallery-upload-guidance" autoUpload currentPath={initial.imagePath || null} currentUrl={imageUrls.imagePath} fieldId="good-main" helpText="파일을 선택하면 바로 업로드됩니다. 상품 저장 후 공개 화면에 적용됩니다." kind="good" label="대표 이미지" onPreviewChange={(url) => setImageUrl('imagePath', url)} />
        <ErrorText>{errors.imagePath}</ErrorText>
        <GoodOptionalFields title="상세 설명 편집" summary={`${values.descriptionFormat === 'html' ? 'HTML' : '일반 텍스트'} · ${values.description?.length || 0}자`} hasErrors={Boolean(errors.description || errors.descriptionFormat)}>
        <SelectField defaultValue={initial.descriptionFormat} error={errors.descriptionFormat} label="상세 설명 형식" name="descriptionFormat"><option value="plain">일반 텍스트</option><option value="html">HTML 문서</option></SelectField>
        <p className="muted">형식을 바꿔도 입력 원문은 유지됩니다. 일반 텍스트에서는 태그도 글자로 표시됩니다.</p>
        <div className="admin-goods-html-tools" hidden={!htmlDescription}>
          <p>제목·문단·목록·표·강조·링크와 업로드한 이미지를 지원합니다. 사이트 기본 서식으로 표시되며 CSS·스크립트·이벤트는 제거됩니다.</p>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => insertDescription('<h2>제목</h2>\n')} type="button">제목 넣기</button>
            <button className="btn btn-ghost" onClick={() => insertDescription('<p>문단 내용</p>\n')} type="button">문단 넣기</button>
            <button className="btn btn-ghost" onClick={() => insertDescription('<ul><li>항목</li></ul>\n')} type="button">목록 넣기</button>
            <button className="btn btn-ghost" onClick={() => insertDescription('<table><caption>표 제목</caption><tbody><tr><th scope="row">항목</th><td>내용</td></tr></tbody></table>\n')} type="button">표 넣기</button>
          </div>
        </div>
        <TextArea defaultValue={initial.description} error={errors.description} label={htmlDescription ? '상세 설명 HTML (정리된 코드 포함 최대 30,000자)' : '상세 설명 (최대 2,000자)'} maxLength={htmlDescription ? GOODS_HTML_MAX_LENGTH : GOODS_DESCRIPTION_MAX_LENGTH} name="description" placeholder={htmlDescription ? '<h2>상품 특징</h2><p>상세 내용을 입력해주세요.</p>' : adminGoodsCopy('굿즈 구성과 특징을 짧게 설명해주세요.')} />
        {descriptionWarnings.length > 0 && <div className="admin-goods-html-review" role="status"><p>저장 전 확인: 입력 원문은 편집기에 남아 있으며 아래 미리보기의 결과가 저장됩니다.</p><ul>{descriptionWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        <fieldset className="admin-goods-html-tools" disabled={!htmlDescription} hidden={!htmlDescription}>
          <ArtworkUploadField showGuidance={false} ariaDescribedBy="goods-gallery-upload-guidance" autoUpload allowRemove currentPath={initial.descriptionUploadPath || null} currentUrl={initial.descriptionUploadPath ? publicMediaUrl(initial.descriptionUploadPath) : null} fieldId="good-description-image" helpText="이미지 검증이 끝나면 대체 설명을 적고 설명에 넣기를 누릅니다. HTML 본문에는 최대 20장을 넣을 수 있습니다." kind="good" label="HTML 이미지 업로드" name="descriptionUploadPath" />
          <Field defaultValue={initial.descriptionImageAlt} label="HTML 이미지 대체 설명" name="descriptionImageAlt" maxLength={300} />
          <button className="btn btn-ghost" onClick={() => insertDescription()} type="button">업로드한 이미지를 설명에 넣기</button>
          <p className="muted">외부 이미지 URL은 표시되지 않습니다. 이미지 파일을 업로드한 후 넣어주세요. 아래 상품 미리보기에서 공개될 결과를 확인할 수 있습니다.</p>
        </fieldset>
        </GoodOptionalFields>
        <GoodsGalleryFields galleryPaths={Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => values[`galleryPath${i}`])} galleryUrls={Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => imageUrls[`galleryPath${i}`] ?? '')} onPreviewChange={setImageUrl} state={state} />
        <GoodOptionalFields title="긴 상세 이미지 (선택)" summary={values.detailImagePath ? '이미지 연결됨' : '이미지 없음'} hasErrors={Boolean(errors.detailImagePath)}>
        <ArtworkUploadField compact showPath={false} showGuidance={false} showCropGuide={false} autoUpload allowRemove currentPath={initial.detailImagePath || null} currentUrl={imageUrls.detailImagePath} fieldId="good-detail" helpText="상세페이지 아래에 원래 비율로 길게 표시되는 이미지 1장입니다." kind="good" label="상세 이미지" name="detailImagePath" onPreviewChange={(url) => setImageUrl('detailImagePath', url)} />
        <ErrorText>{errors.detailImagePath}</ErrorText>
        </GoodOptionalFields>
      </AdminSectionCard>
      <AdminSectionCard title="가격" id="good-section-price" requirement="기준가 + 옵션 추가금액" status="입력값 확인" errorCount={errorCount('price')} summary={`기준 판매가 ${Number(values.price || 0).toLocaleString('ko-KR')}원${dirty ? ' · 미저장 입력' : ''}`}>
        <p>옵션 판매가는 기준 판매가에 옵션별 추가금액을 더한 금액입니다. 고객은 선택한 옵션 판매가로 구매합니다.</p>
        <AdminFormGrid>
          <Field defaultValue={initial.price} error={errors.price} label="기준 판매가" name="price" min={0} type="number" />
          <Field defaultValue={initial.compareAtPrice} error={errors.compareAtPrice} label="소비자가 (비교용, 선택)" name="compareAtPrice" min={0} type="number" />
        </AdminFormGrid>
        <p className="muted">소비자가는 할인 표시를 위한 비교 금액입니다. 비워두면 할인율을 표시하지 않습니다.</p>
      </AdminSectionCard>
      <AdminSectionCard title="옵션과 재고" id="good-section-variants" requirement="공개 필수 · 기본 옵션 1개부터" status="옵션 확인" errorCount={errorCount('variants')} summary="할당 재고는 ICONS 판매 수량입니다. 안전재고 기준은 경보이며 판매 수량에서 차감하지 않습니다."><GoodsOptionEditor onRowsChange={syncOptions} codePrefix={values.code || suggestedCode} initialRows={rows} baseline={baseline} basePrice={Number(values.price) || 0} error={errors.variants} axisValues={initial} /></AdminSectionCard>
      <AdminSectionCard title={ADMIN_VOCABULARY.noticeInfo} id="good-section-notice" requirement="공개 필수 · 초안에는 일부 저장 가능" status={GOODS_NOTICE_FIELDS.every((field) => values[field.formName]?.trim()) ? '입력 완료 · KC 별도 검토' : '미입력'} errorCount={errorCount('notice')} summary={`${GOODS_NOTICE_FIELDS.filter((field) => values[field.formName]?.trim()).length}/${GOODS_NOTICE_FIELDS.length}개 작성 · KC는 저장 후 검토`}>
        <GoodNoticePicker onApply={applyNotice} /><GoodsNoticeFields notice={notice} required={Boolean(selected?.publishedAt)} locked={locked} state={{ ...state, errors }} />
        <p>{selected ? <a href="#good-operation-kc" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-kc'); }}>KC 검토 영역 열기</a> : '초안 저장 후 실제 상품에 KC 자료를 연결하고 검토할 수 있습니다.'}</p>
      </AdminSectionCard>
      <AdminSectionCard title="배송 정보" id="good-section-shipping" requirement="출고지 · 공개 필수" status={values.originId ? '출고지 선택됨' : '미입력'} errorCount={errorCount('shipping')} summary={`${previewOrigin?.name || '출고지 확인 필요'} · ${values.shippingFeeType === 'policy' ? '출고지 정책' : values.shippingFeeType === 'free' ? '무료배송' : '개별 배송비'}`}><GoodsFulfillmentFields regionSummaries={regionSummaries} origins={origins} value={{ originId: initial.originId || null, shippingFeeType: initial.shippingFeeType as 'policy' | 'free' | 'individual', individualFee: Number(initial.individualFee) }} errors={errors} /><GoodsShippingNoticeField options={shippingNoticeOptions} value={initial.shippingNoticeTemplate} error={errors.shippingNoticeTemplate} /></AdminSectionCard>
      <GoodsClaimPolicyFields values={initial} errors={errors} />
      <GoodsSalePolicyFields values={initial} errors={errors} />
      <div className="admin-good-workspace__save" aria-label="기본 상품 저장">
        <div><strong role="status">{pending ? '저장 중…' : Object.keys(errors).length ? '저장 실패 · 입력값 유지' : dirty ? '미저장 변경 있음' : state.message ? '기본 상품 저장 완료' : selected ? '서버 저장값과 동일' : '새 초안 · 아직 저장 전'}</strong>
          <p>기본 상품·이미지·옵션·고시·배송·판매 조건만 저장합니다. KC·재고 조정·혜택은 각 영역에서 별도 저장합니다.</p>
          {dirty && <p>브라우저 복구 기록은 서버 저장이 아닙니다.</p>}
          {selected?.publishedAt && <p>저장하면 공개 중인 상품 화면에 반영됩니다.</p>}
        </div>
        <div className="row"><button className="btn btn-holo" disabled={pending || Boolean(selected?.archivedAt)} name="intent" value="save">{pending ? '저장 중…' : selected?.publishedAt ? '기본 상품 저장' : '초안으로 저장'}</button>{selected && !selected.publishedAt && !selected.archivedAt && <button className="btn btn-ghost" disabled={pending} name="intent" value="publish">저장 후 공개</button>}</div>
        {!selected && <p>1. 초안 생성 → 2. KC 검토 → 3. 공개 요청</p>}
        <ActionNotice state={state} />
      </div>
    </form>
    <GoodPreviewPanel detail={previewDetail} ip={previewIp} shippingPolicy={shippingPolicy} />
  </>;
}

export function GoodSection({
  action,
  adjustmentId,
  catalogIps,
  ipOptions,
  onSelect,
  pending,
  records,
  selected,
  state,
  variants = [],
  initialIpId,
  initialQuery='',
  hideRecordList=false,
  accountId='', origins=[], noticeDefaults, categories=[], shippingNoticeOptions=[], canManageCosts=false, cloneOperationId, readiness, regionSummaries = [],
}: {
  action: (payload: FormData) => void;
  adjustmentId: string;
  catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onSelect: (good: AdminGoodRecord | null) => void;
  pending: boolean;
  records: AdminGoodRecord[];
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
  variants?: AdminGoodsVariant[];
  initialIpId?: string;
  initialQuery?: string;
  hideRecordList?: boolean;
  accountId?: string; origins?: FulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  categories?: AdminCategoryNode[]; shippingNoticeOptions?: GoodsShippingNoticeOption[]; canManageCosts?: boolean; cloneOperationId?: string; readiness?: AdminGoodsReadiness | null; regionSummaries?: GoodShippingRegionSummary[];
}) {
  const [archiveFilter, setArchiveFilter] = useState<AdminCatalogArchiveFilter>(
    selected?.archivedAt ? 'archived' : 'active',
  );
  const local = useAdminLocalAutosave({ scope: { accountId, formId: 'good', recordId: selected?.id ?? null }, fields: GOOD_LOCAL_DRAFT_FIELDS, serverState: state });
  const inputState = withLocalRecoveryValues(state, selected?.id ?? null, local.snapshot.restoredValues);
  const [query,setQuery]=useState(initialQuery);
  const normalizedQuery=query.trim().toLocaleLowerCase();
  const visibleRecords = filterAdminCatalogRecords(records, archiveFilter).filter((good)=>!normalizedQuery
    || `${good.name} ${good.code} ${(good.searchKeywords ?? []).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery)
    || variants.some((variant)=>variant.goodId===good.id && `${variant.code} ${variant.erpCode ?? ''} ${variant.erpName ?? ''} ${variant.barcode ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)));

  return (
    <div className={hideRecordList?'col':'admin-master-detail'}>
      {!hideRecordList && <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <label className="col" style={{gap:7}}>
          <span>{ADMIN_VOCABULARY.goods}명·{ADMIN_VOCABULARY.goodsCode}·ERP 코드·ERP 품명·바코드·검색 키워드</span>
          <input className="admin-field-control" onChange={(event)=>setQuery(event.target.value)} placeholder={`${ADMIN_VOCABULARY.goods}명·${ADMIN_VOCABULARY.goodsCode}·검색 키워드`} type="search" value={query}/>
        </label>
        <CatalogArchiveFilter
          counts={adminCatalogArchiveCounts(records)}
          filter={archiveFilter}
          onChange={(filter) => {
            setArchiveFilter(filter);
            if (selected && !filterAdminCatalogRecords([selected], filter).length) onSelect(null);
          }}
        />
        <RecordList
          activeId={selected?.id ?? null}
          items={visibleRecords}
          emptyMessage="일치하는 상품이 없습니다."
          labelFor={(good) => formatAdminCatalogRecordLabel(
            `${good.code} · ${good.name} · ${good.stockQty}개`,
            good.archivedAt,
          )}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
          thumbnailKind="good"
          thumbnailUrlFor={(good) => good.imageUrl}
        />
      </div>}
      <div className="col" style={{ gap: 16, minWidth: 0 }}>
        <AdminLocalDraftNotice onDiscard={local.discard} onRestore={local.restore} pending={pending} recovery={Boolean(local.snapshot.recovery) && !preservedFormValues(state, selected?.id)} unavailable={local.snapshot.unavailable} />
        {selected && <section aria-label="서버 판매 준비 상태" className="admin-good-workspace__readiness">
          <h3>저장된 상품의 판매 준비</h3>
          <p>게시·판매 설정·KC 검토는 별도 조건입니다. 이 요약은 결제사 승인이나 실제 구매 성공을 보증하지 않습니다.</p>
          {readiness ? <><div className="admin-good-workspace__states">
            <AdminStatusBadge>게시 · {{ draft: '초안', published: '공개', archived: '보관', unknown: '확인 필요' }[readiness.publication]}</AdminStatusBadge>
            <AdminStatusBadge>운영 · {{ active: '정상', stopped: '판매 중지', unknown: '확인 필요' }[readiness.operation]}</AdminStatusBadge>
            <AdminStatusBadge tone={readiness.saleSettings === 'ready' ? 'success' : 'warning'}>판매 설정 · {readiness.saleSettings === 'ready' ? '준비 완료' : '확인 필요'}</AdminStatusBadge>
            <AdminStatusBadge>공개 검토 · {{ current: 'KC 검토 완료', required: 'KC 검토 필요', legacy_unrecorded: '기존 공개 · KC 미기록', unknown: '확인 필요' }[readiness.publicReview]}</AdminStatusBadge>
            <span>가용 할당 재고 {readiness.availableQty === null ? '확인 필요' : `${readiness.availableQty.toLocaleString('ko-KR')}개`}</span>
          </div>
            <ul>{readiness.reasons.map((reason) => <li key={reason.code}><a href={`#${goodsReadinessAnchor(reason.target)}`} onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget(goodsReadinessAnchor(reason.target)); }}>{reason.label}</a> · {reason.detail}</li>)}</ul>
            <small>확인 시각 {readiness.checkedAt ? new Date(readiness.checkedAt).toLocaleString('ko-KR') : '확인 필요'} · 미저장 입력은 판정에 포함되지 않습니다.</small></> : <p>판매 준비 정보를 확인하지 못했습니다. 다시 불러와 확인해주세요.</p>}
        </section>}
        <GoodEditor
          regionSummaries={regionSummaries} origins={origins} noticeDefaults={noticeDefaults} categories={categories} shippingNoticeOptions={shippingNoticeOptions} formRef={local.formRef} onSubmitCapture={local.onSubmitCapture}
          variants={variants.filter((variant) => variant.goodId === selected?.id)}
          action={action}
          catalogIps={catalogIps}
          ipOptions={ipOptions}
          key={`${local.scopeKey}:${state.attempt ?? 0}:${local.snapshot.revision}`}
          pending={pending}
          selected={selected}
          state={inputState}
          initialIpId={initialIpId}
        />
        {selected && !selected.archivedAt && (
          <GoodOperationSection id="stock" title="할당 재고 조정" description="대상 옵션·변경 수량·사유를 확인해 재고 조정만 즉시 반영합니다." ><VariantStockAdjustmentForm adjustmentId={adjustmentId} good={selected} variants={variants} key={`stock-${selected.id}`} /></GoodOperationSection>
        )}
        {selected && <GoodOperationSection id="publish" title="게시 상태 · 공개·초안 전환" description="현재 서버 저장값으로 게시 상태만 전환합니다."><GoodPublishControls id={selected.id} publishedAt={selected.publishedAt} archivedAt={selected.archivedAt} key={`publish-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`}/></GoodOperationSection>}
        {selected && <GoodOperationSection id="variants" title="옵션 사용·보관" description="옵션 사용 상태만 별도로 반영합니다."><GoodVariantsPanel goodId={selected.id} variants={variants} basePrice={selected.price} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="kc" title="KC 자료·검토" description="모델과 근거·적용 옵션을 검토하고 KC만 저장합니다."><GoodsKcPanel goodId={selected.id} key={`kc-${selected.id}-${selected.publishedAt}-${selected.archivedAt}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && canManageCosts && <GoodOperationSection id="costs" title="매입단가" description="권한이 있는 관리자만 매입단가를 저장합니다."><GoodsPurchaseCostsPanel goodId={selected.id} variants={variants} key={`costs-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="additional" title="추가 구성 상품" description="추가 구성 연결만 저장합니다."><GoodsAdditionalPanel goodId={selected.id} key={`additional-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="prices" title="기간 할인" description="기간과 옵션별 할인 설정만 저장합니다."><GoodsPricePeriodsPanel goodId={selected.id} variants={variants} key={`prices-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && <GoodOperationSection id="preorders" title="예약판매" description="예약판매 설정과 물량을 별도로 저장합니다."><GoodsPreordersPanel goodId={selected.id} variants={variants} canActivate={canManageCosts} key={`preorders-${selected.id}`} /></GoodOperationSection>}
        {selected && !selected.archivedAt && cloneOperationId && <GoodOperationSection id="clone" title="상품 복사" description="서버에 저장된 상품으로 새로운 초안을 만듭니다."><GoodClonePanel operationId={cloneOperationId} goodId={selected.id} goodName={selected.name} goodCode={selected.code} key={`clone-${selected.id}`} /></GoodOperationSection>}
        {selected && (
          <GoodOperationSection id="archive" title="상품 보관·복원" description="게시와 보관 상태만 변경합니다."><CatalogArchiveControl
            archivedAt={selected.archivedAt}
            id={selected.id}
            key={`${selected.id}:${selected.archivedAt ?? 'active'}`}
            kind="good"
          /></GoodOperationSection>
        )}
      </div>
    </div>
  );
}
