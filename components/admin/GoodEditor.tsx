'use client';

import Link from 'next/link';

import { GROUP_COMMON_FIELDS, type GoodsEditorOwnership } from '@/lib/admin/goods-group-common';
import type { ReactNode } from 'react';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { GoodsShippingNoticeOption } from '@/components/admin/GoodsShippingNoticeField';

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { GOODS_DESCRIPTION_MAX_LENGTH, GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { GoodsSalePeriodFields } from './GoodsSalePeriodFields';
import { goodEditorValues, createGoodEditorDraft, goodEditorFingerprint, buildGoodEditorPreview, GOOD_LOCAL_DRAFT_FIELDS, type GoodNoticeDefaults } from '@/lib/admin/good-editor';
import { goodsOptionStockTotals, isSingleGoodsOption, restoreGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { formatWon, goodsPriceDraftFromValues, resolveGoodsPrice } from '@/lib/admin/goods-price-editor';
import { planErpCategorySuggestion, type ErpCategorySuggestion } from '@/lib/admin/goods-erp-suggestion';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import { preservedFormValues } from '@/lib/admin/form-state';
import { readAdminFormData } from '@/lib/admin/form-capture';
import { withLocalRecoveryValues } from '@/lib/admin/local-autosave';
import { publicMediaUrl } from '@/lib/media';
import { AdminFormGrid } from './console/AdminKit';
import { GoodsClaimPolicyFields } from './GoodsClaimPolicyFields';
import { GoodsAttributeEditor } from './GoodsAttributeEditor';
import { goodsAttributeSubmissionReady } from '@/lib/admin/goods-attributes';
import { CategoryAssignmentField } from './CategoryAssignmentField';
import { GoodsShippingNoticeField } from './GoodsShippingNoticeField';
import type { GoodShippingPolicy } from '@/lib/fulfillment';
import { GoodsFulfillmentFields } from './GoodsFulfillmentFields';
import { GoodsCustomInputEditor } from './GoodsCustomInputEditor';
import { GoodsOptionEditor } from './GoodsOptionEditor';
import { GoodsPriceFields } from './GoodsPriceFields';
import { GoodsErpCategoryNotice } from './GoodsErpCategoryNotice';
import { GoodsPurchaseLimitFields, GoodsSalePolicyFields } from './GoodsSalePolicyFields';
import { GoodNoticePicker } from './GoodNoticePicker';
import { GoodsOriginField } from './CountryNameFinder';
import type { GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';
import { useAdminLocalAutosave } from './useAdminLocalAutosave';
import { AdminLocalDraftNotice } from './AdminLocalDraftNotice';
import { goodFormValues } from '@/lib/admin/good-preview';
import { GOODS_HTML_MAX_LENGTH, goodsHtmlCleanedLengthWarning, sanitizeGoodsDescription } from '@/lib/goods-description';
import type { Ip } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOOD_BADGES, GOOD_TYPES, goodDisplayBadges } from '@/lib/goods-taxonomy';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';

import { GoodDetailView } from '@/components/screens/GoodDetail';
import { ProductCard } from '@/components/wc/ProductCard';
import { GoodsImageGrid } from './GoodsImageGrid';
import { GoodsDescriptionTools } from './GoodsDescriptionTools';
import { GOODS_IMAGE_FIELD_NAMES } from '@/lib/admin/goods-image-grid';
import { ArtworkUploadField } from './ArtworkUploadField';
import { GoodIdentifierFields } from './GoodIdentifierFields';
import { GoodsDraftLibraryDialog } from './GoodsDraftLibraryDialog';
import { saveGoodsDraftAction } from '@/app/admin/goods-draft-actions';
import { collectGoodsDraftValues, validGoodsDraftIdentity, type GoodsDraft, type GoodsDraftIdentity } from '@/lib/admin/goods-drafts';
import { GoodWorkspaceNavigation, GoodWorkspaceErrors, GoodOptionalFields, GoodEditorSection, GoodWorkspaceDetails, focusGoodWorkspaceTarget, useFocusFirstGoodError, useGoodWorkspaceSections } from './GoodWorkspace';
import { GOOD_WORKSPACE_ERROR_SECTIONS, GOOD_WORKSPACE_OPERATION_FIELD, GOOD_WORKSPACE_SECTIONS_FIELD, prepareGoodWorkspaceSections } from '@/lib/admin/good-workspace-sections';
import { GOOD_EDITOR_SECTIONS, GOOD_PUBLISHED_LOCKS, changedGoodLockedFields, goodFieldSection } from '@/lib/admin/good-workspace';
import { ADMIN_STOCK_LABELS, ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { ADMIN_SCREENS, type AdminScreen } from '@/lib/admin/navigation';
import { ActionNotice, ErrorText, Field, SelectField, TextArea } from './fields';


/*
 * 고시정보 입력 (#171). 항목·라벨·폼 이름은 lib/goods-notice.ts 하나에서 나온다.
 * 여기에 필드를 직접 늘리면 공개 상세페이지 표와 어긋난다.
 */
function GoodsNoticeFields({
  notice,
  state,
  required,
  locked = false,
  originFinderDisabled = false,
}: {
  notice: GoodsNoticeInfo | null;
  state: AdminCatalogActionState;
  required: boolean;
  locked?: boolean;
  originFinderDisabled?: boolean;
}) {
  return (
    <fieldset className="admin-goods-notice-fields" style={{ border: '1px solid var(--line)', borderRadius: 10, margin: 0, padding: 14 }}>
      <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>
        {ADMIN_VOCABULARY.noticeInfo} (전자상거래 필수 표기)
      </legend>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>
        공개하려면 전 항목을 채워주세요. 초안에는 일부만 저장할 수 있고, 공개한 내용은 상품 상세페이지에 표시됩니다.
      </p>
      <div className="admin-form-grid">
        {GOODS_NOTICE_FIELDS.map((field) => field.key === 'origin' ? <GoodsOriginField key={field.key}
          defaultValue={notice?.origin ?? ''} error={state.errors?.noticeOrigin}
          label={`${field.label}${locked ? ' · 공개 중 잠금' : ''}`} readOnly={locked} required={required} disabled={originFinderDisabled} /> : (
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
/*
 * R19: 미리보기 입력(detail·ip·배송 정책)이 그대로면 편집기의 다른 상태 변화에 다시 그리지 않는다.
 * 펼침 상태(R14)는 바깥 details가 키 밖 상태로 기억하고, 펼침이 바뀌어도 이 내용은 다시 그리지 않는다.
 */
const GoodPreviewContent = memo(function GoodPreviewContent({ detail, ip, shippingPolicy }: { detail: GoodDetailContent; ip: Ip | null; shippingPolicy?: GoodShippingPolicy | null }) {
  const good = detail.good;
  /* 아직 저장하지 않은 신규 굿즈는 갈 곳이 없다 — 없는 상세로 보내는 대신 목록으로 둔다. */
  const href = good.id ? `/shop/${good.id}` : '/shop';

  return (
      <div className="col" style={{ gap: 14, marginTop: 14 }}>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          지금 폼에 입력된 값으로 그린 화면입니다. 저장하기 전 모습이며, 미리보기는 카탈로그를 바꾸지 않습니다.
          KC 표는 마지막으로 저장해 검토를 완료한 자료만 표시합니다. 모델 관련 기본 정보·옵션을 저장해 검토가 무효화되면 KC를 다시 검토해야 합니다.
        </p>
        <div className="col" style={{ gap: 8 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>굿즈샵 목록 카드</span>
          {/* wc 토큰은 .wc-root 스코프 안에서만 산다 — 어드민 표면에서도 같은 래퍼가 필요하다. */}
          <div className="wc-root" style={{ maxWidth: 280 }}>
            <ProductCard
              badges={goodDisplayBadges(good)}
              brand={ip?.title ?? null}
              showDiscountRate={good.showDiscountRate} compareAtPrice={good.compareAtPrice}
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
  );
});

function GoodPreviewPanel(props: { detail: GoodDetailContent; ip: Ip | null; shippingPolicy?: GoodShippingPolicy | null }) {
  /* details 에 display 를 덮어쓰면 접힘이 깨지는 브라우저가 있어 기본 display 를 유지한다. */
  return <GoodWorkspaceDetails stateId="good-preview" id="good-preview" className="admin-good-preview">
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>공개 화면 미리보기</summary>
    <GoodPreviewContent {...props} />
  </GoodWorkspaceDetails>;
}

function OwnedFields({ locked, fields, values, children }: { locked: boolean; fields: readonly string[]; values: Record<string,string>; children: ReactNode }) {
  return <><fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset>
    {locked ? fields.map(name => <input key={name} type="hidden" name={name} value={values[name] ?? ''} />) : null}</>;
}
/**
 * R21(D9①): 편집기 탭의 그룹상품 등록 진입점은 메뉴 숨김(`navHidden`)과 같은 값을 따른다. 라우트·권한은 유지하므로
 * 기존 그룹은 주소로 계속 열린다. 메뉴에서 다시 보이게 하면 이 탭도 함께 돌아온다.
 */
export function groupGoodsEntryVisible(screens: readonly AdminScreen[] = ADMIN_SCREENS) {
  return screens.some((screen) => screen.id === 'goods-groups-create' && !screen.navHidden);
}
const SHARED_SHIPPING_FIELDS = ['originId','shippingFeeType','individualFee'];
const SHARED_QUANTITY_FIELDS = ['orderQuantityLimitEnabled','minOrderQty','maxOrderQty','memberPurchaseLimitEnabled','memberLifetimeQtyLimit'];

function GoodEditorForm({ ownership, accountId, action, catalogIps, ipOptions, pending, selected, state, initialIpId, variants, origins, noticeDefaults, categories, shippingNoticeOptions, regionSummaries, formRef, onSubmitCapture, onApplyKcTemplate, onSaveLocalDraft, onLoadServerDraft, onEditingStateChange, canSearchErp = true, canActivatePreorders = false, listHref = '/admin/catalog/goods' }: {
  accountId: string; ownership?: GoodsEditorOwnership | null;
  action: (payload: FormData) => void; catalogIps: Ip[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  pending: boolean; selected: AdminGoodRecord | null; state: AdminCatalogActionState;
  canSearchErp?: boolean;
  /** 등록 화면 예약판매 활성화 권한(platform.manage+admin). 서버·DB가 다시 검사한다. */
  canActivatePreorders?: boolean;
  initialIpId?: string; variants: AdminGoodsVariant[]; origins: GoodsFulfillmentOrigin[]; noticeDefaults?: GoodNoticeDefaults;
  categories: AdminCategoryNode[]; shippingNoticeOptions: GoodsShippingNoticeOption[]; regionSummaries: GoodShippingRegionSummary[];
  formRef: ReturnType<typeof useAdminLocalAutosave>['formRef']; onSubmitCapture: (event: FormEvent<HTMLFormElement>) => void;
  onApplyKcTemplate?:(template:GoodsKcPresetTemplate|null)=>void;
  onEditingStateChange?: (state: { goodId: string | null; dirty: boolean; busy: boolean }) => void;
  onSaveLocalDraft: (form: HTMLFormElement) => boolean; onLoadServerDraft: (draft: GoodsDraft) => void; listHref?: string;
}) {
  const groupOwned = Boolean(ownership?.group), aggregationOwned = Boolean(ownership && !ownership.aggregation.editable);
  /* 랜덤 판매(D5②) 여부는 goods.option_sale_mode(AdminGoodRecord.optionSaleMode)다. 싣지 않은 기록은 일반 판매로 본다. */
  const randomSale = selected?.optionSaleMode === 'random';
  const [draft] = useState(() => {
    const next = createGoodEditorDraft(selected, state, variants, initialIpId, noticeDefaults);
    const saved = goodEditorValues(selected, {}, initialIpId, noticeDefaults);
    for (const field of [...(groupOwned ? [...GROUP_COMMON_FIELDS, 'name'] : []), ...(aggregationOwned ? [...SHARED_SHIPPING_FIELDS, ...SHARED_QUANTITY_FIELDS] : [])]) {
      next.initial[field] = saved[field]; (next.values as Record<string,string>)[field] = saved[field];
    }
    // Previously recovered option shapes cannot replace a group member's sole SKU.
    if (groupOwned) { const original = createGoodEditorDraft(selected, {}, variants, initialIpId, noticeDefaults); next.values.variants = original.values.variants; next.baseline = original.baseline; next.initial.optionUsage = 'off'; }
    return next;
  });
  const { initial, baseline } = draft;
  const [values, setValues] = useState<Record<string, string>>(draft.values);
  const rows = restoreGoodsOptionRows(values.variants)!;
  /* 등록 화면의 KC·예약판매 섹션(R13·D6②)은 폼 키 밖 provider에 있다. 옵션 행을 알려 적용 옵션을 고르게 한다. */
  const workspace = useGoodWorkspaceSections();
  const atomicSections = !selected && workspace ? workspace : null;
  const publishOptionRows = workspace?.publishOptionRows;
  useEffect(() => { const current = restoreGoodsOptionRows(values.variants); if (current) publishOptionRows?.(current); }, [values.variants, publishOptionRows]);
  const editorRef = useRef<HTMLFormElement | null>(null);
  const baselineFingerprint = useRef<string | null>(null);
  const recovered = Boolean(preservedFormValues(state, selected?.id));
  const [dirty, setDirty] = useState(recovered);
  const recoveryUnsaved = useRef(recovered);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [localSaveMessage, setLocalSaveMessage] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  useEffect(() => { onEditingStateChange?.({ goodId: selected?.id ?? null, dirty, busy: pending || draftBusy }); }, [selected?.id, dirty, pending, draftBusy, onEditingStateChange]);
  const [optionImportRevision, setOptionImportRevision] = useState(0);
  const [draftIdentity, setDraftIdentity] = useState<GoodsDraftIdentity | null>(() => {
    const candidate = { id: initial.serverDraftId, revision: Number(initial.serverDraftRevision) };
    return !selected && validGoodsDraftIdentity(candidate) ? candidate : null;
  });
  const draftOperation = useRef(false);
  const newDraftId = useRef<string | null>(null);
  useEffect(() => {
    if (!optionImportRevision || !editorRef.current) return;
    // Capture after React commits the imported rows and child-owned axes together.
    const form = editorRef.current;
    form.dispatchEvent(new Event('input', { bubbles: true }));
    onSaveLocalDraft(form);
  }, [optionImportRevision, onSaveLocalDraft]);
  async function saveServerDraft(asNew = false) {
    const form = editorRef.current;
    if (!form || pending || draftOperation.current) return;
    const submitted = readAdminFormData(form);
    if (!submitted) return;
    draftOperation.current = true; setDraftBusy(true); setLocalSaveMessage('');
    if (asNew || !newDraftId.current) newDraftId.current = crypto.randomUUID();
    const identity = !asNew && draftIdentity ? draftIdentity : { id: newDraftId.current, revision: 0 };
    try {
      const result = await saveGoodsDraftAction(identity, collectGoodsDraftValues(submitted));
      if (!result.data) { setLocalSaveMessage(result.error ?? '임시저장하지 못했습니다. 입력은 유지됩니다.'); return; }
      setDraftIdentity({ id: result.data.id, revision: result.data.revision });
      baselineFingerprint.current = goodEditorFingerprint(submitted);
      recoveryUnsaved.current = false;
      const current = readAdminFormData(form);
      if (current) setDirty(goodEditorFingerprint(current) !== goodEditorFingerprint(submitted));
      setLocalSaveMessage('입력 내용을 내 계정에 임시저장했습니다. 다른 기기에서도 불러올 수 있습니다.');
    } catch { setLocalSaveMessage('저장 여부를 확인하지 못했습니다. 임시저장 불러오기에서 확인해주세요. 입력은 유지됩니다.'); }
    finally { draftOperation.current = false; setDraftBusy(false); }
  }
  const errors = { ...state.errors, ...clientErrors };
  const locked = Boolean(selected?.publishedAt);
  const lockedValues = goodEditorValues(selected, {}, initialIpId, noticeDefaults);
  const attachForm = useCallback((form: HTMLFormElement | null) => {
    editorRef.current = form;
    if (!form) return;
    const initialData = readAdminFormData(form);
    if (baselineFingerprint.current === null && initialData) baselineFingerprint.current = goodEditorFingerprint(initialData);
    return formRef(form, (data) => {
      if (baselineFingerprint.current === null) baselineFingerprint.current = goodEditorFingerprint(data);
      // Native input listeners can run before React commits the option hidden input.
      // Editable options are authoritative here; never replace them with that older DOM value.
      setValues(current => ({ ...goodFormValues(data), variants: current.variants, variantBaseline: current.variantBaseline,customInputs:current.customInputs,productAttributes:current.productAttributes,productAttributeDraft:current.productAttributeDraft }));
      setDirty(recoveryUnsaved.current || goodEditorFingerprint(data) !== baselineFingerprint.current);
    });
  }, [formRef]);
  /* 등록 화면 KC·예약판매 입력은 폼 밖이라 폼 지문에 잡히지 않는다. 떠나기 경고에는 함께 센다. */
  const sectionsDirty = Boolean(atomicSections && (atomicSections.sections.kc.models.length || atomicSections.sections.kc.attested || atomicSections.sections.preorders.length));
  useEffect(() => {
    if (!(dirty || sectionsDirty) || pending || draftBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, sectionsDirty, pending, draftBusy]);
  const [suggestedCode, setSuggestedCode] = useState(selected?.code ?? '');
  const setRows: Dispatch<SetStateAction<GoodsOptionRow[]>> = useCallback((update) => {
    setValues((current) => {
      const currentRows = restoreGoodsOptionRows(current.variants)!;
      const next = typeof update === 'function' ? update(currentRows) : update;
      return { ...current, variants: JSON.stringify(next) };
    });
  }, []);
  const [imageUrls, setImageUrls] = useState(draft.imageUrls);
  /* 판매가·할인은 화면 입력에서 저장 계약(price·compareAtPrice)을 한 번에 만든다. */
  const [priceDraft, setPriceDraft] = useState(() => goodsPriceDraftFromValues(draft.values));
  const priceResult = resolveGoodsPrice(priceDraft);
  /* ERP 품목 선택이 비어 있는 대표 카테고리를 채울 수 있도록 대표 카테고리는 이 폼이 제어한다. */
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const attributesReady = groupOwned || goodsAttributeSubmissionReady(values.productAttributes, categoryId);
  const [attributePreview, setAttributePreview] = useState<{id:string;name:string;value:string}[]>([]);
  const onAttributeChange = useCallback((submission: string, attributeDraft: string, initialize: boolean, preview: {id:string;name:string;value:string}[]) => {
    setAttributePreview(preview);
    setValues(current => ({ ...current, productAttributes: submission, productAttributeDraft: attributeDraft }));
    if (initialize) {
      if (baselineFingerprint.current) {
        const entries = JSON.parse(baselineFingerprint.current) as [string, string][];
        baselineFingerprint.current = JSON.stringify([...entries.filter(([name]) => !['productAttributes','productAttributeDraft'].includes(name)), ['productAttributes',submission],['productAttributeDraft',attributeDraft]].sort(([a],[b])=>a.localeCompare(b)));
        const current = editorRef.current && readAdminFormData(editorRef.current);
        if (current) setDirty(recoveryUnsaved.current || goodEditorFingerprint(current) !== baselineFingerprint.current);
      }
    } else setDirty(true);
  }, []);
  const [erpCategory, setErpCategory] = useState<ErpCategorySuggestion | null>(null);
  function applyErpItem(item: ErpItemMatch) {
    const suggestion = planErpCategorySuggestion(item, categoryId, categories);
    if (suggestion?.kind === 'filled') setCategoryId(suggestion.categoryId);
    setErpCategory(suggestion);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending || draftBusy) { event.preventDefault(); return; }
    const submitted = readAdminFormData(event.currentTarget);
    if (!submitted) { event.preventDefault(); return; }
    if (!attributesReady) { event.preventDefault(); setClientErrors({ productAttributes: '선택한 카테고리의 상품속성 조회가 끝난 뒤 저장해주세요.' }); focusGoodWorkspaceTarget('good-section-attributes'); return; }
    const changes = locked ? changedGoodLockedFields(lockedValues, goodFormValues(submitted)) : [];
    if (changes.length) {
      event.preventDefault(); setClientErrors(Object.fromEntries(changes));
      focusGoodWorkspaceTarget(`good-section-${goodFieldSection(changes[0][0]).key}`, changes[0][0]); return;
    }
    if (atomicSections) {
      /* 등록 화면: KC·예약판매 입력과 작업 ID를 이번 제출에 싣는다. FormData는 이 capture 단계 뒤에 만들어진다. */
      const prepared = prepareGoodWorkspaceSections(atomicSections.sections, rows, canActivatePreorders, { salePeriodEnabled: submitted.get('salePeriodEnabled') === 'true' });
      if (!prepared.ok) {
        event.preventDefault(); atomicSections.setSectionErrors({ [prepared.field]: prepared.error }); setClientErrors({ [prepared.field]: prepared.error });
        focusGoodWorkspaceTarget(`good-operation-${GOOD_WORKSPACE_ERROR_SECTIONS[prepared.field]}`); return;
      }
      atomicSections.setSectionErrors({});
      const form = event.currentTarget;
      const sectionsInput = form.elements.namedItem(GOOD_WORKSPACE_SECTIONS_FIELD), operationInput = form.elements.namedItem(GOOD_WORKSPACE_OPERATION_FIELD);
      if (sectionsInput instanceof HTMLInputElement) sectionsInput.value = JSON.stringify(prepared.value);
      if (operationInput instanceof HTMLInputElement) operationInput.value = atomicSections.operationId();
    }
    setClientErrors({}); onSubmitCapture(event);
  }
  function showInvalidFields(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = Array.from(event.currentTarget.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.willValidate && !element.validity.valid);
    const fieldErrors: Record<string, string> = {};
    for (const input of invalid) {
      const artworkName = input.closest('.wc-admin-artwork-upload-field')?.querySelector<HTMLInputElement>('input[type="hidden"][name]')?.name;
      /* 이름 없이 JSON으로 제출하는 입력(옵션별 구매 제한 표)은 data-error-field로 자기 섹션의 오류 칸에 붙인다. */
      const name = input.name || artworkName || input.dataset.errorField || (input.closest('.admin-option-editor') ? 'variants' : 'form');
      const label = input.labels?.[0]?.textContent?.trim() || input.getAttribute('aria-label')?.trim() || name;
      /* 같은 칸에 오류가 여럿이면 포커스가 가는 첫 입력의 안내를 보인다. */
      fieldErrors[name] ??= input.validity.customError ? input.validationMessage : `${label} 입력값을 확인해주세요. ${input.validationMessage}`;
    }
    setClientErrors(fieldErrors);
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
      const data = readAdminFormData(form);
      if (!data) return;
      const path = String(data.get('descriptionUploadPath') ?? '');
      const alt = String(data.get('descriptionImageAlt') ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      fragment = sanitizeGoodsDescription(`<img src="${path}" alt="${alt}">`).html;
      if (!fragment) return;
    }
    input.setRangeText(fragment, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
  /* 이미지 그리드는 커밋마다 모든 칸을 알린다(R19). 바뀐 칸이 없으면 같은 상태를 돌려 편집기 전체를 다시 그리지 않는다. */
  function setImageUrl(name: string, url: string | null) { setImageUrls((current) => current[name] === url ? current : { ...current, [name]: url }); }
  function applyNotice(notice: GoodsNoticeInfo,kcTemplate?:GoodsKcPresetTemplate|null) {
    const form = editorRef.current;
    if (!form) return;
    for (const field of GOODS_NOTICE_FIELDS) {
      const input = form.elements.namedItem(field.formName);
      if (input instanceof HTMLInputElement) { input.value = notice[field.key] ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    // Omitted means notice-only copy; explicit null cancels a queued classification.
    if (kcTemplate !== undefined) onApplyKcTemplate?.(kcTemplate);
  }
  /*
   * 공개 미리보기·상세 HTML 정리는 무겁다(R19). 입력과 무관한 상태 변화(오류·안내·업로드 진행)에는 다시 계산하지 않고,
   * 입력 변화도 지연 값으로 받아 입력칸 응답을 먼저 그린 뒤 미리보기를 낮은 우선순위로 다시 그린다.
   */
  const previewValues = useDeferredValue(values);
  const previewImageUrls = useDeferredValue(imageUrls);
  const { origin: previewOrigin, ip: previewIp, detail: previewDetail, shippingPolicy } = useMemo(() => buildGoodEditorPreview({
    values: previewValues, imageUrls: previewImageUrls, selected, catalogIps, origins, shippingNoticeOptions,
  }), [previewValues, previewImageUrls, selected, catalogIps, origins, shippingNoticeOptions]);
  const previewWithAttributes = useMemo(() => ({ ...previewDetail, attributes: attributePreview }), [previewDetail, attributePreview]);
  const notice = Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.key, initial[field.formName]])) as GoodsNoticeInfo;
  const htmlDescription = values.descriptionFormat === 'html';
  const previewHtmlDescription = previewValues.descriptionFormat === 'html';
  const previewDescription = previewValues.description;
  const descriptionCheck = useMemo(() => previewHtmlDescription ? sanitizeGoodsDescription(previewDescription ?? '') : null, [previewHtmlDescription, previewDescription]);
  /* R17: 붙여넣기가 잘리지 않게 글자 수 제한을 두지 않는다. 상한(lib/goods-description)을 넘으면 저장 전에 알린다(서버도 같은 상한으로 거절한다). */
  const rawDescriptionLength = values.description?.length ?? 0;
  const descriptionWarnings = [
    ...(htmlDescription && rawDescriptionLength > GOODS_HTML_MAX_LENGTH ? [`원문이 ${rawDescriptionLength.toLocaleString('ko-KR')}자로 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자를 넘어 저장할 수 없습니다. 붙여넣은 내용은 잘리지 않고 그대로 있으니 줄여주세요.`] : []),
    ...(htmlDescription && descriptionCheck ? [...descriptionCheck.warnings, ...(descriptionCheck.html.length > GOODS_HTML_MAX_LENGTH ? [goodsHtmlCleanedLengthWarning(descriptionCheck.html.length)] : [])] : []),
  ];
  const errorCount = (key: string) => GOOD_EDITOR_SECTIONS.find((section) => section.key === key)?.fields.filter((field) => errors[field]).length ?? 0;
  return <>
    <nav className="admin-good-editor-tabs" aria-label="상품 등록 방식"><span aria-current="page">{selected ? '상품 수정' : '상품 등록'}</span>
      {/* R21(D9①): 그룹상품 등록은 메뉴 숨김과 짝으로 탭에서도 숨기고 라우트(/admin/catalog/groups/new)만 유지한다. */}
      {groupGoodsEntryVisible() && !selected ? <Link href="/admin/catalog/groups/new?mode=assemble" aria-disabled={pending || draftBusy} onNavigate={event => {
        if (pending || draftBusy || dirty && !window.confirm('저장하지 않은 상품 입력을 두고 그룹상품 등록으로 이동할까요?')) event.preventDefault();
      }}>그룹상품 등록</Link> : null}
      <small><span aria-hidden="true">*</span> 필수항목</small></nav>
    <GoodWorkspaceNavigation />
    <form action={action} className="wc-admin-kit col admin-good-workspace__form" onInvalidCapture={showInvalidFields} onSubmitCapture={submit} ref={attachForm}>
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
      <input name="published" type="hidden" value={String(Boolean(selected?.publishedAt))} />
      <input name="bg" type="hidden" value={selected?.bg ?? ''} />
      {!selected && draftIdentity ? <><input type="hidden" name="serverDraftId" value={draftIdentity.id}/><input type="hidden" name="serverDraftRevision" value={draftIdentity.revision}/></> : null}
      {atomicSections ? <><input type="hidden" name={GOOD_WORKSPACE_OPERATION_FIELD} defaultValue="" /><input type="hidden" name={GOOD_WORKSPACE_SECTIONS_FIELD} defaultValue="" /></> : null}
      <GoodWorkspaceErrors errors={errors} />
      <GoodEditorSection title="카테고리" id="good-section-category" summary={categories.find((category) => category.id === categoryId)?.name || '선택 안 함'} errorCount={errorCount('category')}>
          <OwnedFields locked={groupOwned} fields={['categoryId','additionalCategoryIds']} values={initial}><CategoryAssignmentField categories={categories} value={initial.categoryId} primary={categoryId} onPrimaryChange={setCategoryId} error={errors.categoryId} additionalValue={initial.additionalCategoryIds} additionalError={errors.additionalCategoryIds} /></OwnedFields>
      </GoodEditorSection>
      <GoodEditorSection title="상품속성" id="good-section-attributes" summary="대표 카테고리별 추가 정보" errorCount={errorCount('attributes')}>
        <OwnedFields locked={groupOwned} fields={[]} values={initial}><GoodsAttributeEditor categoryId={categoryId} goodId={selected?.id ?? null} initialSubmission={initial.productAttributes} initialDraft={initial.productAttributeDraft} error={errors.productAttributes} onChange={onAttributeChange} /></OwnedFields>
      </GoodEditorSection>
      <GoodEditorSection title="상품명" id="good-section-basic" requirement={selected ? "필수 · 상품명과 연결 IP를 확인해주세요." : "필수 · 상품명만 입력해도 등록 중인 상품을 임시저장할 수 있습니다."} summary={values.name || '상품명 미입력'} errorCount={errorCount('basic')}>
        {locked && <div className="admin-good-workspace__lock"><strong>공개 중 잠금: 상품명·유형·연결 IP·제조자·제조국·소재·크기</strong><p>실제 모델과 검토 근거를 일치시키기 위한 잠금입니다. 초안으로 전환 후 수정하고 KC를 재검토해야 재공개할 수 있습니다.</p><a href="#good-operation-publish" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-publish'); }}>초안으로 전환 후 수정</a></div>}
          <Field readOnly={locked || groupOwned} defaultValue={initial.name} error={errors.name} label={`상품명${locked ? ' · 공개 중 잠금' : ''}`} name="name" />
      </GoodEditorSection>
      <GoodEditorSection title="판매가" id="good-section-price" requirement="판매가 → 할인(선택)" status={priceResult.regularPriceError || priceResult.discountError ? '입력 확인 필요' : '입력값 확인'} errorCount={errorCount('price')} summary={`판매가 ${priceResult.regularPrice ? formatWon(priceResult.regularPrice) : '미입력'}${priceDraft.discountEnabled ? priceResult.discountAmount > 0 && priceResult.salePrice !== null ? ` · 할인가 ${formatWon(priceResult.salePrice)}` : ' · 할인 입력 확인' : ' · 할인 없음'}${dirty ? ' · 미저장 입력' : ''}`}>
        <GoodsPriceFields draft={priceDraft} onDraftChange={setPriceDraft} result={priceResult} errors={errors} showDiscountRate={initial.showDiscountRate} />
      </GoodEditorSection>
      <GoodEditorSection title="판매기간" id="good-section-period" requirement="선택 · 일반 판매" errorCount={errorCount('period')} summary={values.salePeriodEnabled === 'true' ? `${values.saleStartsAt?.replace('T', ' ') || '시작 미입력'} ~ ${values.saleEndsAt?.replace('T', ' ') || '종료 미입력'} · 한국시간` : '설정안함'}>
        <GoodsSalePeriodFields values={values} error={errors.saleStartsAt} onChange={patch => { setValues(current => ({ ...current, ...patch })); setDirty(true); }} />
      </GoodEditorSection>
      <GoodsPurchaseLimitFields quantityReadOnly={aggregationOwned} values={initial} current={values} errors={errors} rows={rows} onRowsChange={setRows} randomSale={randomSale} />
      <GoodEditorSection title="재고수량 / 옵션" id="good-section-variants" requirement="공개 필수 · 옵션 없이 팔면 재고수량만 입력" status="옵션 확인" errorCount={errorCount('variants')} summary={`${isSingleGoodsOption(rows) ? '옵션 없음 · 재고수량' : `옵션 ${rows.length.toLocaleString('ko-KR')}개 · 재고수량 합계`} ${goodsOptionStockTotals(rows).total.toLocaleString('ko-KR')}개`}>
        <GoodsOptionEditor structureLocked={groupOwned} onRowsChange={setRows} codePrefix={values.code || suggestedCode} rows={rows} baseline={baseline} basePrice={priceResult.salePrice ?? 0}
          priceDraft={priceDraft} error={errors.variants} axisValues={initial}
          savedCodes={{ goodCode: selected?.code ?? null, options: variants }}
          optionImport={{ accountId, target: selected ? { ...selected, variants } : null, databaseVersion: JSON.stringify([selected, variants]),
            categories: categories.filter(category => !category.archivedAt).map(category => ({ id: category.id, name: `${'　'.repeat(Math.max(0, category.depth - 1))}${category.name}` })),
            pending: pending || draftBusy, blockedReason: groupOwned ? '그룹 구성에서 옵션을 관리합니다.' : selected?.archivedAt ? '보관된 상품에는 옵션을 불러올 수 없습니다.' : locked ? '다른 상품 옵션을 불러오려면 먼저 상품을 비공개 초안으로 전환해주세요.' : null,
            onApplied: () => { setDirty(true); setOptionImportRevision(value => value + 1); } }}
          canSearchErp={canSearchErp} onErpItemSelect={groupOwned ? undefined : applyErpItem} onRegularPriceApply={(price) => setPriceDraft((current) => ({ ...current, regularPrice: String(price) }))}
          erpNotice={<GoodsErpCategoryNotice suggestion={erpCategory} currentCategoryId={categoryId} onReplace={setCategoryId} onReview={() => focusGoodWorkspaceTarget('good-section-category', 'categoryId')} />} />
        <GoodsCustomInputEditor value={values.customInputs} revision={initial.customInputsExpectedRevision ?? '0'} error={errors.customInputs} onChange={customInputs=>{setValues(current=>({...current,customInputs}));setDirty(true);}} />
      </GoodEditorSection>
      <GoodEditorSection title="상품이미지" id="good-section-images" requirement="대표이미지 · 공개 필수 / 추가이미지 · 선택" summary={`대표이미지 ${values.imagePath ? '등록됨' : '미등록'} · 추가이미지 ${Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => values[`galleryPath${i}`]).filter(Boolean).length}장`} errorCount={errorCount('images')}>
        <GoodsImageGrid accountId={accountId} recordId={selected?.id ?? 'new'} editingDisabled={pending || draftBusy || Boolean(selected?.archivedAt)} errors={errors} initialPaths={GOODS_IMAGE_FIELD_NAMES.map((name) => initial[name])} initialUrls={GOODS_IMAGE_FIELD_NAMES.map((name) => imageUrls[name])} onPreviewChange={setImageUrl} />      </GoodEditorSection>
      <GoodEditorSection title="상세설명" id="good-section-description" summary={values.description ? '상세설명 작성됨' : '입력 안 함'} errorCount={errorCount('description')}>
        <OwnedFields locked={groupOwned} fields={['description','descriptionFormat']} values={initial}><GoodOptionalFields id="good-optional-description" title="상세설명 편집" summary={htmlDescription && descriptionCheck ? `상세페이지 HTML · 원문 ${(values.description?.length ?? 0).toLocaleString('ko-KR')}자 · 정리 후 ${descriptionCheck.html.length.toLocaleString('ko-KR')}자` : `일반 텍스트 · ${values.description?.length || 0}자`} hasErrors={Boolean(errors.description || errors.descriptionFormat)}>
        <SelectField defaultValue={initial.descriptionFormat} error={errors.descriptionFormat} label="상세 설명 형식" name="descriptionFormat"><option value="plain">일반 텍스트</option><option value="html">HTML 문서 (상세페이지 소스)</option></SelectField>
        <p className="muted">형식을 바꿔도 입력 원문은 유지됩니다. 일반 텍스트에서는 태그도 글자로 표시됩니다.</p>
        <div className="admin-goods-html-tools" hidden={!htmlDescription}>
          <p>다른 판매처에 쓰는 상세페이지 HTML 소스를 그대로 붙여넣을 수 있습니다. https로 시작하는 호스팅 이미지 주소는 그대로 표시되므로 호스팅 이미지를 바꾸면 이 상세페이지에도 반영됩니다. 제목·문단·목록·표·강조·링크와 아래 도구의 정렬·글자 크기·인용·구분선 서식을 지원합니다. 임의 CSS·스크립트·이벤트는 제거됩니다.</p>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => insertDescription('<h2>제목</h2>\n')} type="button">제목 넣기</button>
            <button className="btn btn-ghost" onClick={() => insertDescription('<p>문단 내용</p>\n')} type="button">문단 넣기</button>
            <button className="btn btn-ghost" onClick={() => insertDescription('<ul><li>항목</li></ul>\n')} type="button">목록 넣기</button>
            <button className="btn btn-ghost" onClick={() => insertDescription('<table><caption>표 제목</caption><tbody><tr><th scope="row">항목</th><td>내용</td></tr></tbody></table>\n')} type="button">표 넣기</button>
          </div>
          <GoodsDescriptionTools accountId={accountId} formRef={editorRef} disabled={groupOwned || !htmlDescription || pending || draftBusy || Boolean(selected?.archivedAt)} />
        </div>
        <TextArea defaultValue={initial.description} error={errors.description} label={htmlDescription ? `상세페이지 HTML (정리된 코드 포함 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자)` : '상세 설명 (최대 2,000자)'} maxLength={htmlDescription ? undefined : GOODS_DESCRIPTION_MAX_LENGTH} name="description" placeholder={htmlDescription ? '<h2>상품 특징</h2><p>상세 내용을 입력해주세요.</p>' : adminGoodsCopy('굿즈 구성과 특징을 짧게 설명해주세요.')} />
        {descriptionWarnings.length > 0 && <div className="admin-goods-html-review" role="status"><p>저장 전 확인: 입력 원문은 편집기에 남아 있으며 아래 미리보기의 결과가 저장됩니다.</p><ul>{descriptionWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        <fieldset className="admin-goods-html-tools" disabled={!htmlDescription} hidden={!htmlDescription}>
          <ArtworkUploadField autoUpload allowRemove currentPath={initial.descriptionUploadPath || null} currentUrl={initial.descriptionUploadPath ? publicMediaUrl(initial.descriptionUploadPath) : null} fieldId="good-description-image" helpText="이미지 검증이 끝나면 대체 설명을 적고 설명에 넣기를 누릅니다. HTML 본문에는 최대 20장을 넣을 수 있습니다." kind="good" label="HTML 이미지 업로드" name="descriptionUploadPath" />
          <Field defaultValue={initial.descriptionImageAlt} label="HTML 이미지 대체 설명" name="descriptionImageAlt" maxLength={300} />
          <button className="btn btn-ghost" onClick={() => insertDescription()} type="button">업로드한 이미지를 설명에 넣기</button>
          <p className="muted">호스팅 이미지 주소(https://…)는 업로드 없이 HTML에 그대로 쓰면 됩니다. http 주소는 https로 바꿔 저장합니다. 호스팅하지 않은 이미지만 파일을 업로드한 후 넣어주세요. 아래 상품 미리보기에서 공개될 결과를 확인할 수 있습니다.</p>
        </fieldset>
        </GoodOptionalFields>
        </OwnedFields>
        <GoodOptionalFields id="good-optional-detail-image" title="긴 상세 이미지 (선택)" summary={values.detailImagePath ? '이미지 연결됨' : '이미지 없음'} hasErrors={Boolean(errors.detailImagePath)}>
        <ArtworkUploadField compact showPath={false} showGuidance={false} showCropGuide={false} autoUpload allowRemove currentPath={initial.detailImagePath || null} currentUrl={imageUrls.detailImagePath} fieldId="good-detail" helpText="상세페이지(상세 설명) 아래에 원래 비율로 붙는 이미지 파일 1장입니다. 호스팅 HTML로 상세페이지를 만들었다면 비워 두어도 됩니다." kind="good" label="상세 이미지" name="detailImagePath" onPreviewChange={(url) => setImageUrl('detailImagePath', url)} />
        <ErrorText>{errors.detailImagePath}</ErrorText>
        </GoodOptionalFields>
      </GoodEditorSection>
      <GoodEditorSection title="상품 주요정보" id="good-section-information" requirement="연결 IP·상품 유형 · 공개 필수" summary={`${ipOptions.find((ip) => ip.id === values.ipId)?.title || 'IP 미선택'} · ${values.type || '상품 유형 미선택'}`}>
        <div className="admin-form-grid">
          <SelectField defaultValue={initial.ipId} error={errors.ipId} label={locked ? "연결 IP · 공개 중 잠금" : "연결 IP (필수)"} disabled={locked || groupOwned} name="ipId"><option value="">선택</option>{ipOptions.map((ip) => <option disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)} key={ip.id} value={ip.id}>{ip.archivedAt ? `[보관] ${ip.title}` : ip.title}</option>)}</SelectField>
          {(locked || groupOwned) && <input type="hidden" name="ipId" value={initial.ipId} />}
          <SelectField defaultValue={initial.type} error={errors.type} label={locked ? "유형 · 공개 중 잠금" : "상품 유형 (필수)"} disabled={locked || groupOwned} name="type"><option value="">선택</option>{GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</SelectField>
          {(locked || groupOwned) && <input type="hidden" name="type" value={initial.type} />}
          <SelectField defaultValue={initial.badge} error={errors.badge} label="상품 표시문구" name="badge"><option value="">없음</option>{GOOD_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</SelectField>
          <SelectField defaultValue={initial.stock} error={errors.stock} label="판매상태" name="stock">{Object.entries(ADMIN_STOCK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        </div>
        <p className="muted">연결 IP는 브랜드·작품, 고객용 카테고리는 쇼핑 분류, 유형은 상품의 형태를 나타냅니다.</p>
        {canSearchErp && values.ipId && <a href={`/admin/catalog/ips/${encodeURIComponent(values.ipId)}`} target="_blank" rel="noreferrer">연결 IP의 공개 상태 확인 (새 탭)</a>}
        <GoodOptionalFields id="good-optional-search" title="검색설정·판매자상품코드" summary={`${values.nameEn || '영문명 없음'} · 진열 ${values.displayOrder || '기본'} · ${values.code || suggestedCode || '판매자상품코드 자동 생성'} · ${values.id || 'URL 자동 생성'}`} hasErrors={['nameEn', 'displayOrder', 'searchKeywords', 'code', 'id', 'defaultVariantCode'].some((key) => Boolean(errors[key]))}>
        <AdminFormGrid>          <Field readOnly={groupOwned} defaultValue={initial.nameEn} error={errors.nameEn} label="영문 상품명 (선택)" name="nameEn" maxLength={200} />
          <Field defaultValue={initial.displayOrder} error={errors.displayOrder} label="진열 순서 (선택)" name="displayOrder" min={0} type="number" />
        </AdminFormGrid>
        <OwnedFields locked={groupOwned} fields={['searchKeywords']} values={initial}><TextArea
          defaultValue={initial.searchKeywords}
          error={errors.searchKeywords}
          label="검색 키워드 (선택)"
          maxLength={4200}
          name="searchKeywords"
          placeholder="한 줄에 하나 또는 쉼표로 구분해 입력해주세요."
        /></OwnedFields>
        <p className="muted">고객 통합 검색과 어드민 상품 검색에만 쓰이며, 공개 상세에는 표시하지 않습니다.</p>
        <GoodIdentifierFields code={initial.code} defaultVariantCode={initial.defaultVariantCode ?? variants.find((v) => v.isDefault)?.code} hideVariantCode onCodeSuggestion={setSuggestedCode} errors={state.errors ?? {}} ipId={values.ipId} name={values.name} slug={initial.id} slugLocked={groupOwned || Boolean(selected?.firstPublishedAt)} />
        </GoodOptionalFields>
      </GoodEditorSection>
      <GoodEditorSection title={ADMIN_VOCABULARY.noticeInfo} id="good-section-notice" requirement="공개 필수 · 초안에는 일부 저장 가능" status={GOODS_NOTICE_FIELDS.every((field) => values[field.formName]?.trim()) ? '입력 완료 · KC 별도 검토' : '미입력'} errorCount={errorCount('notice')} summary={`${GOODS_NOTICE_FIELDS.filter((field) => values[field.formName]?.trim()).length}/${GOODS_NOTICE_FIELDS.length}개 작성 · ${atomicSections ? 'KC는 아래 KC 정보에서 함께 저장' : 'KC는 저장 후 검토'}`}>
        <OwnedFields locked={groupOwned} fields={GOODS_NOTICE_FIELDS.map(field => field.formName)} values={initial}><GoodNoticePicker onApply={applyNotice} readOnly={locked||Boolean(selected?.archivedAt)} /><GoodsNoticeFields notice={notice} required={Boolean(selected?.publishedAt)} locked={locked} originFinderDisabled={pending || draftBusy || Boolean(selected?.archivedAt)} state={{ ...state, errors }} /></OwnedFields>
        <p>{selected ? <><a href="#good-operation-kc" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-kc'); }}>KC 정보 열기</a> · KC 대상이 아니면 상품 전체 KC 해당 없음으로 바로 검토를 끝냅니다.</> : atomicSections ? <>아래 <a href="#good-operation-kc" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-kc'); }}>KC 정보</a>에서 상품과 함께 저장합니다. KC 대상이 아니면 해당 없음 확인 한 번으로 끝납니다.</> : '초안 저장 후 KC 정보에서 검토합니다. KC 대상이 아니면 해당 없음 확인 한 번으로 끝납니다.'}</p>
      </GoodEditorSection>
      <GoodEditorSection title="배송" id="good-section-shipping" requirement="출고지 · 공개 필수" status={values.originId ? '출고지 선택됨' : '미입력'} errorCount={errorCount('shipping')} summary={`${previewOrigin?.name || '출고지 확인 필요'} · ${values.shippingFeeType === 'policy' ? '출고지 정책' : values.shippingFeeType === 'free' ? '무료배송' : '개별 배송비'}`}><OwnedFields locked={aggregationOwned} fields={SHARED_SHIPPING_FIELDS} values={initial}><GoodsFulfillmentFields regionSummaries={regionSummaries} origins={origins} value={{ originId: initial.originId || null, shippingFeeType: initial.shippingFeeType as 'policy' | 'free' | 'individual', individualFee: Number(initial.individualFee) }} errors={errors} /></OwnedFields><p>배송비 묶음그룹을 지정하면 위 기본료와 수량 조건을 묶음 대상 전체에 적용합니다. {selected ? <a href="#good-operation-shipping-charge-group">현재 묶음그룹 확인·배정</a> : '상품을 먼저 저장한 뒤 묶음그룹을 배정할 수 있습니다.'}</p><GoodsShippingNoticeField options={shippingNoticeOptions} value={initial.shippingNoticeTemplate} error={errors.shippingNoticeTemplate} /></GoodEditorSection>
      <GoodsClaimPolicyFields values={initial} errors={errors} />
      <GoodsSalePolicyFields values={initial} errors={errors} />
      <div className="admin-good-workspace__save" aria-label="기본 상품 저장">
        <GoodWorkspaceDetails stateId="good-save-info" className="admin-good-workspace__save-info"><summary><strong role="status">{pending ? '저장 중…' : Object.keys(errors).length ? '저장 실패 · 입력값 유지' : dirty ? '미저장 변경 있음' : state.kcPublishBlocked ? (selected?.publishedAt ? '서버 저장값과 동일' : '초안 저장 완료 · 공개 보류') : state.message ? '기본 상품 저장 완료' : selected ? '서버 저장값과 동일' : '새 초안 · 아직 저장 전'}</strong><span>저장 안내</span></summary>
          <div><p>{atomicSections ? '기본 상품·이미지·옵션·고시·배송·구매 제한·판매 조건과 아래 KC·예약판매 입력을 한 번에 저장합니다. 하나라도 실패하면 아무것도 저장되지 않고 입력은 유지됩니다. 나머지 운영 섹션은 저장 뒤 같은 자리에서 입력합니다.'
            : '기본 상품·이미지·옵션·고시·배송·구매 제한·판매 조건만 저장합니다. KC·재고 조정·혜택은 각 영역에서 별도 저장합니다.'}</p>
          <p>{selected ? '입력 임시저장은 현재 브라우저에 보관합니다.' : '임시저장은 내 계정에 최대 40건을 보관합니다. 업로드를 마친 이미지와 입력값을 불러올 수 있으며, 상품 등록·공개는 저장하기에서 따로 확정합니다.'} 브라우저 자동 복구도 함께 유지됩니다.</p>
          {dirty && <p>브라우저 복구 기록은 서버 저장이 아닙니다.</p>}
          {selected?.publishedAt && <p>저장하면 공개 중인 상품 화면에 반영됩니다.</p>}
          {atomicSections ? <p>1. 기본 정보·유형·고시정보·옵션과 KC까지 입력해 저장 → 2. 게시 상태에서 공개. KC를 검토 완료로 함께 저장했더라도 그 뒤 상품명·유형·IP·고시정보(제조자·제조국·소재·크기)나 옵션 구성을 바꾸면 KC를 다시 검토합니다.</p>
            : !selected?.publishedAt && !selected?.archivedAt && <p>1. 기본 정보·유형·고시정보·옵션까지 입력해 초안 저장 → 2. KC 검토 → 3. 공개. KC 검토 뒤 상품명·유형·IP·고시정보(제조자·제조국·소재·크기)나 옵션 구성을 바꾸면 KC를 다시 검토합니다.</p>}
          </div>
        </GoodWorkspaceDetails>
        <div className="admin-good-workspace__save-actions">
          <button className="wc-admin-kit__button" type="button" onClick={() => { const preview = document.getElementById('good-preview'); if (preview instanceof HTMLDetailsElement) { preview.open = true; preview.scrollIntoView({ block: 'start', behavior: 'instant' }); preview.querySelector('summary')?.focus(); } }}>미리보기</button>
          {selected ? <button className="wc-admin-kit__button admin-good-workspace__draft-button" type="button" disabled={pending} onClick={() => { if (editorRef.current) setLocalSaveMessage(onSaveLocalDraft(editorRef.current) ? '입력 내용을 이 브라우저에 임시저장했습니다.' : '브라우저에 임시저장할 수 없습니다. 저장하기를 이용해주세요.'); }}>입력 임시저장</button> : <>
            <button className="wc-admin-kit__button" type="button" disabled={pending || draftBusy} onClick={() => setDraftOpen(true)}>임시저장 불러오기</button>
            <button className="wc-admin-kit__button admin-good-workspace__draft-button" type="button" disabled={pending || draftBusy} onClick={() => { void saveServerDraft(); }}>{draftBusy ? '임시저장 중…' : '임시저장'}</button>
            {draftIdentity ? <button className="wc-admin-kit__button" type="button" disabled={pending || draftBusy} onClick={() => { void saveServerDraft(true); }}>새 임시저장으로 저장</button> : null}
          </>}
          {!attributesReady ? <span role="status">상품속성 조회 후 저장할 수 있습니다.</span> : null}
          <button className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending || draftBusy || !attributesReady || Boolean(selected?.archivedAt)} name="intent" value="save">{pending ? '저장 중…' : '저장하기'}</button>
          {selected && !selected.publishedAt && !selected.archivedAt && <button className="wc-admin-kit__button" disabled={pending || !attributesReady} name="intent" value="publish">저장 후 공개</button>}
          <Link className="wc-admin-kit__button" href={listHref} aria-disabled={pending || draftBusy} onNavigate={(event) => { if (pending || draftBusy || dirty && !window.confirm('저장하지 않은 변경사항이 있습니다. 상품 목록으로 이동하시겠습니까?')) event.preventDefault(); }}>취소</Link>
        </div>
        {localSaveMessage ? <p className="admin-good-workspace__local-save-status" role="status">{localSaveMessage}</p> : null}
        {state.kcPublishBlocked ? (state.message && !selected?.publishedAt ? <div className="card" role="alert" style={{ color: 'var(--wc-warning)', padding: 12, borderRadius: 10, fontWeight: 700 }}>{state.message}{selected && <> <a href="#good-operation-kc" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-kc'); }}>KC 정보 열기</a></>}</div> : null) : <ActionNotice state={state} />}
      </div>
    </form>
    {draftOpen ? <GoodsDraftLibraryDialog onClose={() => setDraftOpen(false)} onLoad={loaded => {
      if (dirty && !window.confirm('현재 입력을 선택한 임시저장 내용으로 바꾸시겠습니까? 저장하지 않은 입력은 이 화면에서 사라집니다.')) return false;
      onLoadServerDraft(loaded); return true;
    }}/> : null}
    <GoodPreviewPanel detail={previewWithAttributes} ip={previewIp} shippingPolicy={shippingPolicy} />
  </>;
}

type GoodEditorProps = Omit<Parameters<typeof GoodEditorForm>[0], 'formRef' | 'onSubmitCapture' | 'onSaveLocalDraft' | 'onLoadServerDraft'> & { accountId: string };
const GOOD_PASSIVE_INITIALIZATION_FIELDS = ['productAttributes', 'productAttributeDraft'] as const;

/** Own the entire edit/recovery session so callers cannot remount rows without their baseline. */
export function GoodEditor({ accountId, ...props }: GoodEditorProps) {
  const local = useAdminLocalAutosave({
    scope: { accountId, formId: 'good', recordId: props.selected?.id ?? null },
    fields: GOOD_LOCAL_DRAFT_FIELDS, serverState: props.state, passiveInitializationFields: GOOD_PASSIVE_INITIALIZATION_FIELDS,
  });
  const [serverRecovery, setServerRecovery] = useState<{ draft: GoodsDraft; attempt: number; version: number } | null>(null);
  const localState = withLocalRecoveryValues(props.state, props.selected?.id ?? null, local.snapshot.restoredValues);
  const state = !props.selected && serverRecovery && serverRecovery.attempt === (props.state.attempt ?? 0)
    ? { ...props.state, errors: undefined, message: undefined, values: { ...serverRecovery.draft.values, previousId: '', serverDraftId: serverRecovery.draft.id, serverDraftRevision: String(serverRecovery.draft.revision) } }
    : localState;
  useFocusFirstGoodError(props.state.attempt, state.errors);
  return <>
    <AdminLocalDraftNotice onDiscard={local.discard} onRestore={() => { setServerRecovery(null); local.restore(); }} pending={props.pending}
      recovery={Boolean(local.snapshot.recovery) && !preservedFormValues(props.state, props.selected?.id)} unavailable={local.snapshot.unavailable} />
    <GoodEditorForm {...props} accountId={accountId} state={state} formRef={local.formRef} onSubmitCapture={local.onSubmitCapture} onSaveLocalDraft={local.saveDraft}
      onLoadServerDraft={draft => { local.discard(); setServerRecovery(current => ({ draft, attempt: props.state.attempt ?? 0, version: (current?.version ?? 0) + 1 })); }}
      key={`${local.scopeKey}:${props.state.attempt ?? 0}:${local.snapshot.revision}:${serverRecovery?.version ?? 0}`} />
  </>;
}
