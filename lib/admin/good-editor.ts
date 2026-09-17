import type { AdminGoodRecord } from './catalog.server';
import type { AdminFormValuesState } from './form-state';
import { preservedFormValues } from './form-state';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOODS_GALLERY_MAX } from './catalog';
import { DEFAULT_FULFILLMENT_ORIGIN_ID } from './fulfillment-origins';
import { GOODS_CLAIM_POLICY_FIELDS } from './goods-claim-policy';
import { GOODS_SALE_POLICY_FIELDS } from './goods-sale-policy';
import type { AdminGoodsVariant } from './goods-variants';
import { initialGoodsOptionRows, restoreGoodsOptionRows } from './goods-option-editor';
import { publicMediaUrl } from '@/lib/media';
import { buildGoodPreview } from './good-preview';
import type { Ip } from '@/lib/data';
import type { FulfillmentOrigin } from './fulfillment-origins';
import type { GoodShippingPolicy, ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { readGoodsClaimPolicy } from './goods-claim-policy';
export type GoodNoticeDefaults = { asManager: string; asContact: string };
export const GOOD_LOCAL_DRAFT_FIELDS = ['id', 'ipId', 'name', 'nameEn', 'searchKeywords', 'displayOrder', 'categoryId', 'shippingNoticeTemplate', 'type', 'code', 'defaultVariantCode', 'price', 'compareAtPrice', 'badge', 'stock', 'description', 'descriptionFormat', 'descriptionUploadPath', 'descriptionImageAlt', 'imagePath', 'detailImagePath', 'originId', 'shippingFeeType', 'individualFee', 'variants', 'variantBaseline', 'optionAxisName0', 'optionAxisValues0', 'optionAxisName1', 'optionAxisValues1', ...GOODS_SALE_POLICY_FIELDS, ...GOODS_CLAIM_POLICY_FIELDS,
  ...GOODS_NOTICE_FIELDS.map((field) => field.formName), ...Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => `galleryPath${i}`)];
/** Failure/recovery owns even empty values; business defaults apply only to untouched new goods. */
export function goodEditorValues(selected: AdminGoodRecord | null, state: AdminFormValuesState, initialIpId = '', noticeDefaults?: GoodNoticeDefaults): Record<string, string> {
  const values: Record<string, string> = {
    id: selected?.id ?? '', code: selected?.code ?? '', ipId: selected?.ipId ?? initialIpId,
    name: selected?.name ?? '', nameEn: selected?.nameEn ?? '', searchKeywords: selected?.searchKeywords?.join('\n') ?? '', displayOrder: selected?.displayOrder == null ? '' : String(selected.displayOrder), type: selected?.type ?? '', price: String(selected?.price ?? 0),
    compareAtPrice: selected?.compareAtPrice == null ? '' : String(selected.compareAtPrice),
    claimReturnAllowed: selected?.claimPolicy?.returnAllowed == null ? '' : String(selected.claimPolicy.returnAllowed),
    claimExchangeAllowed: selected?.claimPolicy?.exchangeAllowed == null ? '' : String(selected.claimPolicy.exchangeAllowed),
    claimRestrictionReason: selected?.claimPolicy?.restrictionReason ?? '',
    claimReturnFee: selected?.claimPolicy?.returnFee == null ? '' : String(selected.claimPolicy.returnFee),
    claimReturnFreeShippingFee: selected?.claimPolicy?.returnFreeShippingFee == null ? '' : String(selected.claimPolicy.returnFreeShippingFee),
    claimExchangeFee: selected?.claimPolicy?.exchangeFee == null ? '' : String(selected.claimPolicy.exchangeFee),
    categoryId: selected?.categoryId ?? '',
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
    typeof value === 'string' && GOOD_LOCAL_DRAFT_FIELDS.includes(name)).sort(([a], [b]) => a.localeCompare(b)));
}

/** All public projections use the same unsaved values, including delivery and comparison price. */
export function buildGoodEditorPreview({ values, imageUrls, selected, catalogIps, origins, shippingNoticeOptions }: {
  values: Record<string, string>; imageUrls: Record<string, string | null>; selected: AdminGoodRecord | null;
  catalogIps: Ip[]; origins: FulfillmentOrigin[]; shippingNoticeOptions: Omit<ShippingNoticeSnapshot, 'templateId'>[];
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
      cs: { name: notice.csName, phone: notice.csPhone, email: notice.csEmail } } : {}),
  } : null;
  const ip = catalogIps.find(ip => ip.id === values.ipId) ?? null;
  const preview = buildGoodPreview({ fallbackBg: selected?.bg ?? null, imageUrls, ip, stockQty: selected?.stockQty ?? 0, values });
  const compare = Number(values.compareAtPrice);
  const detail = { ...preview, good: { ...preview.good, compareAtPrice: Number.isInteger(compare) && compare > preview.good.price ? compare : null } };
  return { origin, ip, detail, shippingPolicy };
}
