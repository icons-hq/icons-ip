import { GOODS_SALE_PERIOD_FIELDS, goodsSalePeriodPreview } from './goods-sale-period';
import { toKstDateTimeInput } from './goods-price-periods';
import type { AdminGoodRecord } from './catalog.server';
import type { AdminFormValuesState } from './form-state';
import { preservedFormValues } from './form-state';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { goodCompareAtPrice } from '@/lib/goods-options';
import { GOODS_GALLERY_MAX } from './catalog';
import { DEFAULT_FULFILLMENT_ORIGIN_ID } from './fulfillment-origins';
import { GOODS_CLAIM_POLICY_FIELDS } from './goods-claim-policy';
import { GOODS_SALE_POLICY_FIELDS } from './goods-sale-policy';
import type { AdminGoodsVariant } from './goods-variants';
import { initialGoodsOptionRows, restoreGoodsOptionRows } from './goods-option-editor';
import { GOODS_PRICE_DRAFT_FIELDS } from './goods-price-editor';
import { publicMediaUrl } from '@/lib/media';
import { buildGoodPreview } from './good-preview';
import type { Ip } from '@/lib/data';
import type { GoodsFulfillmentOrigin } from './fulfillment-origins';
import type { GoodShippingPolicy, ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { readGoodsClaimPolicy } from './goods-claim-policy';
import { readAdminGoodsCustomInputs } from './goods-custom-inputs';
import { EMPTY_GOODS_CUSTOM_INPUTS, parseGoodsCustomInputConfig } from '@/lib/goods-custom-inputs';
export type GoodNoticeDefaults = { asManager: string; asContact: string };
export const GOOD_LOCAL_DRAFT_FIELDS = ['serverDraftId', 'serverDraftRevision', 'id', 'ipId', 'name', 'nameEn', 'searchKeywords', 'displayOrder', 'categoryId', 'additionalCategoryIds', 'shippingNoticeTemplate', 'type', 'code', 'defaultVariantCode', 'price', 'compareAtPrice', 'showDiscountRate', 'badge', 'stock', 'description', 'descriptionFormat', 'descriptionUploadPath', 'descriptionImageAlt', 'imagePath', 'detailImagePath', 'originId', 'shippingFeeType', 'individualFee', 'variants', 'variantBaseline', 'customInputs', 'customInputsExpectedRevision', 'productAttributes', 'productAttributeDraft', 'optionUsage', 'optionAxisName0', 'optionAxisValues0', 'optionAxisName1', 'optionAxisValues1', 'optionAxisName2', 'optionAxisValues2', ...GOODS_SALE_PERIOD_FIELDS, ...GOODS_PRICE_DRAFT_FIELDS, ...GOODS_SALE_POLICY_FIELDS, ...GOODS_CLAIM_POLICY_FIELDS,
  ...GOODS_NOTICE_FIELDS.map((field) => field.formName), ...Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => `galleryPath${i}`)];
/**
 * 복구 안내를 두고 옵션 행이나 카테고리를 고치면 딸린 칸도 화면 값을 쓴다. 옵션 행과 축·동시편집 기준,
 * 카테고리와 그 상품속성은 이전 기록과 섞이면 맞지 않는다. 축이나 사용 여부만 고칠 때는 이전 옵션 행을 남긴다.
 * 직접입력형 항목·판매기간을 고치면 서버 버전 비교값도 화면 값을 쓴다. 이전 기록의 오래된 버전과 짝지으면 동시 수정이 없어도 저장이 거절된다.
 */
