import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';

/** Display grouping only. Validation and publish decisions remain with the server. */
export const GOOD_EDITOR_SECTIONS = [
  { key: 'category', label: '카테고리', fields: ['categoryId', 'additionalCategoryIds'] },
  { key: 'attributes', label: '상품속성', fields: ['productAttributes', 'productAttributeDraft'] },
  { key: 'basic', label: '상품명', fields: ['name'] },
  { key: 'price', label: '판매가', fields: ['price', 'compareAtPrice', 'showDiscountRate', 'regularPrice', 'discountEnabled', 'discountValue', 'discountUnit'] },
  { key: 'period', label: '판매기간', fields: ['salePeriodEnabled', 'saleStartsAt', 'saleEndsAt', 'salePeriodRevision'] },
  { key: 'limits', label: '구매 제한', fields: ['orderQuantityLimitEnabled', 'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit'] },
  { key: 'variants', label: '재고수량·옵션', fields: ['variants', 'variantBaseline', 'optionUsage', 'optionAxisName0', 'optionAxisValues0', 'optionAxisName1', 'optionAxisValues1', 'optionAxisName2', 'optionAxisValues2', 'customInputs', 'customInputsExpectedRevision'] },
  { key: 'images', label: '상품이미지', fields: ['imagePath', 'galleryPath0', 'galleryPath1', 'galleryPath2', 'galleryPath3', 'galleryPath4', 'galleryPath5', 'galleryPath6', 'galleryPath7', 'galleryPath8'] },
  { key: 'description', label: '상세설명', fields: ['description', 'descriptionFormat', 'detailImagePath', 'descriptionUploadPath', 'descriptionImageAlt'] },
  { key: 'information', label: '상품 주요정보', fields: ['ipId', 'type', 'id', 'code', 'defaultVariantCode', 'nameEn', 'searchKeywords', 'displayOrder', 'badge', 'stock'] },
  { key: 'notice', label: '상품정보제공고시', fields: GOODS_NOTICE_FIELDS.map((field) => field.formName) },
  { key: 'shipping', label: '배송', fields: ['originId', 'shippingFeeType', 'individualFee', 'shippingNoticeTemplate'] },
  { key: 'claims', label: '반품·교환', fields: [ 'claimReturnAllowed', 'claimExchangeAllowed', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee', 'claimRestrictionReason'] },
  { key: 'sale', label: '판매 조건', fields: ['allowCardPayment', 'allowBankTransfer', 'saleRestriction'] },
] as const;

export function goodFieldSection(name: string) {
  return GOOD_EDITOR_SECTIONS.find((section) => (section.fields as readonly string[]).includes(name)) ?? GOOD_EDITOR_SECTIONS[0];
}

/* 등록 화면 원자 저장 섹션(KC·예약판매)의 오류는 기본 입력 섹션 뒤, 운영 섹션 순서대로 놓는다. */
const OPERATION_ERROR_ORDER = ['workspaceKc', 'workspacePreorders'];
const errorOrder = (field: string) => OPERATION_ERROR_ORDER.includes(field)
  ? GOOD_EDITOR_SECTIONS.length + OPERATION_ERROR_ORDER.indexOf(field) : GOOD_EDITOR_SECTIONS.indexOf(goodFieldSection(field));

export function orderedGoodErrors(errors: Record<string, string | undefined> = {}) {
  return Object.entries(errors).filter((entry): entry is [string, string] => Boolean(entry[1])).sort(([a], [b]) => errorOrder(a) - errorOrder(b));
}

export const GOOD_PUBLISHED_LOCKS = {
  name: '상품명', type: '유형', ipId: '연결 IP', noticeMaker: '제조자',
  noticeOrigin: '제조국', noticeMaterial: '소재', noticeSize: '크기',
} as const;

export function changedGoodLockedFields(initial: Record<string, string>, current: Record<string, string>) {
  return Object.entries(GOOD_PUBLISHED_LOCKS).filter(([key]) => (initial[key] ?? '').trim() !== (current[key] ?? '').trim())
    .map(([key, label]) => [key, `${label} 항목은 공개 중에 잠겨 있습니다. 초안으로 전환 후 수정해주세요.`] as const);
}
