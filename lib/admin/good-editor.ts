import type { AdminGoodRecord } from './catalog.server';
import type { AdminFormValuesState } from './form-state';
import { preservedFormValues } from './form-state';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { GOODS_GALLERY_MAX } from './catalog';
import { DEFAULT_FULFILLMENT_ORIGIN_ID } from './fulfillment-origins';
export type GoodNoticeDefaults = { asManager: string; asContact: string };
export const GOOD_LOCAL_DRAFT_FIELDS = ['id', 'ipId', 'name', 'type', 'code', 'defaultVariantCode', 'price', 'compareAtPrice', 'badge', 'stock', 'description', 'imagePath', 'detailImagePath', 'originId', 'shippingFeeType', 'individualFee', 'variants', 'variantBaseline', 'optionAxisName0', 'optionAxisValues0', 'optionAxisName1', 'optionAxisValues1',
  ...GOODS_NOTICE_FIELDS.map((field) => field.formName), ...Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => `galleryPath${i}`)];
/** Failure/recovery owns even empty values; business defaults apply only to untouched new goods. */
export function goodEditorValues(selected: AdminGoodRecord | null, state: AdminFormValuesState, initialIpId = '', noticeDefaults?: GoodNoticeDefaults): Record<string, string> {
  const values: Record<string, string> = {
    id: selected?.id ?? '', code: selected?.code ?? '', ipId: selected?.ipId ?? initialIpId,
    name: selected?.name ?? '', type: selected?.type ?? '', price: String(selected?.price ?? 0),
    compareAtPrice: selected?.compareAtPrice == null ? '' : String(selected.compareAtPrice),
    badge: selected?.badge ?? '', stock: selected?.stock ?? 'ok', description: selected?.description ?? '',
    imagePath: selected?.imagePath ?? '', detailImagePath: selected?.detailImagePath ?? '',
    originId: selected ? selected.originId ?? '' : DEFAULT_FULFILLMENT_ORIGIN_ID,
    shippingFeeType: selected?.shippingFeeType ?? 'policy', individualFee: String(selected?.individualFee ?? 0),
    ...Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.formName, selected?.notice[field.key] ?? ''])),
    ...Object.fromEntries(Array.from({ length: GOODS_GALLERY_MAX }, (_, i) => [`galleryPath${i}`, selected?.galleryPaths[i] ?? ''])),
  };
  if (!selected) {
    values.noticeAsManager = noticeDefaults?.asManager ?? '';
    values.noticeAsContact = noticeDefaults?.asContact ?? '';
  }
  return { ...values, ...preservedFormValues(state, selected?.id) };
}