export const GOOD_LOCAL_DRAFT_LINKED_FIELDS = {
  variants: ['variantBaseline', 'optionUsage', 'optionAxisName0', 'optionAxisValues0', 'optionAxisName1', 'optionAxisValues1', 'optionAxisName2', 'optionAxisValues2'],
  categoryId: ['productAttributes', 'productAttributeDraft'],
  customInputs: ['customInputsExpectedRevision'],
  salePeriodEnabled: ['salePeriodRevision'], saleStartsAt: ['salePeriodRevision'], saleEndsAt: ['salePeriodRevision'],
} as const;
/** Failure/recovery owns even empty values; business defaults apply only to untouched new goods. */
export function goodEditorValues(selected: AdminGoodRecord | null, state: AdminFormValuesState, initialIpId = '', noticeDefaults?: GoodNoticeDefaults): Record<string, string> {
  const values: Record<string, string> = {
    productAttributes: '', productAttributeDraft: '',
    salePeriodEnabled: String(Boolean(selected?.saleStartsAt)), saleStartsAt: toKstDateTimeInput(selected?.saleStartsAt ?? null),
    saleEndsAt: toKstDateTimeInput(selected?.saleEndsAt ?? null), salePeriodRevision: String(selected?.salePeriodRevision ?? 0),
    customInputs:JSON.stringify({enabled:selected?.customInputs?.enabled ?? false,fields:selected?.customInputs?.fields ?? []}),
    customInputsExpectedRevision:String(selected?.customInputs?.revision ?? 0),
    id: selected?.id ?? '', code: selected?.code ?? '', ipId: selected?.ipId ?? initialIpId,
    name: selected?.name ?? '', nameEn: selected?.nameEn ?? '', searchKeywords: selected?.searchKeywords?.join('\n') ?? '', displayOrder: selected?.displayOrder == null ? '' : String(selected.displayOrder), type: selected?.type ?? '', price: String(selected?.price ?? 0),
    compareAtPrice: selected?.compareAtPrice == null ? '' : String(selected.compareAtPrice),
    showDiscountRate: String(selected?.showDiscountRate ?? true),
    claimReturnAllowed: selected?.claimPolicy?.returnAllowed == null ? '' : String(selected.claimPolicy.returnAllowed),
    claimExchangeAllowed: selected?.claimPolicy?.exchangeAllowed == null ? '' : String(selected.claimPolicy.exchangeAllowed),
    claimRestrictionReason: selected?.claimPolicy?.restrictionReason ?? '',
    claimReturnFee: selected?.claimPolicy?.returnFee == null ? '' : String(selected.claimPolicy.returnFee),
    claimReturnFreeShippingFee: selected?.claimPolicy?.returnFreeShippingFee == null ? '' : String(selected.claimPolicy.returnFreeShippingFee),
    claimExchangeFee: selected?.claimPolicy?.exchangeFee == null ? '' : String(selected.claimPolicy.exchangeFee),
    categoryId: selected?.categoryId ?? '',
    additionalCategoryIds: JSON.stringify(selected?.additionalCategoryIds ?? []),
    shippingNoticeTemplate: selected?.shippingNoticeSnapshot ? `${selected.shippingNoticeSnapshot.code}@${selected.shippingNoticeSnapshot.version}` : '',
    badge: selected?.badge ?? '', stock: selected?.stock ?? 'ok', description: selected?.description ?? '',
    descriptionFormat: selected?.descriptionFormat ?? 'plain', descriptionUploadPath: '', descriptionImageAlt: '',
    imagePath: selected?.imagePath ?? '', detailImagePath: selected?.detailImagePath ?? '',
    originId: selected ? selected.originId ?? '' : DEFAULT_FULFILLMENT_ORIGIN_ID,
    shippingFeeType: selected?.shippingFeeType ?? 'policy', individualFee: String(selected?.individualFee ?? 0),
    allowCardPayment: String(selected?.allowCardPayment ?? true), allowBankTransfer: String(selected?.allowBankTransfer ?? true),
    saleRestriction: selected?.saleRestriction ?? 'none', orderQuantityLimitEnabled: String(selected?.orderQuantityLimitEnabled ?? false),
    minOrderQty: selected?.minOrderQty == null ? '' : String(selected.minOrderQty),
    maxOrderQty: selected?.maxOrderQty == null ? '' : String(selected.maxOrderQty),
    memberPurchaseLimitEnabled: String(selected?.memberPurchaseLimitEnabled ?? false),
    memberLifetimeQtyLimit: selected?.memberLifetimeQtyLimit == null ? '' : String(selected.memberLifetimeQtyLimit),
    ...Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.formName, selected?.notice[field.key] ?? ''])),
    ...Object.fromEntries(Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => [`galleryPath${i}`, selected?.galleryPaths[i] ?? ''])),
  };
  if (!selected) {
    values.noticeAsManager = noticeDefaults?.asManager ?? '';
    values.noticeAsContact = noticeDefaults?.asContact ?? '';
  }
  return { ...values, ...preservedFormValues(state, selected?.id) };
}

/** Rows, optimistic baseline and uploaded images are restored as one edit session. */
export function createGoodEditorDraft(selected: AdminGoodRecord | null, state: AdminFormValuesState,
  variants: AdminGoodsVariant[], initialIpId = '', noticeDefaults?: GoodNoticeDefaults) {
  const initial = goodEditorValues(selected, state, initialIpId, noticeDefaults);
  const rows = restoreGoodsOptionRows(initial.variants) ?? initialGoodsOptionRows(variants, Number(initial.price));
  let baseline = variants.filter(variant => !variant.archivedAt).map(variant => variant.id);
  try { if (initial.variantBaseline) baseline = JSON.parse(initial.variantBaseline); }
  catch { /* Preserve the existing fallback for malformed browser recovery. Server validates submissions. */ }
  const imageUrl = (name: string, savedPath?: string | null, savedUrl?: string | null) =>
    initial[name] === (savedPath ?? '') ? savedUrl ?? null : publicMediaUrl(initial[name]);
  return {
    initial, baseline,
    values: { ...initial, variants: JSON.stringify(rows), variantBaseline: JSON.stringify(baseline) },
    imageUrls: {
      imagePath: imageUrl('imagePath', selected?.imagePath, selected?.imageUrl),
      detailImagePath: imageUrl('detailImagePath', selected?.detailImagePath, selected?.detailImageUrl),
      ...Object.fromEntries(Array.from({ length: GOODS_GALLERY_MAX }, (_, i) =>
        [`galleryPath${i}`, imageUrl(`galleryPath${i}`, selected?.galleryPaths[i], selected?.galleryUrls[i])])),
    } as Record<string, string | null>,
  };
}

