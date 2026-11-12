'use client';

import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp, Eye } from 'lucide-react';

import { GROUP_COMMON_FIELDS, type GoodsEditorOwnership } from '@/lib/admin/goods-group-common';
import type { ReactNode } from 'react';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { GoodsShippingNoticeOption } from '@/components/admin/GoodsShippingNoticeField';

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { GOODS_DESCRIPTION_MAX_LENGTH, GOODS_GALLERY_MAX } from '@/lib/admin/catalog';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import type { AdminGoodsVariant } from '@/lib/admin/goods-variants';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import { GoodsSalePeriodFields } from './GoodsSalePeriodFields';
import type { AdminGoodsReadiness } from '@/lib/admin/goods-readiness';
import { categoryPath } from '@/lib/admin/category';
import { goodEditorValues, createGoodEditorDraft, goodEditorFingerprint, buildGoodEditorPreview, GOOD_LOCAL_DRAFT_FIELDS, GOOD_LOCAL_DRAFT_LINKED_FIELDS, type GoodNoticeDefaults } from '@/lib/admin/good-editor';
import { goodsOptionStockMissing, goodsOptionStockTotals, inheritRandomOptionLimits, initialGoodsOptionRows, isSingleGoodsOption, restoreGoodsOptionRows, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { formatWon, goodsPriceDraftFromValues, resolveGoodsPrice } from '@/lib/admin/goods-price-editor';
import { planErpCategorySuggestion, type ErpCategorySuggestion } from '@/lib/admin/goods-erp-suggestion';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import { preservedFormValues } from '@/lib/admin/form-state';
import { readAdminFormData } from '@/lib/admin/form-capture';
import { withLocalRecoveryValues } from '@/lib/admin/local-autosave';
import { publicMediaUrl } from '@/lib/media';
import { AdminFormGrid, AdminNotice } from './console/AdminKit';
import { GoodsClaimPolicyFields } from './GoodsClaimPolicyFields';
import { GoodsAttributeEditor } from './GoodsAttributeEditor';
import { goodsAttributeSubmissionReady } from '@/lib/admin/goods-attributes';
import { GoodAdditionalCategoryField, GoodCategoryField } from './GoodCategoryFields';
import { GoodsShippingNoticeField } from './GoodsShippingNoticeField';
import type { GoodShippingPolicy } from '@/lib/fulfillment';
import { GoodsFulfillmentFields } from './GoodsFulfillmentFields';
import { GoodsCustomInputEditor } from './GoodsCustomInputEditor';
import { GoodsOptionEditor } from './GoodsOptionEditor';
import { GoodsDiscountRateField, GoodsPriceFields } from './GoodsPriceFields';
import { GoodsErpCategoryNotice } from './GoodsErpCategoryNotice';
import { GoodsPurchaseLimitFields, GoodsSalePolicyFields } from './GoodsSalePolicyFields';
import { GoodNoticePicker } from './GoodNoticePicker';
import { GOOD_LOCKED_SELECTS_CLASS } from './GoodEditorParts';
import { GoodDraftSwitch } from './GoodPublishControls';
import { GoodsOriginField } from './CountryNameFinder';
import type { GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';
import { useAdminLocalAutosave } from './useAdminLocalAutosave';
import { useAdminLeaveGuard } from './useAdminLeaveGuard';
import { ADMIN_LEAVE_RECOVERABLE_MESSAGE } from '@/lib/admin/leave-guard';
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
import { GoodWorkspaceNavigation, GoodWorkspaceErrors, GoodOptionalFields, GoodEditorSection, GoodEditorSubsection, GoodFoldedRow, GoodWorkspaceDetails, focusGoodWorkspaceTarget, useFocusFirstGoodError, useGoodWorkspaceSections } from './GoodWorkspace';
import { GOOD_WORKSPACE_ERROR_SECTIONS, GOOD_WORKSPACE_OPERATION_FIELD, GOOD_WORKSPACE_SECTIONS_FIELD, goodWorkspaceKcWithTemplate, prepareGoodWorkspaceSections } from '@/lib/admin/good-workspace-sections';
import { DEFAULT_FULFILLMENT_ORIGIN_ID } from '@/lib/admin/fulfillment-origins';
import { GOOD_EDITOR_SECTIONS, GOOD_PUBLISHED_LOCKS, changedGoodLockedFields, goodErrorsByCard, goodFieldSection, goodKcContextChanged, goodPublishRequirements, goodRemainingByCard, goodTypeSuggestion, type GoodEditorSectionKey } from '@/lib/admin/good-workspace';
import { ADMIN_STOCK_LABELS, ADMIN_VOCABULARY, adminGoodsCopy } from '@/lib/admin/vocabulary';
import { ADMIN_SCREENS, type AdminScreen } from '@/lib/admin/navigation';
import { ActionNotice, ErrorText, Field, SelectField, TextArea } from './fields';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/admin/kit/ui/dropdown-menu';

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
    <fieldset className="m-0 min-w-0 border-0 p-0" data-good-notice-fields="">
      <legend className="sr-only">{ADMIN_VOCABULARY.noticeInfo} (전자상거래 필수 표기)</legend>
      <AdminFormGrid>
        {GOODS_NOTICE_FIELDS.map((field) => field.key === 'origin' ? <GoodsOriginField key={field.key}
          defaultValue={notice?.origin ?? ''} error={state.errors?.noticeOrigin}
          label={`${field.label}${locked ? ' · 공개 중 잠금' : ' (필수)'}`} readOnly={locked} required={required} disabled={originFinderDisabled} /> : (
          <Field
            defaultValue={notice?.[field.key] ?? ''}
            error={state.errors?.[field.formName]}
            key={field.key}
            label={`${field.label}${locked && field.formName in GOOD_PUBLISHED_LOCKS ? ' · 공개 중 잠금' : ' (필수)'}`}
            readOnly={locked && field.formName in GOOD_PUBLISHED_LOCKS}
            name={field.formName}
            placeholder={field.placeholder}
            required={required}
          />
        ))}
      </AdminFormGrid>
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
      <div className="flex min-w-0 flex-col gap-4 border-t px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-sm text-muted-foreground">
          지금 폼에 입력된 값으로 그린 화면입니다. 저장하기 전 모습이며, 미리보기는 카탈로그를 바꾸지 않습니다.
          KC 표는 마지막으로 저장해 검토를 완료한 자료만 표시합니다. 모델 관련 기본 정보·옵션을 저장해 검토가 무효화되면 KC를 다시 검토해야 합니다.
        </p>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">굿즈샵 목록 카드</span>
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
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{ADMIN_VOCABULARY.goods} 상세페이지</span>
          <div className="wc-root">
            <GoodDetailView detail={detail} embedded shippingPolicy={shippingPolicy} />
          </div>
        </div>
      </div>
  );
});

function GoodPreviewPanel(props: { detail: GoodDetailContent; ip: Ip | null; shippingPolicy?: GoodShippingPolicy | null }) {
  /* details 에 display 를 덮어쓰면 접힘이 깨지는 브라우저가 있어 기본 display 를 유지한다. */
  return <GoodWorkspaceDetails stateId="good-preview" id="good-preview" className="group/preview min-w-0 scroll-mt-24 rounded-xl border bg-card text-sm text-card-foreground" data-good-preview="">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-base font-medium outline-none select-none group-open/preview:rounded-b-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5 [&::-webkit-details-marker]:hidden">공개 화면 미리보기<ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open/preview:rotate-180 motion-reduce:transition-none" /></summary>
    <GoodPreviewContent {...props} />
  </GoodWorkspaceDetails>;
}

