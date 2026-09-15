import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';

/** Display grouping only. Validation and publish decisions remain with the server. */
export const GOOD_EDITOR_SECTIONS = [
  { key: 'basic', label: '기본 상품·이미지', fields: ['ipId', 'name', 'categoryId', 'type', 'imagePath', 'id', 'code', 'defaultVariantCode', 'nameEn', 'searchKeywords', 'displayOrder', 'badge', 'stock', 'description', 'descriptionFormat', 'detailImagePath', 'galleryPath0', 'galleryPath1', 'galleryPath2', 'galleryPath3'] },
  { key: 'price', label: '가격', fields: ['price', 'compareAtPrice'] },
  { key: 'variants', label: '옵션·할당 재고', fields: ['variants', 'variantBaseline'] },
  { key: 'notice', label: '고시정보·KC', fields: GOODS_NOTICE_FIELDS.map((field) => field.formName) },
  { key: 'shipping', label: '배송·교환반품', fields: ['originId', 'shippingFeeType', 'individualFee', 'shippingNoticeTemplate', 'claimReturnAllowed', 'claimExchangeAllowed', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee', 'claimRestrictionReason'] },
  { key: 'sale', label: '판매 조건', fields: ['allowCardPayment', 'allowBankTransfer', 'saleRestriction', 'orderQuantityLimitEnabled', 'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit'] },
] as const;

export function goodFieldSection(name: string) {
  return GOOD_EDITOR_SECTIONS.find((section) => (section.fields as readonly string[]).includes(name)) ?? GOOD_EDITOR_SECTIONS[0];
}

export function orderedGoodErrors(errors: Record<string, string | undefined> = {}) {
  return Object.entries(errors).filter((entry): entry is [string, string] => Boolean(entry[1])).sort(([a], [b]) =>
    GOOD_EDITOR_SECTIONS.indexOf(goodFieldSection(a)) - GOOD_EDITOR_SECTIONS.indexOf(goodFieldSection(b)));
}

export const GOOD_PUBLISHED_LOCKS = {
  name: '상품 이름', type: '유형', ipId: '연결 IP', noticeMaker: '제조자',
  noticeOrigin: '제조국', noticeMaterial: '소재', noticeSize: '크기',
} as const;

export function changedGoodLockedFields(initial: Record<string, string>, current: Record<string, string>) {
  return Object.entries(GOOD_PUBLISHED_LOCKS).filter(([key]) => (initial[key] ?? '').trim() !== (current[key] ?? '').trim())
    .map(([key, label]) => [key, `${label} 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.`] as const);
}