export function goodEditorFingerprint(data: FormData): string {
  return JSON.stringify([...data.entries()].filter(([name, value]) =>
    typeof value === 'string' && GOOD_LOCAL_DRAFT_FIELDS.includes(name) && !['serverDraftId', 'serverDraftRevision'].includes(name)).sort(([a], [b]) => a.localeCompare(b)));
}

/** All public projections use the same unsaved values, including delivery and comparison price. */
export function buildGoodEditorPreview({ values, imageUrls, selected, catalogIps, origins, shippingNoticeOptions }: {
  values: Record<string, string>; imageUrls: Record<string, string | null>; selected: AdminGoodRecord | null;
  catalogIps: Ip[]; origins: GoodsFulfillmentOrigin[]; shippingNoticeOptions: Omit<ShippingNoticeSnapshot, 'templateId'>[];
}) {
  const origin = origins.find(origin => origin.id === values.originId);
  const savedNotice = selected?.shippingNoticeSnapshot;
  const notice = shippingNoticeOptions.find(option => `${option.code}@${option.version}` === values.shippingNoticeTemplate)
    ?? (savedNotice && `${savedNotice.code}@${savedNotice.version}` === values.shippingNoticeTemplate ? savedNotice : null);
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  const shippingPolicy: GoodShippingPolicy | null = origin ? {
    originId: origin.id, originName: origin.name, baseFee: origin.baseFee, freeThreshold: origin.freeThreshold,
    feeType: (['policy', 'free', 'individual'].includes(values.shippingFeeType) ? values.shippingFeeType : 'policy') as GoodShippingPolicy['feeType'],
    individualFee: Number(values.individualFee) || 0, returnAddress: origin.returnAddress,
    claimPolicy: readGoodsClaimPolicy(form).value ?? null,
    ...(notice ? { shippingNotice: notice.shippingNotice, returnExchangeNotice: notice.returnExchangeNotice,
      /* 배송 안내 템플릿의 선택 칸 '도서산간 안내'(T19)도 공개 상세처럼 미리보기에 싣는다. */
      ...(notice.remoteAreaNotice ? { remoteAreaNotice: notice.remoteAreaNotice } : {}),
      cs: { name: notice.csName, phone: notice.csPhone, email: notice.csEmail } } : {}),
  } : null;
  const ip = catalogIps.find(ip => ip.id === values.ipId) ?? null;
  /* S36-051: 랜덤 판매 상품은 공개 상세처럼 옵션을 '랜덤' 한 줄로 접고 랜덤 안내를 보인다. 판매 방식은 저장된 값이다(별도 저장 패널). */
  const preview = buildGoodPreview({ fallbackBg: selected?.bg ?? null, imageUrls, ip, stockQty: selected?.stockQty ?? 0, values, kcDisclosures:selected?.kcDisclosures,
    optionSaleMode: selected?.optionSaleMode === 'random' ? 'random' : 'select' });
  const basePrice = preview.good.catalogPrice ?? preview.good.price;
  const compare = Number(values.compareAtPrice);
  const compareAtPrice = Number.isInteger(compare) && compare > basePrice ? compare : null;
  const customInputDraft = readAdminGoodsCustomInputs(form);
  const customInputs = customInputDraft.ok ? parseGoodsCustomInputConfig({
    ...(customInputDraft.fields.custom_inputs as object | undefined),
    revision: Math.max(1, Number(values.customInputsExpectedRevision) || 0),
  }) : null;
  const detail = { ...preview, good: { ...preview.good, showDiscountRate: values.showDiscountRate !== 'false',
    customInputs: customInputs ?? EMPTY_GOODS_CUSTOM_INPUTS, salePeriod: goodsSalePeriodPreview(values),
    catalogCompareAtPrice: compareAtPrice, compareAtPrice: goodCompareAtPrice({ price: basePrice, compareAtPrice }, preview.good.options) } };
  return { origin, ip, detail, shippingPolicy };
}