function OwnedFields({ locked, fields, values, children }: { locked: boolean; fields: readonly string[]; values: Record<string,string>; children: ReactNode }) {
  return <><fieldset disabled={locked} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">{children}</fieldset>
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
/** 상품 등록 방식 탭(셸의 콘솔 전환과 같은 구분 선택 모양). */
const EDITOR_TAB_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';
/** 저장 막대 버튼의 좁은 화면 크기. */
const SAVE_BAR_BUTTON_CLASS = 'max-md:h-7 max-md:gap-1 max-md:px-1.5 max-md:text-[0.8rem]';
const SHARED_QUANTITY_FIELDS = ['orderQuantityLimitEnabled','minOrderQty','maxOrderQty','memberPurchaseLimitEnabled','memberLifetimeQtyLimit'];

function GoodEditorForm({ ownership, accountId, action, catalogIps, ipOptions, pending, selected, state, initialIpId, variants, origins, noticeDefaults, categories, shippingNoticeOptions, regionSummaries, formRef, onSubmitCapture, onApplyKcTemplate, onSaveLocalDraft, onLoadServerDraft, onEditingStateChange, onPublishOnSaveChange, canSearchErp = true, canActivatePreorders = false, listHref = '/admin/catalog/goods', readiness = null, kcSlot = null, preorderSlot = null, restoredFromBrowser = false }: {
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
  /** 저장 막대의 저장 후 공개가 보이는지. 판매 준비 카드가 공개 버튼을 저장 막대로 넘길 때 쓴다. */
  onPublishOnSaveChange?: (visible: boolean) => void;
  onSaveLocalDraft: (form: HTMLFormElement) => boolean; onLoadServerDraft: (draft: GoodsDraft) => void; listHref?: string;
  /** 서버의 판매 준비 판정. 저장된 상품의 KC 완료 여부와 공개 보류 안내에 쓴다. */
  readiness?: AdminGoodsReadiness | null;
  /** 고시 카드 안, 고시 입력 바로 아래에 놓일 KC 영역. */
  kcSlot?: ReactNode;
  /** 판매 정보 카드 안, 판매기간 바로 뒤에 놓일 예약판매 영역(등록 화면은 함께 저장, 저장된 상품은 별도 저장 패널). */
  preorderSlot?: ReactNode;
  /** 브라우저 자동복구로 되살린 입력이다(KC·예약판매는 복구되지 않는다). */
  restoredFromBrowser?: boolean;
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
  /* 임시저장 결과. 성공했으면 직전 저장 실패 안내를 함께 보이지 않는다(최근 결과 하나만). 저장을 다시 시도하면 폼이 다시 마운트돼 사라진다. */
  const [localSaveMessage, setLocalSaveMessage] = useState<{ text: string; ok: boolean } | null>(null);
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
    draftOperation.current = true; setDraftBusy(true); setLocalSaveMessage(null);
    if (asNew || !newDraftId.current) newDraftId.current = crypto.randomUUID();
    const identity = !asNew && draftIdentity ? draftIdentity : { id: newDraftId.current, revision: 0 };
    try {
      const result = await saveGoodsDraftAction(identity, collectGoodsDraftValues(submitted));
      if (!result.data) { setLocalSaveMessage({ text: result.error ?? '임시저장하지 못했습니다. 입력은 유지됩니다.', ok: false }); return; }
      setDraftIdentity({ id: result.data.id, revision: result.data.revision });
      baselineFingerprint.current = goodEditorFingerprint(submitted);
      recoveryUnsaved.current = false;
      const current = readAdminFormData(form);
      if (current) setDirty(goodEditorFingerprint(current) !== goodEditorFingerprint(submitted));
      setLocalSaveMessage({ text: '입력 내용을 내 계정에 임시저장했습니다. 다른 기기에서도 불러올 수 있습니다.', ok: true });
    } catch { setLocalSaveMessage({ text: '저장 여부를 확인하지 못했습니다. 임시저장 불러오기에서 확인해주세요. 입력은 유지됩니다.', ok: false }); }
    finally { draftOperation.current = false; setDraftBusy(false); }
  }
  const draftSaved = Boolean(localSaveMessage?.ok);
  const [missingAttributes, setMissingAttributes] = useState<readonly string[]>([]);
  const collectedErrors: Record<string, string | undefined> = draftSaved ? {} : { ...state.errors, ...clientErrors };
  /* 빠졌던 필수 상품속성을 채우면 다음 저장을 기다리지 않고 오류를 지운다. */
  const errors = collectedErrors.productAttributes?.includes('필수 상품속성') && !missingAttributes.length ? { ...collectedErrors, productAttributes: undefined } : collectedErrors;
  /* 방금 공개했는지. 공개 버튼은 저장 폼 밖이라 저장 막대의 지난 저장 안내가 남는다. */
  const publishedNow = Boolean(selected?.publishedAt);
  const [publishedBefore, setPublishedBefore] = useState(publishedNow);
  const [justPublished, setJustPublished] = useState(false);
  /* 공개 중이던 상품을 초안으로 바꾼 직후(잠금 안내의 초안 전환·판매 준비 카드의 되돌리기) 잠금이 풀렸다고 알린다. */
  const [justUnpublished, setJustUnpublished] = useState(false);
  if (publishedBefore !== publishedNow) { setPublishedBefore(publishedNow); setJustPublished(publishedNow); setJustUnpublished(!publishedNow); }
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
  /* 등록 화면 KC(기타 인증 포함)·예약판매 입력은 폼 밖이라 폼 지문에 잡히지 않는다. 떠나기 경고에는 함께 센다. */
  const sectionsDirty = Boolean(atomicSections && (atomicSections.sections.kc.models.length || atomicSections.sections.kc.attested || atomicSections.sections.preorders.length
    || atomicSections.sections.otherCertifications?.length));
  useAdminLeaveGuard({ dirty: (dirty || sectionsDirty) && !pending && !draftBusy, message: ADMIN_LEAVE_RECOVERABLE_MESSAGE });
  const [suggestedCode, setSuggestedCode] = useState(selected?.code ?? '');
  const setRows: Dispatch<SetStateAction<GoodsOptionRow[]>> = useCallback((update) => {
    setValues((current) => {
      const currentRows = restoreGoodsOptionRows(current.variants)!;
      const next = typeof update === 'function' ? update(currentRows) : update;
      /* 랜덤 판매 상품은 새로 판매 중이 된 옵션에 공통 배정 상한을 물려준다(없으면 커밋에서 random_option_limit_mismatch). */
      return { ...current, variants: JSON.stringify(randomSale ? inheritRandomOptionLimits(currentRows, next) : next) };
    });
  }, [randomSale]);
  /* 0901-015: 새 재고 칸은 빈 값으로 시작한다. 비어 있으면 합계 대신 미입력을 말한다(0은 직접 입력한 값이다). */
  const stockMissing = goodsOptionStockMissing(rows);
  const stockSummary = isSingleGoodsOption(rows) ? `옵션 없음 · 재고수량 ${stockMissing ? '미입력' : `${goodsOptionStockTotals(rows).total.toLocaleString('ko-KR')}개`}`
    : `옵션 ${rows.length.toLocaleString('ko-KR')}개 · 재고수량 합계 ${goodsOptionStockTotals(rows).total.toLocaleString('ko-KR')}개${stockMissing ? ` · 미입력 ${stockMissing.toLocaleString('ko-KR')}개` : ''}`;
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
    setLocalSaveMessage(null);
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
    /* 소속 폼을 뗀 예약판매 입력(GOOD_DETACHED_FORM_ID)의 검증은 그 패널 저장의 것이다. 상품 저장 오류로 바꾸거나 말풍선을 막지 않는다. */
    const target = event.target as { form?: HTMLFormElement | null } | null | undefined;
    if (target && 'form' in target && target.form !== event.currentTarget) return;
    event.preventDefault();
    setLocalSaveMessage(null);
    const invalid = Array.from(event.currentTarget.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.willValidate && !element.validity.valid);
    const fieldErrors: Record<string, string> = {};
    for (const input of invalid) {
      const artworkName = input.closest('[data-artwork-upload-field]')?.querySelector<HTMLInputElement>('input[type="hidden"][name]')?.name;
      /* 이름 없이 JSON으로 제출하는 입력(옵션별 구매 제한 표)은 data-error-field로 자기 섹션의 오류 칸에 붙인다. */
      const name = input.name || artworkName || input.dataset.errorField || (input.closest('[data-option-editor]') ? 'variants' : 'form');
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
    if (kcTemplate === undefined) return;
    /* TKT-006·TKT-086: 등록 화면은 KC 틀을 같은 화면 KC 입력의 새 미검토 모델로 바로 채운다. 함께 저장해도 남고, 저장된 상품용 대기 틀은 둘 필요가 없다. */
    if (atomicSections) {
      if (kcTemplate) atomicSections.setSections((current) => {
        const kc = goodWorkspaceKcWithTemplate(current.kc, kcTemplate);
        return kc ? { ...current, kc } : current;
      });
      onApplyKcTemplate?.(null);
      return;
    }
    onApplyKcTemplate?.(kcTemplate);
  }
  /*
   * 공개 미리보기·상세 HTML 정리는 무겁다(R19). 입력과 무관한 상태 변화(오류·안내·업로드 진행)에는 다시 계산하지 않고,
   * 입력 변화도 지연 값으로 받아 입력칸 응답을 먼저 그린 뒤 미리보기를 낮은 우선순위로 다시 그린다.
   */
  const previewValues = useDeferredValue(values);
  const previewImageUrls = useDeferredValue(imageUrls);
  const { ip: previewIp, detail: previewDetail, shippingPolicy } = useMemo(() => buildGoodEditorPreview({
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
  const errorCount = (...keys: GoodEditorSectionKey[]) => GOOD_EDITOR_SECTIONS.filter((section) => keys.includes(section.key)).reduce((count, section) => count + section.fields.filter((field) => errors[field]).length, 0);
  /* KC 완료: 등록 화면은 함께 저장할 입력, 저장된 상품은 서버의 판매 준비 판정이다. 아래 필수 표시는 안내일 뿐 공개 판정은 서버가 한다. */
  const kcDone = selected ? readiness?.publicReview === 'current' : Boolean(atomicSections?.sections.kc.attested && atomicSections.sections.kc.models.length);
  const published = Boolean(selected?.publishedAt);
  /* 공개 중인 상품은 공개 조건을 이미 통과했다. 재고 0(품절)과 기존 공개 · KC 미기록은 미입력이 아니고, 서버가 KC 재검토를 요구할 때만 남은 칸으로 센다. */
  const requirements = goodPublishRequirements({ values, regularPrice: priceResult.regularPrice, hasStock: published || rows.some((row) => row.isActive !== false && row.stockQty > 0), kcDone: published ? readiness?.publicReview !== 'required' : kcDone, missingAttributes });
  const remainingByCard = goodRemainingByCard(requirements);
  const remaining = requirements.filter((item) => !item.done);
  const showPublishProgress = !published && !selected?.archivedAt;
  /* 필수 입력 진행은 섹션 이동 띠 한 곳에서 보인다. 입력 완료 표시는 초안과 공개 중인 상품이 같다. */
  const showCardProgress = !selected?.archivedAt;
  /* 저장 후 공개는 이름대로 공개될 때만 보인다: 저장할 입력이 있고, 공개 조건을 채웠고, 이번 저장이 KC 검토를 되돌리지 않을 때. 나머지 공개는 판매 준비 카드가 맡는다. */
  const kcContextChanged = Boolean(selected && !published && kcDone && dirty && goodKcContextChanged(lockedValues, values, initialGoodsOptionRows(variants, Number(lockedValues.price)), rows));
  const publishOnSave = Boolean(selected) && showPublishProgress && dirty && !remaining.length && !kcContextChanged;
  useEffect(() => { onPublishOnSaveChange?.(publishOnSave); }, [publishOnSave, onPublishOnSaveChange]);
  /* 저장할 변경이 없으면 저장하기는 초안·공개 중 어느 상품에서나 같은 보조 모양이다. 입력이 바뀌면 다시 주 색이 된다. */
    function changeCustomInputs(customInputs: string) { setValues((current) => ({ ...current, customInputs })); setDirty(true); }
  /* 대표 카테고리에서 유형을 제안한다. 이미 고른 유형은 그대로 두고, 값 목록은 서버 계약(GOOD_TYPES)이다. */
  const suggestedType = categoryId && !values.type && !locked && !groupOwned ? goodTypeSuggestion(categoryPath(categories, categoryId)) : null;
  function applySuggestedType(type: string) {
    const input = editorRef.current?.elements.namedItem('type');
    if (input instanceof HTMLSelectElement) { input.value = type; input.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  const noticeFilled = GOODS_NOTICE_FIELDS.filter((field) => values[field.formName]?.trim()).length;
  const origin = origins.find((item) => item.id === values.originId);
  const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
  const shippingFee = values.shippingFeeType === 'free' ? '무료배송' : values.shippingFeeType === 'individual' ? `개별 배송비 ${won(Number(values.individualFee) || 0)}`
    : origin ? `출고지 정책(기본 ${won(origin.baseFee)}${origin.freeThreshold === null ? '' : ` · ${won(origin.freeThreshold)} 이상 무료`})` : '출고지 정책';
  const shippingNotice = values.shippingNoticeTemplate ? shippingNoticeOptions.find((option) => `${option.code}@${option.version}` === values.shippingNoticeTemplate)?.name ?? '선택한 안내' : '기본 안내';
  const shippingDefault = values.shippingFeeType === 'policy' && !values.shippingNoticeTemplate && values.originId === DEFAULT_FULFILLMENT_ORIGIN_ID && Boolean(origin);
  /* KC를 끝낸 뒤에도 지난 공개 보류 안내가 남지 않게 지금 서버 판정을 함께 본다. */
  const kcBlockedVisible = Boolean(state.kcPublishBlocked && state.message && !published && readiness?.publicReview !== 'current' && !draftSaved);
  const statusLabel = pending ? '저장 중…' : draftSaved ? '임시저장 완료' : Object.keys(errors).some((key) => errors[key]) ? '저장 실패 · 입력값 유지' : dirty ? '미저장 변경 있음'
    : kcBlockedVisible ? '초안 저장 완료 · 공개 보류' : state.kcPublishBlocked ? (published ? '저장된 내용과 같음' : '기본 상품 저장 완료') : state.message ? '기본 상품 저장 완료' : selected ? '저장된 내용과 같음' : '새 초안 · 아직 저장 전';
  /* 저장 다음에 무엇을 하는지 저장 안내를 열지 않아도 보이게 한다. */
  const kcLink = <a className="text-foreground underline underline-offset-4" href="#good-operation-kc" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-kc'); }}>KC 정보로 이동</a>;
  const kcIsNextStep = Boolean(selected && readiness && !kcDone);
  /* 남은 것이 KC 하나면 아래 다음 단계 문장이 이미 말한다. 같은 일을 저장 막대에 두 번 적지 않는다. */
  const showRemainingCount = showPublishProgress && remaining.length > 0 && !(kcIsNextStep && remaining.length === 1 && remaining[0].key === 'kc');
  const nextStep: ReactNode = selected?.archivedAt ? null : published ? <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />저장하면 공개 중인 상품 화면에 바로 반영됩니다.</span>
    : !selected ? '다음 단계: 저장하면 화면 맨 위에 판매 준비가 열리고, 거기서 공개합니다.'
    : kcIsNextStep ? <>KC 검토를 마치면 공개할 수 있습니다. {kcLink}</>
    : kcContextChanged ? '바꾼 상품명·유형·IP·고시정보나 옵션을 저장하면 KC를 다시 검토해야 공개할 수 있습니다.'
    : remaining.length ? '필수 입력을 마치면 공개할 수 있습니다.'
    : publishOnSave ? '저장 후 공개를 누르면 수정한 내용까지 고객 화면에 공개됩니다.' : <>화면 맨 위 판매 준비에서 공개할 수 있습니다. <a className="text-foreground underline underline-offset-4" href="#good-operation-publish" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-publish'); }}>판매 준비로 이동</a></>;
  const saveIsPrimary = !selected || dirty;
  /* 말풍선은 다른 곳을 누르면 닫는다. 열린 채 남으면 입력칸을 가린다. 펼침 기록은 toggle 이벤트가 맡는다. */
  function closeSaveInfo(event: ReactPointerEvent<HTMLFormElement>) {
    const info = event.currentTarget.querySelector<HTMLDetailsElement>('[data-good-save-info][open]');
    if (info && !info.contains(event.target as Node)) info.open = false;
  }
  const showTabs = groupGoodsEntryVisible() && !selected;
  return <>
    {/* R21(D9①): 그룹상품 등록은 메뉴 숨김과 짝으로 숨기고 라우트(/admin/catalog/groups/new)만 유지한다. 탭이 하나뿐이면 줄을 그리지 않는다. */}
    {showTabs ? <nav aria-label="상품 등록 방식" data-good-editor-tabs=""><span className="inline-flex rounded-lg bg-muted p-0.5"><span aria-current="page" className={EDITOR_TAB_CLASS}>상품 등록</span>
        <Link className={EDITOR_TAB_CLASS} href="/admin/catalog/groups/new?mode=assemble" aria-disabled={pending || draftBusy} onNavigate={event => {
          if (pending || draftBusy) event.preventDefault();
        }}>그룹상품 등록</Link></span></nav> : null}
    <GoodWorkspaceNavigation errors={goodErrorsByCard(errors)} remaining={showCardProgress ? remainingByCard : undefined} remainingTone={selected ? 'warning' : 'neutral'} />
    {/* 키보드로 옮긴 입력칸이 위 고정 섹션 내비·아래 고정 저장 영역에 가리지 않게 위아래 여백을 둔다(섹션 자체는 scroll-mt). */}
    <form action={action} className="flex min-w-0 flex-col gap-4 [&_:is(input,select,textarea,button,summary,a)]:scroll-my-32" data-good-workspace-form="" onInputCapture={() => setLocalSaveMessage(current => current ? null : current)} onInvalidCapture={showInvalidFields} onPointerDownCapture={closeSaveInfo} onSubmitCapture={submit} ref={attachForm}>
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
      <input name="published" type="hidden" value={String(Boolean(selected?.publishedAt))} />
      <input name="bg" type="hidden" value={selected?.bg ?? ''} />
      {!selected && draftIdentity ? <><input type="hidden" name="serverDraftId" value={draftIdentity.id}/><input type="hidden" name="serverDraftRevision" value={draftIdentity.revision}/></> : null}
      {/* 제출 capture 단계에서 값을 쓴다. defaultValue를 주면 그 사이 재렌더가(실제 클릭은 capture와 bubble 사이에 마이크로태스크가 돈다) value 속성을 다시 비워 FormData에 빈 값이 실린다. */}
      {atomicSections ? <><input type="hidden" name={GOOD_WORKSPACE_OPERATION_FIELD} /><input type="hidden" name={GOOD_WORKSPACE_SECTIONS_FIELD} /></> : null}
      <GoodWorkspaceErrors errors={errors} />

      {/* 1. 기본 정보 */}
      <GoodEditorSection title="기본 정보" id="good-section-basic" summary={values.name || '상품명 미입력'} errorCount={errorCount('category', 'basic', 'attributes')}>
        <div className="min-w-0 scroll-mt-24 outline-none" id="good-section-category" tabIndex={-1}>
          <OwnedFields locked={groupOwned} fields={['categoryId']} values={initial}><GoodCategoryField categories={categories} primary={categoryId} onPrimaryChange={setCategoryId} error={errors.categoryId} /></OwnedFields>
        </div>
        {/* TKT-009: 잠금 안내의 버튼 하나 → 확인창 1회 → 바로 초안 전환·잠금 해제. 판매 준비 카드의 초안으로 되돌리기와 같은 서버 계약이다. */}
        {locked && selected && <div className="flex min-w-0 flex-col gap-2" data-good-lock=""><AdminNotice title="공개 중 잠금: 상품명·유형·연결 IP·제조자·제조국·소재·크기" tone="neutral">실제 모델과 검토 근거를 일치시키기 위한 잠금입니다. 초안으로 전환 후 수정하고 KC를 재검토해야 재공개할 수 있습니다.</AdminNotice>
          <div><GoodDraftSwitch id={selected.id} disabled={pending || draftBusy || Boolean(selected.archivedAt)} /></div></div>}
        {justUnpublished && !locked ? <div data-good-unlocked=""><AdminNotice tone="info" title="초안으로 전환했습니다"><span role="status">고객 화면에서 내려갔고 잠긴 항목을 고칠 수 있습니다. 저장한 뒤 KC를 다시 검토해야 공개할 수 있습니다.</span></AdminNotice></div> : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Field readOnly={locked || groupOwned} defaultValue={initial.name} error={errors.name} label={locked ? '상품명 · 공개 중 잠금' : '상품명 (필수)'} name="name" />
          {selected ? null : <p className="text-xs text-muted-foreground">상품명만 입력해도 등록 중인 상품을 임시저장할 수 있습니다.</p>}
        </div>
        <div className={locked || groupOwned ? GOOD_LOCKED_SELECTS_CLASS : 'min-w-0'}><AdminFormGrid>
          <SelectField defaultValue={initial.ipId} error={errors.ipId} label={locked ? "연결 IP · 공개 중 잠금" : "연결 IP (필수)"} disabled={locked || groupOwned} name="ipId"><option value="">선택</option>{ipOptions.map((ip) => <option disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)} key={ip.id} value={ip.id}>{ip.archivedAt ? `[보관] ${ip.title}` : ip.title}</option>)}</SelectField>
          {(locked || groupOwned) && <input type="hidden" name="ipId" value={initial.ipId} />}
          <SelectField defaultValue={initial.type} error={errors.type} label={locked ? "유형 · 공개 중 잠금" : "상품 유형 (필수)"} disabled={locked || groupOwned} name="type"><option value="">선택</option>{GOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</SelectField>
          {(locked || groupOwned) && <input type="hidden" name="type" value={initial.type} />}
        </AdminFormGrid></div>
        {suggestedType ? <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground" data-good-type-suggestion="">카테고리 기준 추천 유형 <button className={buttonVariants({ variant: 'soft', size: 'sm' })} data-slot="button" onClick={() => applySuggestedType(suggestedType)} type="button">{suggestedType} 선택</button></p>
          : categoryId && !values.type && !locked && !groupOwned ? <p className="text-xs text-muted-foreground">맞는 유형이 없으면 ‘기타’를 고릅니다.</p> : null}
        {/*
          ADM-004(복잡도 표 190행): 용어 도움말은 고르는 동안(연결 IP·유형이 비어 있을 때)만 보인다. 입력칸이 아니라 안내 문구라 ADM-004 "복잡함 줄이기"
          지시 범위다 — 묶음 10의 "펼친 채로" 원칙은 입력 섹션 대상이라 여기에 걸리지 않는다(오케스트레이터 판단, T15a 리뷰).
        */}
        {!locked && !groupOwned && (!values.ipId || !values.type) ? <p className="-mt-2 text-xs text-muted-foreground" data-good-identity-help="">연결 IP는 브랜드·작품, 카테고리는 쇼핑 분류, 유형은 상품의 형태입니다.</p> : null}
        {canSearchErp && values.ipId && <a className="w-fit text-sm underline underline-offset-4" href={`/admin/catalog/ips/${encodeURIComponent(values.ipId)}`} target="_blank" rel="noreferrer">연결 IP의 공개 상태 확인 (새 탭)</a>}
        <div className="min-w-0 scroll-mt-24 outline-none" id="good-section-attributes" tabIndex={-1}>
          <OwnedFields locked={groupOwned} fields={[]} values={initial}><GoodsAttributeEditor categoryId={categoryId} goodId={selected?.id ?? null} initialSubmission={initial.productAttributes} initialDraft={initial.productAttributeDraft} error={errors.productAttributes} onChange={onAttributeChange} onRequiredMissing={setMissingAttributes} /></OwnedFields>
        </div>
      </GoodEditorSection>

      {/*
        2. 판매 정보: 판매가 → 할인 → 재고수량 → 옵션 순서는 회귀 금지(MD 피드백). 그 뒤 판매기간 → 예약판매 → 구매 제한을 접지 않고 펼쳐 둔다
        (11/11 ADM-011·1027T-021·1027T-023 결정 "둘 다 펼친 채로" — 10/27 회의 R12·R13 원안).
      */}
      <GoodEditorSection title="판매 정보" id="good-section-price" errorCount={errorCount('price', 'variants', 'period', 'limits') + (errors.workspacePreorders ? 1 : 0)} summary={`판매가 ${priceResult.regularPrice ? formatWon(priceResult.regularPrice) : '미입력'}${priceDraft.discountEnabled ? priceResult.discountAmount > 0 && priceResult.salePrice !== null ? ` · 할인가 ${formatWon(priceResult.salePrice)}` : ' · 할인 입력 확인' : ' · 할인 없음'}${dirty ? ' · 미저장 입력' : ''}`}>
        <GoodsPriceFields draft={priceDraft} onDraftChange={setPriceDraft} result={priceResult} errors={errors} />
        <div className="flex min-w-0 scroll-mt-24 flex-col gap-3 border-t pt-5 outline-none" id="good-section-variants" tabIndex={-1}>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h4 className="text-sm font-medium text-foreground">재고수량 / 옵션</h4><span className="text-xs text-muted-foreground">{stockSummary}</span></div>
          <GoodsOptionEditor structureLocked={groupOwned} onRowsChange={setRows} codePrefix={values.code || suggestedCode} rows={rows} baseline={baseline} basePrice={priceResult.salePrice ?? 0}
            priceDraft={priceDraft} error={errors.variants} axisValues={initial}
            savedCodes={{ goodCode: selected?.code ?? null, options: variants }}
            optionImport={{ accountId, target: selected ? { ...selected, variants } : null, databaseVersion: JSON.stringify([selected, variants]),
              categories: categories.filter(category => !category.archivedAt).map(category => ({ id: category.id, name: `${'　'.repeat(Math.max(0, category.depth - 1))}${category.name}` })),
              pending: pending || draftBusy, blockedReason: groupOwned ? '그룹 구성에서 옵션을 관리합니다.' : selected?.archivedAt ? '보관된 상품에는 옵션을 불러올 수 없습니다.' : locked ? '다른 상품 옵션을 불러오려면 먼저 상품을 비공개 초안으로 전환해주세요.' : null,
              onApplied: () => { setDirty(true); setOptionImportRevision(value => value + 1); } }}
            canSearchErp={canSearchErp} onErpItemSelect={groupOwned ? undefined : applyErpItem} onRegularPriceApply={(price) => setPriceDraft((current) => ({ ...current, regularPrice: String(price) }))}
            erpNotice={<GoodsErpCategoryNotice suggestion={erpCategory} currentCategoryId={categoryId} onReplace={setCategoryId} onReview={() => focusGoodWorkspaceTarget('good-section-category', 'categoryId')} />} />
        </div>
        <GoodEditorSubsection title="판매기간" id="good-section-period" errorCount={errorCount('period')} summary={values.salePeriodEnabled === 'true' ? `${values.saleStartsAt?.replace('T', ' ') || '시작 미입력'} ~ ${values.saleEndsAt?.replace('T', ' ') || '종료 미입력'} · 한국시간` : '설정안함'}>
          <GoodsSalePeriodFields values={values} error={errors.saleStartsAt} onChange={patch => { setValues(current => ({ ...current, ...patch })); setDirty(true); }} />
        </GoodEditorSubsection>
        {/* 예약판매 입력은 이름이 없고 소속 폼을 뗐다(GOOD_DETACHED_FORM_ID). Enter로 상품이 저장되지 않게 막고, 자동복구는 이 안의 입력을 수정으로 세지 않는다. */}
        {preorderSlot ? <div className="contents" data-good-preorder-slot="" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>{preorderSlot}</div> : null}
        <GoodsPurchaseLimitFields quantityReadOnly={aggregationOwned} values={initial} current={values} errors={errors} rows={rows} onRowsChange={setRows} randomSale={randomSale} />
      </GoodEditorSection>

      {/* 3. 상품이미지: 썸네일 그리드·클릭 교체·X 삭제·드래그 정렬·추가 이미지 9장은 그대로 둔다. */}
      <GoodEditorSection title="상품이미지" id="good-section-images" requirement="대표이미지 (필수) · 추가이미지 (선택)" summary={`대표이미지 ${values.imagePath ? '등록됨' : '미등록'} · 추가이미지 ${Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => values[`galleryPath${i}`]).filter(Boolean).length}장`} errorCount={errorCount('images')}>
        <GoodsImageGrid accountId={accountId} recordId={selected?.id ?? 'new'} editingDisabled={pending || draftBusy || Boolean(selected?.archivedAt)} publication={selected?.archivedAt ? 'archived' : locked ? 'published' : 'draft'} errors={errors} initialPaths={GOODS_IMAGE_FIELD_NAMES.map((name) => initial[name])} initialUrls={GOODS_IMAGE_FIELD_NAMES.map((name) => imageUrls[name])} onPreviewChange={setImageUrl} />
      </GoodEditorSection>

      {/*
        4. 상세설명: 카드 안 접힘 없이 형식 선택과 입력을 바로 둔다(요약 한 줄은 카드 머리에). 입력 섹션은 펼친 채로 둔다 — 11/11 묶음 10 결정
        "둘 다 펼친 채로 … 남은 등록 화면 정리(ADM-004)도 이 원칙"에 따라 복잡도 표 168행의 처리안(카드 기본 접힘)은 채택하지 않는다.
      */}
      <GoodEditorSection title="상세설명" id="good-section-description" summary={htmlDescription && descriptionCheck ? `상세페이지 HTML · 원문 ${rawDescriptionLength.toLocaleString('ko-KR')}자 · 정리 후 ${descriptionCheck.html.length.toLocaleString('ko-KR')}자` : values.description ? `일반 텍스트 · ${rawDescriptionLength.toLocaleString('ko-KR')}자` : '입력 안 함'} errorCount={errorCount('description')}>
        <OwnedFields locked={groupOwned} fields={['description','descriptionFormat']} values={initial}>
          <SelectField defaultValue={initial.descriptionFormat} error={errors.descriptionFormat} label="상세 설명 형식" name="descriptionFormat"><option value="plain">일반 텍스트</option><option value="html">HTML 문서 (상세페이지 소스)</option></SelectField>
          <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-4" data-good-html-tools="" hidden={!htmlDescription}>
            <p className="text-sm text-muted-foreground">다른 판매처에 쓰는 상세페이지 HTML 소스를 그대로 붙여넣을 수 있습니다. https로 시작하는 호스팅 이미지 주소는 그대로 표시되므로 호스팅 이미지를 바꾸면 이 상세페이지에도 반영됩니다. 제목·문단·목록·표·강조·링크와 아래 도구의 정렬·글자 크기·인용·구분선 서식을 지원합니다. 임의 CSS·스크립트·이벤트는 제거됩니다.</p>
            <div className="flex flex-wrap gap-2">
              <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => insertDescription('<h2>제목</h2>\n')} type="button">제목 넣기</button>
              <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => insertDescription('<p>문단 내용</p>\n')} type="button">문단 넣기</button>
              <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => insertDescription('<ul><li>항목</li></ul>\n')} type="button">목록 넣기</button>
              <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" onClick={() => insertDescription('<table><caption>표 제목</caption><tbody><tr><th scope="row">항목</th><td>내용</td></tr></tbody></table>\n')} type="button">표 넣기</button>
            </div>
            <GoodsDescriptionTools accountId={accountId} formRef={editorRef} disabled={groupOwned || !htmlDescription || pending || draftBusy || Boolean(selected?.archivedAt)} />
          </div>
          <TextArea defaultValue={initial.description} error={errors.description} label={htmlDescription ? `상세페이지 HTML (정리된 코드 포함 최대 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자)` : '상세 설명 (최대 2,000자)'} maxLength={htmlDescription ? undefined : GOODS_DESCRIPTION_MAX_LENGTH} name="description" placeholder={htmlDescription ? '<h2>상품 특징</h2><p>상세 내용을 입력해주세요.</p>' : adminGoodsCopy('굿즈 구성과 특징을 짧게 설명해주세요.')} />
          {descriptionWarnings.length > 0 && <div data-good-html-review=""><AdminNotice role="status" title="저장 전 확인: 입력 원문은 편집기에 남아 있으며 아래 미리보기의 결과가 저장됩니다." tone="warning"><ul className="flex list-disc flex-col gap-1 pl-5 wrap-anywhere">{descriptionWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></AdminNotice></div>}
          <fieldset className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-4" data-good-html-tools="" disabled={!htmlDescription} hidden={!htmlDescription}>
            <ArtworkUploadField autoUpload allowRemove currentPath={initial.descriptionUploadPath || null} currentUrl={initial.descriptionUploadPath ? publicMediaUrl(initial.descriptionUploadPath) : null} fieldId="good-description-image" helpText="이미지 검증이 끝나면 대체 설명을 적고 설명에 넣기를 누릅니다. HTML 본문에는 최대 20장을 넣을 수 있습니다." kind="good" label="HTML 이미지 업로드" name="descriptionUploadPath" />
            <Field defaultValue={initial.descriptionImageAlt} label="HTML 이미지 대체 설명" name="descriptionImageAlt" maxLength={300} />
            <button className={`${buttonVariants({ variant: 'outline' })} self-start`} data-slot="button" onClick={() => insertDescription()} type="button">업로드한 이미지를 설명에 넣기</button>
            <p className="text-sm text-muted-foreground">호스팅 이미지 주소(https://…)는 업로드 없이 HTML에 그대로 쓰면 됩니다. http 주소는 https로 바꿔 저장합니다. 호스팅하지 않은 이미지만 파일을 업로드한 후 넣어주세요. 아래 상품 미리보기에서 공개될 결과를 확인할 수 있습니다.</p>
          </fieldset>
        </OwnedFields>
        <GoodOptionalFields id="good-optional-detail-image" title="긴 상세 이미지 (선택)" summary={values.detailImagePath ? '이미지 연결됨' : '이미지 없음'} hasErrors={Boolean(errors.detailImagePath)}>
          <ArtworkUploadField compact showPath={false} showGuidance={false} showCropGuide={false} autoUpload allowRemove currentPath={initial.detailImagePath || null} currentUrl={imageUrls.detailImagePath} fieldId="good-detail" helpText="상세페이지(상세 설명) 아래에 원래 비율로 붙는 이미지 파일 1장입니다. 호스팅 HTML로 상세페이지를 만들었다면 비워 두어도 됩니다." kind="good" label="상세 이미지" name="detailImagePath" onPreviewChange={(url) => setImageUrl('detailImagePath', url)} />
          <ErrorText>{errors.detailImagePath}</ErrorText>
        </GoodOptionalFields>
      </GoodEditorSection>

      {/* 5. 상품정보제공고시 + KC: 고시 입력 바로 아래 KC. KC 입력에는 name이 없어 폼 제출·자동복구·임시저장에 실리지 않는다. */}
      <GoodEditorSection title={`${ADMIN_VOCABULARY.noticeInfo} · KC`} id="good-section-notice" errorCount={errorCount('notice')} summary={`${noticeFilled}/${GOODS_NOTICE_FIELDS.length}개 작성 · ${kcDone ? 'KC 완료' : 'KC 확인 필요'}`}>
        <OwnedFields locked={groupOwned} fields={GOODS_NOTICE_FIELDS.map(field => field.formName)} values={initial}><GoodNoticePicker onApply={applyNotice} readOnly={locked||Boolean(selected?.archivedAt)} suggestType={values.type && !locked && noticeFilled < GOODS_NOTICE_FIELDS.length ? values.type : ''} /><GoodsNoticeFields notice={notice} required={Boolean(selected?.publishedAt)} locked={locked} originFinderDisabled={pending || draftBusy || Boolean(selected?.archivedAt)} state={{ ...state, errors: errors as AdminCatalogActionState['errors'] }} /></OwnedFields>
        {kcSlot ? <div className="flex min-w-0 flex-col gap-3" data-good-kc-slot="" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
          {restoredFromBrowser && atomicSections && !kcDone ? <AdminNotice tone="warning" title="KC 입력은 복구되지 않았습니다">브라우저 자동복구에는 KC·예약판매 입력이 담기지 않습니다. 아래에서 다시 확인해주세요.</AdminNotice> : null}
          {kcSlot}
        </div> : null}
      </GoodEditorSection>

      {/* 6. 배송·반품·결제: 기본값 그대로면 건드릴 것이 없다. 입력은 접혀도 DOM에 남아 같은 값을 제출한다(반품 6칸은 함께 제출해야 지워지지 않는다). */}
      <GoodEditorSection title="배송·반품·결제" id="good-section-delivery" errorCount={errorCount('shipping', 'claims', 'sale')} summary={`${origin?.name ?? '출고지 확인 필요'} · ${shippingFee}`}>
        <GoodFoldedRow title="출고지·배송비" id="good-section-shipping" errorCount={errorCount('shipping')} isDefault={shippingDefault} defaultOpen={!initial.originId} summary={`${origin?.name ?? '출고지 확인 필요'} · ${shippingFee} · ${shippingNotice}`}>
          <OwnedFields locked={aggregationOwned} fields={SHARED_SHIPPING_FIELDS} values={initial}><GoodsFulfillmentFields regionSummaries={regionSummaries} origins={origins} value={{ originId: initial.originId || null, shippingFeeType: initial.shippingFeeType as 'policy' | 'free' | 'individual', individualFee: Number(initial.individualFee) }} errors={errors} /></OwnedFields>
          <GoodsShippingNoticeField options={shippingNoticeOptions} value={initial.shippingNoticeTemplate} error={errors.shippingNoticeTemplate} />
        </GoodFoldedRow>
        <GoodsClaimPolicyFields values={initial} current={values} errors={errors as Record<string, string>} />
        <GoodsSalePolicyFields values={initial} current={values} errors={errors} />
      </GoodEditorSection>

      {/* 7. 추가 설정(접힘): 대부분의 상품은 기본값 그대로다. 접혀도 입력은 DOM에 남는다. */}
      <GoodEditorSection title="추가 설정" id="good-section-information" defaultOpen={false} errorCount={errorCount('information')} summary={`표시문구 ${values.badge || '없음'} · ${ADMIN_STOCK_LABELS[values.stock as keyof typeof ADMIN_STOCK_LABELS] ?? '정상 판매'} · ${values.code || suggestedCode || '판매자상품코드 자동 생성'}`}>
        <AdminFormGrid>
          <SelectField defaultValue={initial.badge} error={errors.badge} label="상품 표시문구" name="badge"><option value="">없음</option>{GOOD_BADGES.map((badge) => <option key={badge} value={badge}>{badge}</option>)}</SelectField>
          <SelectField defaultValue={initial.stock} error={errors.stock} label="판매상태" name="stock">{Object.entries(ADMIN_STOCK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        </AdminFormGrid>
        <GoodsDiscountRateField value={initial.showDiscountRate} error={errors.showDiscountRate} />
        <OwnedFields locked={groupOwned} fields={['additionalCategoryIds']} values={initial}><GoodAdditionalCategoryField categories={categories} primary={categoryId} value={initial.additionalCategoryIds} error={errors.additionalCategoryIds} /></OwnedFields>
        <GoodsCustomInputEditor value={values.customInputs} revision={initial.customInputsExpectedRevision ?? '0'} error={errors.customInputs} onChange={changeCustomInputs} />
        <section className="flex min-w-0 flex-col gap-5 border-t pt-5" aria-labelledby="good-search-settings-title">
          <h4 className="text-sm font-medium text-foreground" id="good-search-settings-title">검색설정·판매자상품코드</h4>
          <AdminFormGrid>
            <Field readOnly={groupOwned} defaultValue={initial.nameEn} error={errors.nameEn} label="영문 상품명 (선택)" name="nameEn" maxLength={200} />
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
          <p className="text-sm text-muted-foreground">고객 통합 검색과 어드민 상품 검색에만 쓰이며, 공개 상세에는 표시하지 않습니다.</p>
          <GoodIdentifierFields code={initial.code} defaultVariantCode={initial.defaultVariantCode ?? variants.find((v) => v.isDefault)?.code} hideVariantCode onCodeSuggestion={setSuggestedCode} errors={errors as Record<string, string>} ipId={values.ipId} name={values.name} slug={initial.id} slugLocked={groupOwned || Boolean(selected?.firstPublishedAt)} />
        </section>
      </GoodEditorSection>

      {/* 셸 콘텐츠 패널 아래에 붙는 고정 저장 영역. 위치는 셸 변수(admin-kit.css)가 사이드바 폭·접힘·모바일에 맞춘다.
          ::after는 그 아래 패널 바깥 여백(셸 바탕색)을 채워, 저장 영역 아래로 스크롤 중인 내용이 비치지 않게 한다. */}
      <div className="fixed right-(--admin-content-inset) bottom-(--admin-content-inset) left-(--admin-content-left) z-20 grid min-w-0 grid-cols-1 items-center gap-x-4 gap-y-1.5 border-t bg-background px-4 py-2 after:pointer-events-none md:gap-y-2 md:py-3 after:absolute after:inset-x-0 after:top-full after:h-(--admin-content-inset) after:bg-sidebar md:px-6 xl:grid-cols-[minmax(10rem,1fr)_auto] print:hidden" aria-label="기본 상품 저장" data-good-workspace-save="">
        <div className="flex min-w-0 flex-col gap-0.5">
          <GoodWorkspaceDetails stateId="good-save-info" className="group/save-info relative min-w-0" data-good-save-info="" onKeyDown={(event) => { if (event.key === 'Escape' && event.currentTarget.open) { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary className="flex w-fit cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"><strong className="text-sm font-medium" role="status">{statusLabel}</strong><span className="text-xs text-muted-foreground underline underline-offset-4">저장 안내</span></summary>
            <div className="absolute bottom-[calc(100%+1.25rem)] left-0 z-30 flex w-[min(32.5rem,calc(100vw-2rem))] flex-col gap-2 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-md [&>p]:text-muted-foreground"><p>{atomicSections ? '기본 상품·이미지·옵션·고시·배송·구매 제한·판매 조건과 KC·예약판매 입력을 한 번에 저장합니다. 하나라도 실패하면 아무것도 저장되지 않고 입력은 유지됩니다. 나머지 설정은 저장 뒤 같은 자리에서 입력합니다.'
              : '기본 상품·이미지·옵션·고시·배송·구매 제한·판매 조건만 저장합니다. KC·재고 조정·혜택은 각 영역에서 별도 저장합니다.'}</p>
            <p>{selected ? '입력 임시저장은 현재 브라우저에 보관합니다.' : '임시저장은 내 계정에 최대 40건을 보관합니다. 업로드를 마친 이미지와 입력값을 불러올 수 있으며, 상품 등록·공개는 저장하기에서 따로 확정합니다.'} 브라우저 자동 복구도 함께 유지됩니다.</p>
            {dirty && <p>브라우저 복구 기록은 서버 저장이 아닙니다. KC·예약판매 입력은 복구되지 않습니다.</p>}
            {selected?.publishedAt && <p>저장하면 공개 중인 상품 화면에 반영됩니다.</p>}
            {/* ADM-004(복잡도 표 25·27행): 등록 화면의 순서 안내는 한 문장으로 줄이고, 저장된 초안의 순서는 판매 준비 카드(다음 할 일·판매 준비 안내)가 말한다. */}
            {atomicSections ? <p>KC까지 입력해 저장한 뒤 판매 준비에서 공개하며, KC를 검토 완료로 저장했더라도 그 뒤 상품명·유형·IP·고시정보(제조자·제조국·소재·크기)나 옵션 구성을 바꾸면 KC를 다시 검토합니다.</p> : null}
            </div>
          </GoodWorkspaceDetails>
          {nextStep ? <p className="text-xs text-muted-foreground" data-good-next-step="">{nextStep}</p> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:gap-2 xl:justify-end">
          {showRemainingCount ? <button className={`inline-flex items-center rounded-md px-1 text-xs font-medium tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 ${selected ? 'text-warning' : 'text-muted-foreground'}`} data-good-publish-remaining={remaining.length} onClick={() => focusGoodWorkspaceTarget(remaining[0].anchor, remaining[0].field)} title={`${remaining.map((item) => item.label).join(', ')} · 공개할 때 서버가 다시 확인합니다.`} type="button">공개까지 필수 {remaining.length}개 남음</button> : null}
          <button className={`${buttonVariants({ variant: 'outline' })} ${SAVE_BAR_BUTTON_CLASS} max-md:[&>svg]:hidden`} data-slot="button" type="button" onClick={() => { const preview = document.getElementById('good-preview'); if (preview instanceof HTMLDetailsElement) { preview.open = true; preview.scrollIntoView({ block: 'start', behavior: 'instant' }); preview.querySelector('summary')?.focus(); } }}><Eye aria-hidden="true" />미리보기</button>
          {selected ? <button className={`${buttonVariants({ variant: 'ghost' })} ${SAVE_BAR_BUTTON_CLASS}`} data-slot="button" data-good-draft-button="" type="button" disabled={pending} onClick={() => { if (editorRef.current) { const saved = onSaveLocalDraft(editorRef.current); setLocalSaveMessage({ text: saved ? '입력 내용을 이 브라우저에 임시저장했습니다.' : '브라우저에 임시저장할 수 없습니다. 저장하기를 이용해주세요.', ok: saved }); } }}>입력 임시저장</button> : <span className="inline-flex" role="group" aria-label="임시저장">
            <button className={`${buttonVariants({ variant: 'ghost' })} ${SAVE_BAR_BUTTON_CLASS} rounded-r-none`} data-slot="button" data-good-draft-button="" type="button" disabled={pending || draftBusy} onClick={() => { void saveServerDraft(); }}>{draftBusy ? '임시저장 중…' : '임시저장'}</button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger aria-label="임시저장 메뉴" className={`${buttonVariants({ variant: 'secondary', size: 'icon' })} rounded-l-none border-l border-l-background/60 max-md:size-7`} disabled={pending || draftBusy}><ChevronUp aria-hidden="true" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44" side="top">
                <DropdownMenuItem onClick={() => setDraftOpen(true)}>임시저장 불러오기</DropdownMenuItem>
                {draftIdentity ? <DropdownMenuItem onClick={() => { void saveServerDraft(true); }}>새 임시저장으로 저장</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>}
          {!attributesReady ? <span className="text-xs text-muted-foreground" role="status">상품속성 조회 후 저장할 수 있습니다.</span> : null}
          <button className={`${buttonVariants({ variant: saveIsPrimary ? 'default' : 'outline' })} md:min-w-24 ${SAVE_BAR_BUTTON_CLASS}`} data-slot="button" disabled={pending || draftBusy || !attributesReady || Boolean(selected?.archivedAt)} name="intent" value="save">{pending ? '저장 중…' : '저장하기'}</button>
          {publishOnSave && <button className={`${buttonVariants({ variant: 'outline' })} ${SAVE_BAR_BUTTON_CLASS}`} data-slot="button" disabled={pending || !attributesReady} name="intent" value="publish">저장 후 공개</button>}
          <Link className={`${buttonVariants({ variant: 'ghost' })} aria-disabled:pointer-events-none aria-disabled:opacity-50 ${SAVE_BAR_BUTTON_CLASS}`} data-slot="button" href={listHref} aria-disabled={pending || draftBusy} onNavigate={(event) => { if (pending || draftBusy) event.preventDefault(); }}>취소</Link>
        </div>
        {localSaveMessage ? <p className={`text-xs xl:col-span-2 ${localSaveMessage.ok ? 'text-success' : 'text-destructive'}`} role="status">{localSaveMessage.text}</p> : null}
        {justPublished && !dirty ? <AdminNotice className="xl:col-span-2" tone="success"><span role="status">공개했습니다. <a className="underline underline-offset-4" href={`/shop/${selected?.id}`} rel="noreferrer" target="_blank">고객 화면에서 보기</a></span></AdminNotice> : draftSaved ? null : kcBlockedVisible ? <AdminNotice className="xl:col-span-2" tone="warning"><span role="alert">{state.message}</span>{selected && <> <a href="#good-operation-kc" className="underline underline-offset-4" onClick={(event) => { event.preventDefault(); focusGoodWorkspaceTarget('good-operation-kc'); }}>KC 정보 열기</a></>}</AdminNotice> : state.kcPublishBlocked ? null : <div className="empty:hidden xl:col-span-2"><ActionNotice state={state} /></div>}
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
    linkedFields: GOOD_LOCAL_DRAFT_LINKED_FIELDS,
    /* KC·예약판매 입력은 복구 대상이 아니고 name도 없다. 폼 안에 있어도 "사용자 수정"으로 세지 않는다. */
    ignoreEditsWithin: '[data-good-kc-slot], [data-good-preorder-slot]',
  });
  const [serverRecovery, setServerRecovery] = useState<{ draft: GoodsDraft; attempt: number; version: number } | null>(null);
  const localState = withLocalRecoveryValues(props.state, props.selected?.id ?? null, local.snapshot.restoredValues);
  const state = !props.selected && serverRecovery && serverRecovery.attempt === (props.state.attempt ?? 0)
    ? { ...props.state, errors: undefined, message: undefined, values: { ...serverRecovery.draft.values, previousId: '', serverDraftId: serverRecovery.draft.id, serverDraftRevision: String(serverRecovery.draft.revision) } }
    : localState;
  useFocusFirstGoodError(props.state.attempt, state.errors);
  const showRecovery = Boolean(local.snapshot.recovery) && !preservedFormValues(props.state, props.selected?.id);
  return <>
    <AdminLocalDraftNotice onDiscard={local.discardRecovery} onRestore={() => { setServerRecovery(null); local.restore(); }} pending={props.pending}
      recovery={showRecovery} unavailable={local.snapshot.unavailable} />
    {/* 복구 기록에는 KC·예약판매 입력이 담기지 않는다(근거 참조 보호, DQ3). 조용히 비어 보이지 않게 미리 알린다. */}
    {showRecovery && !props.selected ? <p className="text-sm text-muted-foreground" role="note">KC·예약판매 입력은 복구되지 않습니다. 복구한 뒤 KC 정보를 다시 확인해주세요.</p> : null}
    <GoodEditorForm {...props} accountId={accountId} restoredFromBrowser={Boolean(local.snapshot.restoredValues)} state={state} formRef={local.formRef} onSubmitCapture={local.onSubmitCapture} onSaveLocalDraft={local.saveDraft}
      onLoadServerDraft={draft => { local.discard(); setServerRecovery(current => ({ draft, attempt: props.state.attempt ?? 0, version: (current?.version ?? 0) + 1 })); }}
      key={`${local.scopeKey}:${props.state.attempt ?? 0}:${local.snapshot.revision}:${serverRecovery?.version ?? 0}`} />
  </>;
}
