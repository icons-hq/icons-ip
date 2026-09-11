import type { AdminGoodRecord } from './catalog.server';
import type { AdminFormValuesState } from './form-state';
import { preservedFormValues } from './form-state';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOODS_GALLERY_MAX } from './catalog';
import { DEFAULT_FULFILLMENT_ORIGIN_ID } from './fulfillment-origins';
import { GOODS_CLAIM_POLICY_FIELDS } from './goods-claim-policy';
import { GOODS_SALE_POLICY_FIELDS } from './goods-sale-policy';
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
