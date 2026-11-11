import type { GoodsNoticeInfo } from '@/lib/goods-notice';
import {
  normalizeAdminGoodForm,
  normalizeGoodsSearchKeywords,
  validateGoodsSearchKeywords,
} from './catalog';
import { parseGoodsOptionRows } from './goods-option-editor';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { parsePurchaseCostInput, type PurchaseTaxBasis } from './goods-purchase-costs';
import { goodSaveFields } from './good-save';
import type { AdminGoodsKc } from './goods-kc';
import { goodsKcWorkbookOrphanErrors, planGoodsKcWorkbookRows, type GoodsKcWorkbookInputRow } from './goods-kc-workbook';
import { goodsCustomInputWorkbookConfig, goodsCustomInputWorkbookOrphanErrors, planGoodsCustomInputWorkbookRows,
  type GoodsCustomInputWorkbookInputRow } from './goods-custom-input-workbook';
import type { GoodsAfterSalesSnapshot } from '@/lib/goods-after-sales';
import type { GoodsSizeChartSnapshot } from '@/lib/goods-size-chart';
import { goodsGuidanceOrphanErrors, planGoodsAfterSalesWorkbook, planGoodsSizeWorkbook,
  GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_SHEET,
  type GoodsAfterSalesWorkbookInputRow, type GoodsSizeWorkbookInputRow, type GoodsImportGuidance } from './goods-guidance-workbook';

export const GOODS_WORKBOOK_ROW_LIMIT = 500;
export const GOODS_WORKBOOK_BYTES_LIMIT = 2 * 1024 * 1024;
/** Excel 한 칸의 최대 글자 수. 더 긴 값은 Excel이 잘라 저장하고, 이 양식도 읽지 않는다(workbook-safety). */
export const GOODS_WORKBOOK_CELL_MAX = 32_767;
/**
 * 엑셀 한 칸보다 긴 상세 설명(상세 HTML 상한 200,000자, R17)을 내보낼 때 원문 대신 쓰는 표식.
 * 원문을 그대로 쓰면 다시 올릴 때 거절되고, Excel에서 저장하면 잘린 설명이 정상 설명을 덮어쓸 수 있다.
 * 표식을 그대로 두면 저장된 설명·형식을 유지한다. 긴 설명은 상품 편집에서만 고친다.
 */
export const GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER =
  '[상품 편집에서만 수정] 상세 설명이 엑셀 한 칸(32,767자)보다 길어 파일에 담지 않았습니다. 이 문구를 그대로 두면 기존 상세 설명을 유지합니다.';
/** 상품 설명 칸에 쓸 값. 엑셀 한 칸에 들어가면 원문, 넘으면 표식이다. */
export const goodsWorkbookDescriptionCell = (description: string) =>
  description.length > GOODS_WORKBOOK_CELL_MAX ? GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER : description;
export const GOODS_IMAGES_ZIP_BYTES_LIMIT = 50 * 1024 * 1024;
export const GOODS_IMPORT_PATH = '/admin/catalog/goods/import';
export const GOODS_IMPORT_BUCKET = 'admin-goods-imports';
export const GOODS_WORKBOOK_VERSION = 'ICONS 상품 일괄 등록 v7';
export const GOODS_WORKBOOK_V6_VERSION = 'ICONS 상품 일괄 등록 v6';
export const GOODS_WORKBOOK_V5_VERSION = 'ICONS 상품 일괄 등록 v5';
/** v4는 옵션 축/값 3이 없고, v3는 갤러리 5~9도 없다. 구형 양식의 열 순서를 유지해 읽는다. */
export const GOODS_WORKBOOK_V4_VERSION = 'ICONS 상품 일괄 등록 v4';
export const GOODS_WORKBOOK_V3_VERSION = 'ICONS 상품 일괄 등록 v3';
export const GOODS_WORKBOOK_HEADERS = {
  code: '상품코드',
  name: '상품명',
  ipId: 'IP ID',
  id: '상품 URL',
  publish: '게시 상태',
  type: '상품 유형',
  price: '기준 판매가',
  compareAtPrice: '소비자가',
  showDiscountRate: '할인율 표시',
  badge: '배지',
  stock: '재고 표시',
  allowBankTransfer: '무통장 허용',
  saleRestriction: '판매 제한',
  originCode: '출고지 코드',
  shippingFeeType: '배송비 유형',
  individualFee: '개별 배송비',
  variantCode: '옵션코드',
  variantName: '옵션명',
  axis1: '옵션 축 1',
  value1: '옵션 값 1',
  axis2: '옵션 축 2',
  value2: '옵션 값 2',
  axis3: '옵션 축 3',
  value3: '옵션 값 3',
  variantPrice: '옵션 판매가',
  stockQty: '옵션 재고',
  preset: '고시 프리셋',
  noticeMaker: '제조자',
  noticeOrigin: '제조국',
  noticeMaterial: '소재',
  noticeSize: '크기',
  noticeMadeOn: '제조연월',
  noticeAsManager: 'AS 책임자',
  noticeAsContact: 'AS 연락처',
  description: '상품 설명',
  imageUrl: '대표 이미지 URL',
  imageFile: '대표 이미지 파일명',
  galleryUrl0: '갤러리 1 URL',
  galleryFile0: '갤러리 1 파일명',
  galleryUrl1: '갤러리 2 URL',
  galleryFile1: '갤러리 2 파일명',
  galleryUrl2: '갤러리 3 URL',
  galleryFile2: '갤러리 3 파일명',
  galleryUrl3: '갤러리 4 URL',
  galleryFile3: '갤러리 4 파일명',
  galleryUrl4: '갤러리 5 URL',
  galleryFile4: '갤러리 5 파일명',
  galleryUrl5: '갤러리 6 URL',
  galleryFile5: '갤러리 6 파일명',
  galleryUrl6: '갤러리 7 URL',
  galleryFile6: '갤러리 7 파일명',
  galleryUrl7: '갤러리 8 URL',
  galleryFile7: '갤러리 8 파일명',
  galleryUrl8: '갤러리 9 URL',
  galleryFile8: '갤러리 9 파일명',
  detailImageUrl: '상세 이미지 URL',
  detailImageFile: '상세 이미지 파일명',
  nameEn: '영문 상품명',
  categoryCode: '고객 카테고리 코드',
  additionalCategoryCodes: '추가 카테고리 코드',
  claimReturnAllowed: '반품 기본조건 적용',
  claimExchangeAllowed: '교환 기본조건 적용',
  claimRestrictionReason: '교환 반품 제한 사유',
  claimReturnFee: '고객 귀책 반품비 편도',
  claimReturnFreeShippingFee: '최초 무료배송 후 반품비 왕복',
  claimExchangeFee: '고객 귀책 교환비 왕복',
  purchaseCostKrw: '매입단가 (관리자 전용)',
  purchaseTaxBasis: '매입단가 세금 구분 (관리자 전용)',
  shippingNoticeTemplateCode: '배송 안내 템플릿 코드',
  shippingNoticeTemplateVersion: '배송 안내 템플릿 버전',
  lowStockThreshold: '안전재고 기준',
  variantActive: '옵션 사용',
  searchKeywords: '검색 키워드',
  displayOrder: '진열 순서',
  erpCode: 'ERP 코드',
  erpName: 'ERP 품명',
  barcode: '바코드',
  allowCardPayment: '카드 허용',
  orderQuantityLimitEnabled: '주문당 한도 적용',
  minOrderQty: '주문당 최소 수량',
  maxOrderQty: '주문당 최대 수량',
  memberPurchaseLimitEnabled: '회원 누적 한도 적용',
  memberLifetimeQtyLimit: '회원 누적 최대 수량',
  kcReset: 'KC 초기화',
  descriptionFormat: '상세 설명 형식',
} as const;
export type GoodsWorkbookKey = keyof typeof GOODS_WORKBOOK_HEADERS;
export const GOODS_WORKBOOK_KEYS = Object.keys(
  GOODS_WORKBOOK_HEADERS,
) as GoodsWorkbookKey[];
export type GoodsWorkbookRow = Record<GoodsWorkbookKey, string>;
/** v3 양식에 없는 열 — 추가 이미지 5~9(갤러리 5~9). */
const GOODS_WORKBOOK_V3_ABSENT = /^gallery(Url|File)[4-8]$/;
/** 업로드한 상품 시트의 A1 버전에 맞는 열 순서. 모르는 버전이면 null이다. */
export function goodsWorkbookLayout(version: string): { keys: readonly GoodsWorkbookKey[]; layout?: 'v3' | 'v4' } | null {
  if ([GOODS_WORKBOOK_VERSION, GOODS_WORKBOOK_V6_VERSION, GOODS_WORKBOOK_V5_VERSION].includes(version)) return { keys: GOODS_WORKBOOK_KEYS };
  const oldOptionKeys = GOODS_WORKBOOK_KEYS.filter(key => key !== 'axis3' && key !== 'value3');
  if (version === GOODS_WORKBOOK_V4_VERSION) return { keys: oldOptionKeys, layout: 'v4' };
  if (version === GOODS_WORKBOOK_V3_VERSION)
    return { keys: oldOptionKeys.filter((key) => !GOODS_WORKBOOK_V3_ABSENT.test(key)), layout: 'v3' };
  return null;
}
export type GoodsWorkbookInputRow = {
  row: number;
  values: GoodsWorkbookRow;
  errors?: string[];
  /** 구형 양식에서 읽은 행. v3의 갤러리 5~9는 보존하고, 3축 상품은 최신 양식을 요구한다. */
  layout?: 'v3' | 'v4';
};
export type GoodsImportVariant = {
  id: string;
  code: string;
  name: string;
  attributes: Record<string, string>;
  price: number;
  stock_qty: number;
  is_default: boolean;
  sort_order: number;
  archived_at: string | null;
  low_stock_threshold?: number | null;
  erp_code?: string | null;
  erp_name?: string | null;
  barcode?: string | null;
  external_updated_at?: string | null;
  purchase_cost_krw?: number | null;
  purchase_tax_basis?: PurchaseTaxBasis | null;
  purchase_cost_revision?: number | null;
};
export type GoodsImportExisting = {
  good: Record<string, unknown>;
  variants: GoodsImportVariant[];
  fingerprint: string;
  kcReview?: AdminGoodsKc | null;
  afterSales?: GoodsAfterSalesSnapshot | null;
  sizeChart?: GoodsSizeChartSnapshot | null;
};
export type GoodsWorkbookContext = {
  existing: GoodsImportExisting[];
  canManageCosts?: boolean;
  ips: { id: string; archived_at: string | null }[];
  origins: { id: string; code: string; is_active: boolean }[];
  presets: { name: string; notice: GoodsNoticeInfo }[];
  categories?: { id: string; code: string; archived_at: string | null }[];
  imageNames?: string[];
  kcRows?: GoodsKcWorkbookInputRow[] | null;
  customInputRows?: GoodsCustomInputWorkbookInputRow[] | null;
  afterSalesRows?: GoodsAfterSalesWorkbookInputRow[] | null;
  sizeRows?: GoodsSizeWorkbookInputRow[] | null;
  /** Supplied only by the server while preparing a durable import plan. */
  newCustomInputId?: () => string;
  mediaUrl: (path: string) => string | null;
};
export type GoodsImportImage = {
  field: 'image_path' | 'detail_image_path' | `gallery_${number}`;
  source: string;
  kind: 'url' | 'file';
  /** URL image already downloaded at preview into the batch's private files under this name. */
  cached?: string;
};
export type GoodsImportGroup = {
  key: string;
  rows: number[];
  source: GoodsWorkbookInputRow[];
  code: string;
  name: string;
  kind: 'new' | 'update' | 'unchanged' | 'error';
  errors: string[];
  warnings: string[];
  target: Record<string, unknown> | null;
  fingerprint: string | null;
  images: GoodsImportImage[];
  kcSource?: GoodsKcWorkbookInputRow[];
  customInputSource?: GoodsCustomInputWorkbookInputRow[];
  afterSalesSource?: GoodsAfterSalesWorkbookInputRow[];
  sizeSource?: GoodsSizeWorkbookInputRow[];
  guidance?: GoodsImportGuidance;
  guidanceOnly?: true;
  /** Set for groups converted from a Sabangnet sheet: drafts only, and an image that fails is left out. */
  format?: 'sabangnet';
};
/** Removes a not-yet-prepared image from a planned group so the product saves without it. */
export function dropGoodsImportImage(group: GoodsImportGroup, field: GoodsImportImage['field']) {
  group.images = group.images.filter((image) => image.field !== field);
  if (!group.target) return;
  const placeholder = `import-image:${field}`;
  if (field.startsWith('gallery_'))
    group.target.gallery_paths = ((group.target.gallery_paths as string[] | undefined) ?? [])
      .filter((path) => path !== placeholder);
  else if (group.target[field] === placeholder) group.target[field] = null;
}
/**
 * Images a Sabangnet draft left out while applying, read back from the durable prepared
 * state (`admin_goods_imports.prepared_images[index]`) so the count survives verification
 * waits and page reloads. Applying replaces a placeholder with a verified path in place;
 * leaving one out saves a single field as null or removes the gallery entry.
 */
export function countDroppedGoodsImportImages(
  group: Pick<GoodsImportGroup, 'format' | 'target'>,
  prepared: Record<string, unknown> | undefined,
) {
  const target = group.target;
  if (group.format !== 'sabangnet' || !target || !prepared) return 0;
  let count = 0;
  for (const field of ['image_path', 'detail_image_path'] as const)
    if (
      String(target[field] ?? '').startsWith('import-image:') &&
      field in prepared &&
      prepared[field] === null
    )
      count += 1;
  if (Array.isArray(target.gallery_paths) && Array.isArray(prepared.gallery_paths))
    count += Math.max(0, target.gallery_paths.length - prepared.gallery_paths.length);
  return count;
}
const OPTION_KEYS = new Set<GoodsWorkbookKey>([
  'variantCode',
  'variantName',
  'axis1',
  'value1',
  'axis2',
  'value2',
  'axis3',
  'value3',
  'variantPrice',
  'stockQty',
  'lowStockThreshold',
  'variantActive',
  'erpCode', 'erpName', 'barcode', 'purchaseCostKrw', 'purchaseTaxBasis',
]);
const str = (value: unknown) => (value == null ? '' : String(value));
const integer = (text: string) =>
  /^\d+$/.test(text) &&
  Number.isSafeInteger(Number(text)) &&
  Number(text) <= 2147483647;
// Form submissions use CRLF while XLSX XML readers normalize line endings to LF.
// Normalize only for comparison: preserve the raw stored/input text, blanks,
// zero values, spaces and every other content change.
const comparableCellText = (value: string) => value.replace(/\r\n?/g, '\n');
const canonical = (values: GoodsWorkbookRow) =>
  JSON.stringify(GOODS_WORKBOOK_KEYS.map((key) => comparableCellText(values[key])));
const imagePairs = [
  ['imageUrl', 'imageFile', 'image_path'],
  ['galleryUrl0', 'galleryFile0', 'gallery_0'],
  ['galleryUrl1', 'galleryFile1', 'gallery_1'],
  ['galleryUrl2', 'galleryFile2', 'gallery_2'],
  ['galleryUrl3', 'galleryFile3', 'gallery_3'],
  ['galleryUrl4', 'galleryFile4', 'gallery_4'],
  ['galleryUrl5', 'galleryFile5', 'gallery_5'],
  ['galleryUrl6', 'galleryFile6', 'gallery_6'],
  ['galleryUrl7', 'galleryFile7', 'gallery_7'],
  ['galleryUrl8', 'galleryFile8', 'gallery_8'],
  ['detailImageUrl', 'detailImageFile', 'detail_image_path'],
] as const;
const galleryIndex = (field: string) => Number(field.slice('gallery_'.length));
/** 저장된 추가 이미지를 내보내기와 같은 주소로 쓴다(다시 올려도 바뀌지 않은 이미지로 본다). */
const savedGalleryReference = (good: Record<string, unknown>, index: number, mediaUrl: GoodsWorkbookContext['mediaUrl']) => {
  const path = (good.gallery_paths as string[] | null)?.[index];
  return path ? (mediaUrl(str(path)) ?? str(path)) : '';
};
/** v3 양식 행은 파일에 없는 갤러리 5~9 열을 기존 상품의 저장값으로 채운다. 빈칸으로 보면 추가 이미지 5~9가 지워진다. */
function keepGalleryOutsideV3(source: GoodsWorkbookInputRow[], record: GoodsImportExisting | undefined, context: GoodsWorkbookContext) {
  if (!record) return;
  for (const row of source) {
    if (row.layout !== 'v3') continue;
    for (const [url, , field] of imagePairs)
      if (GOODS_WORKBOOK_V3_ABSENT.test(url)) row.values[url] = savedGalleryReference(record.good, galleryIndex(field), context.mediaUrl);
  }
}
export function emptyGoodsWorkbookRow(): GoodsWorkbookRow {
  return Object.fromEntries(
    GOODS_WORKBOOK_KEYS.map((key) => [key, '']),
  ) as GoodsWorkbookRow;
}
/** An export carries editable values; fields outside this format remain in the stored record. */
export function exportGoodsWorkbookRows(
  record: GoodsImportExisting,
  context: Pick<GoodsWorkbookContext, 'origins' | 'mediaUrl' | 'categories' | 'canManageCosts'>,
): GoodsWorkbookRow[] {
  const { good } = record;
  const categoryCode = good.category_id ? context.categories?.find((category) => category.id === good.category_id)?.code : '';
  if (good.category_id && !categoryCode) throw new Error('상품의 카테고리 코드를 확인하지 못했습니다. 다시 내보내주세요.');
  const additionalCodes = (Array.isArray(good.additional_category_ids) ? good.additional_category_ids : []).map(id => {
    const code = context.categories?.find(category => category.id === id)?.code;
    if (!code) throw new Error('상품의 추가 카테고리 코드를 확인하지 못했습니다. 다시 내보내주세요.');
    return code;
  });
  const shippingNotice = good.shipping_notice_snapshot && typeof good.shipping_notice_snapshot === 'object' ? good.shipping_notice_snapshot as Record<string, unknown> : {};
  const base: GoodsWorkbookRow = {
    ...emptyGoodsWorkbookRow(),
    code: str(good.code),
    name: str(good.name),
    nameEn: str(good.name_en),
    categoryCode: categoryCode ?? '',
    additionalCategoryCodes: additionalCodes.join('\n'),
    claimReturnAllowed: good.claim_return_allowed == null ? '' : good.claim_return_allowed ? '예' : '아니오',
    claimExchangeAllowed: good.claim_exchange_allowed == null ? '' : good.claim_exchange_allowed ? '예' : '아니오',
    claimRestrictionReason: str(good.claim_restriction_reason),
    claimReturnFee: str(good.claim_return_fee),
    claimReturnFreeShippingFee: str(good.claim_return_free_shipping_fee),
    claimExchangeFee: str(good.claim_exchange_fee),
    shippingNoticeTemplateCode: str(shippingNotice.code),
    shippingNoticeTemplateVersion: str(shippingNotice.templateVersion),
    searchKeywords: normalizeGoodsSearchKeywords(
      Array.isArray(good.search_keywords) ? good.search_keywords.map(str).join('\n') : '',
    ).join('\n'),
    displayOrder: str(good.display_order),
    ipId: str(good.ip_id),
    id: str(good.id),
    publish: good.archived_at ? '보관' : good.published_at ? '공개' : '초안',
    type: str(good.type),
    price: str(good.price),
    compareAtPrice: str(good.compare_at_price),
    showDiscountRate: good.show_discount_rate === false ? '아니오' : '예',
    badge: str(good.badge),
    stock: str(good.stock),
    allowBankTransfer: good.allow_bank_transfer === false ? '아니오' : '예',
    allowCardPayment: good.allow_card_payment === false ? '아니오' : '예',
    orderQuantityLimitEnabled: good.order_quantity_limit_enabled === true ? '예' : '아니오',
    minOrderQty: str(good.min_order_qty),
    maxOrderQty: str(good.max_order_qty),
    memberPurchaseLimitEnabled: good.member_purchase_limit_enabled === true ? '예' : '아니오',
    memberLifetimeQtyLimit: str(good.member_lifetime_qty_limit),
    saleRestriction: str(good.sale_restriction || 'none'),
    originCode:
      context.origins.find((origin) => origin.id === good.origin_id)?.code ??
      '',
    shippingFeeType: str(good.shipping_fee_type || 'policy'),
    individualFee: str(good.individual_fee ?? 0),
    noticeMaker: str(good.notice_maker),
    noticeOrigin: str(good.notice_origin),
    noticeMaterial: str(good.notice_material),
    noticeSize: str(good.notice_size),
    noticeMadeOn: str(good.notice_made_on),
    noticeAsManager: str(good.notice_as_manager),
    noticeAsContact: str(good.notice_as_contact),
    description: goodsWorkbookDescriptionCell(str(good.description)),
    descriptionFormat: good.description_format === 'html' ? 'html' : 'plain',
  };
  for (const [url, , field] of imagePairs) {
    if (field.startsWith('gallery_')) {
      base[url] = savedGalleryReference(good, galleryIndex(field), context.mediaUrl);
      continue;
    }
    const path = good[field];
    base[url] = path ? (context.mediaUrl(str(path)) ?? str(path)) : '';
  }
  const variants = record.variants
    .filter((v) => !v.archived_at || v.is_default)
    .sort(
      (a, b) =>
        Number(b.is_default) - Number(a.is_default) ||
        a.sort_order - b.sort_order ||
        a.id.localeCompare(b.id),
    );
  return (variants.length ? variants : [null]).map((variant) => {
    const attributes = Object.entries(variant?.attributes ?? {});
    return {
      ...base,
      variantCode: variant?.code ?? '',
      variantName: variant?.name ?? '기본 옵션',
      axis1: attributes[0]?.[0] ?? '',
      value1: attributes[0]?.[1] ?? '',
      axis2: attributes[1]?.[0] ?? '',
      value2: attributes[1]?.[1] ?? '',
      axis3: attributes[2]?.[0] ?? '',
      value3: attributes[2]?.[1] ?? '',
      variantPrice: str(variant?.price ?? good.price),
      stockQty: str(variant?.stock_qty ?? 0),
      lowStockThreshold: str(variant?.low_stock_threshold),
      variantActive: variant?.archived_at ? '중지' : '사용',
      purchaseCostKrw: context.canManageCosts ? str(variant?.purchase_cost_krw) : '',
      purchaseTaxBasis: context.canManageCosts ? str(variant?.purchase_tax_basis) : '',
      erpCode: str(variant?.erp_code), erpName: str(variant?.erp_name), barcode: str(variant?.barcode),
    };
  });
}
function safeImageReference(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443')
    );
  } catch {
    return false;
  }
}
function noticeFromPreset(
  row: GoodsWorkbookRow,
  context: GoodsWorkbookContext,
): GoodsWorkbookRow {
  if (!row.preset) return row;
  const notice = context.presets.find(
    (preset) => preset.name === row.preset,
  )?.notice;
  if (!notice) return row;
  return {
    ...row,
    noticeMaker: row.noticeMaker || str(notice.maker),
    noticeOrigin: row.noticeOrigin || str(notice.origin),
    noticeMaterial: row.noticeMaterial || str(notice.material),
    noticeSize: row.noticeSize || str(notice.size),
    noticeMadeOn: row.noticeMadeOn || str(notice.madeOn),
    noticeAsManager: row.noticeAsManager || str(notice.asManager),
    noticeAsContact: row.noticeAsContact || str(notice.asContact),
  };
}
export function planGoodsWorkbookImport(
  rows: GoodsWorkbookInputRow[],
  context: GoodsWorkbookContext,
): GoodsImportGroup[] {
  if (rows.length > GOODS_WORKBOOK_ROW_LIMIT)
    throw new Error(
      '옵션 행은 파일당 최대 500행입니다. 파일을 나누어 올려주세요.',
    );
  const kcOrphans = goodsKcWorkbookOrphanErrors(context.kcRows ?? [], rows.map(row => row.values.code.trim().toUpperCase()));
  if (kcOrphans.length) throw new Error(kcOrphans.join('\n'));
  const customInputOrphans = goodsCustomInputWorkbookOrphanErrors(context.customInputRows ?? [], rows.map(row => row.values.code));
  if (customInputOrphans.length) throw new Error(customInputOrphans.join('\n'));
  const guidanceOrphans = [
    ...goodsGuidanceOrphanErrors(context.afterSalesRows ?? [], rows.map(row => row.values.code), GOODS_AFTER_SALES_WORKBOOK_SHEET),
    ...goodsGuidanceOrphanErrors(context.sizeRows ?? [], rows.map(row => row.values.code), GOODS_SIZE_WORKBOOK_SHEET),
  ];
  if (guidanceOrphans.length) throw new Error(guidanceOrphans.join('\n'));
  const grouped = new Map<string, GoodsWorkbookInputRow[]>();
  for (const row of rows) {
    const code = row.values.code.trim().toUpperCase();
    const key = code
      ? `code:${code}`
      : `new:${row.values.ipId}:${row.values.name}`;
    grouped.set(key, [
      ...(grouped.get(key) ?? []),
      { ...row, values: { ...row.values, code } },
    ]);
  }
  return [...grouped].map(([key, source]) => {
    const sourceCode = source[0].values.code;
    const record = sourceCode
      ? context.existing.find(
          (item) => str(item.good.code).toUpperCase() === sourceCode,
        )
      : undefined;
    keepGalleryOutsideV3(source, record, context);
    const first = noticeFromPreset(source[0].values, context);
    const errors = source.flatMap((row) =>
      (row.errors ?? []).map((error) => `${row.row}행: ${error}`),
    );
    const group: GoodsImportGroup = {
      key,
      rows: source.map((row) => row.row),
      source,
      code: first.code,
      name: first.name,
      kind: record ? 'update' : 'new',
      errors,
      warnings: [],
      target: null,
      fingerprint: record?.fingerprint ?? null,
      images: [],
      kcSource: (context.kcRows ?? []).filter(row => row.values.goodCode.trim() === first.code),
      customInputSource: (context.customInputRows ?? []).filter(row => row.values.goodCode.trim().toUpperCase() === first.code),
      afterSalesSource: (context.afterSalesRows ?? []).filter(row => row.values.goodCode.trim().toUpperCase() === first.code),
      sizeSource: (context.sizeRows ?? []).filter(row => row.values.goodCode.trim().toUpperCase() === first.code),
    };
    if (record?.variants.some(variant => (!variant.archived_at || variant.is_default) && Object.keys(variant.attributes).length > 2)
      && source.some(row => row.layout === 'v3' || row.layout === 'v4')) errors.push('3축 옵션 상품은 최신 v7 양식으로 다시 내려받아 수정해주세요. 구형 양식에는 세 번째 옵션 축이 없어 적용할 수 없습니다.');
    if (!['', '예'].includes(first.kcReset)) errors.push('KC 초기화는 비워두거나 예를 선택해주세요.');
    const kcPlan = planGoodsKcWorkbookRows(context.kcRows, {
      goodCode: first.code, existing: record?.kcReview ?? null,
      variantCodes: source.map(row => row.values.variantCode.trim().toUpperCase()),
      willBeDraft: first.publish !== '공개', reset: first.kcReset === '예',
    });
    group.warnings.push(...kcPlan.warnings);
    if (kcPlan.kind === 'error') errors.push(...kcPlan.errors);
    const customInputPlan = planGoodsCustomInputWorkbookRows(context.customInputRows, {
      goodCode: first.code,
      existing: record ? goodsCustomInputWorkbookConfig(record.good) : null,
      newFieldId: context.newCustomInputId,
    });
    group.warnings.push(...customInputPlan.warnings);
    if (customInputPlan.kind === 'error') errors.push(...customInputPlan.errors);
    const afterSalesPlan = planGoodsAfterSalesWorkbook(context.afterSalesRows, first.code, record?.afterSales ?? null);
    const sizePlan = planGoodsSizeWorkbook(context.sizeRows, first.code, record?.sizeChart ?? null);
    for (const plan of [afterSalesPlan, sizePlan]) {
      group.warnings.push(...plan.warnings);
      if (plan.kind === 'error') errors.push(...plan.errors);
    }
    if (afterSalesPlan.kind === 'save' || sizePlan.kind === 'save') group.guidance = {
      ...(afterSalesPlan.kind === 'save' ? { afterSales: afterSalesPlan.change } : {}),
      ...(sizePlan.kind === 'save' ? { sizeChart: sizePlan.change } : {}),
    };
    // 긴 설명 표식은 '저장된 설명·형식 유지'다. 새 상품에는 유지할 설명이 없고, 형식만 바꾸면 원문이 다른 형식으로 읽힌다.
    const keepStoredDescription = first.description.trim() === GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER;
    if (keepStoredDescription && !record)
      errors.push(`상품 설명: 엑셀 한 칸(${GOODS_WORKBOOK_CELL_MAX.toLocaleString('ko-KR')}자)보다 긴 상세 설명은 엑셀로 등록할 수 없습니다. 상품을 저장한 뒤 상품 편집에서 입력해주세요.`);
    else if (keepStoredDescription && (first.descriptionFormat || 'plain') !== (record?.good.description_format === 'html' ? 'html' : 'plain'))
      errors.push('상세 설명 형식: 엑셀 한 칸보다 긴 상세 설명은 상품 편집에서만 고칠 수 있어 형식도 상품 편집에서 바꿔주세요.');
    const description = keepStoredDescription && record ? str(record.good.description) : first.description;
    for (const row of source) {
      const current = noticeFromPreset(row.values, context);
      if (
        GOODS_WORKBOOK_KEYS.some(
          (key) => !OPTION_KEYS.has(key)
            && key !== 'searchKeywords'
            && comparableCellText(current[key]) !== comparableCellText(first[key]),
        )
        || normalizeGoodsSearchKeywords(current.searchKeywords).join('\n')
          !== normalizeGoodsSearchKeywords(first.searchKeywords).join('\n')
      )
        errors.push(`${row.row}행: 같은 상품의 상품 정보가 서로 다릅니다.`);
    }
    // Legacy values outside today's editing rules still survive an untouched export.
    if (record && !errors.length && kcPlan.kind === 'keep' && customInputPlan.kind === 'keep') {
      const exported = exportGoodsWorkbookRows(record, context);
      if (
        exported.length === source.length &&
        exported.every(
          (row, index) => canonical(row) === canonical(source[index].values),
        )
      ) {
        if (!group.guidance) {
          group.kind = 'unchanged';
          return group;
        }
        if (!record.good.archived_at) {
          group.guidanceOnly = true;
          group.target = { previous_id: str(record.good.id), code: str(record.good.code) };
          return group;
        }
      }
    }
    if (record?.good.archived_at)
      errors.push('보관 상품은 복원한 뒤 수정해주세요.');
    if (
      first.preset &&
      !context.presets.some((preset) => preset.name === first.preset)
    )
      errors.push('고시 프리셋 이름을 찾을 수 없습니다.');
    if (!['', '초안', '공개'].includes(first.publish))
      errors.push('게시 상태는 초안 또는 공개로 입력해주세요.');
    if (!['', '예', '아니오'].includes(first.allowBankTransfer))
      errors.push('무통장 허용은 예 또는 아니오입니다.');
    for (const key of ['allowCardPayment', 'orderQuantityLimitEnabled', 'memberPurchaseLimitEnabled', 'showDiscountRate'] as const) {
      if (!['', '예', '아니오'].includes(first[key])) errors.push(`${GOODS_WORKBOOK_HEADERS[key]}은 예 또는 아니오입니다.`);
    }
    if (!['', 'none', 'adult'].includes(first.saleRestriction))
      errors.push('판매 제한은 none 또는 adult입니다.');
    const searchKeywordsError = validateGoodsSearchKeywords(first.searchKeywords);
    if (searchKeywordsError) errors.push(searchKeywordsError);
    if (first.code.length > 100) errors.push('상품코드는 100자 이내입니다.');
    const origin = context.origins.find(
      (origin) => origin.code === first.originCode,
    );
    if (first.originCode && !origin)
      errors.push('출고지 코드를 찾을 수 없습니다.');
    if (first.publish === '공개' && (!origin || !origin.is_active))
      errors.push('공개할 상품은 사용 중인 출고지를 지정해주세요.');
    if (!['', 'policy', 'free', 'individual'].includes(first.shippingFeeType))
      errors.push('배송비 유형은 policy/free/individual입니다.');
    if (
      !integer(first.individualFee || '0') ||
      Number(first.individualFee) > 1000000
    )
      errors.push('개별 배송비는 0~1,000,000원 정수입니다.');
    const form = new FormData();
    for (const field of [
      'id',
      'ipId',
      'name',
      'nameEn',
      'searchKeywords',
      'displayOrder',
      'shippingNoticeTemplateCode', 'shippingNoticeTemplateVersion',
      'claimRestrictionReason', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee',
      'minOrderQty', 'maxOrderQty', 'memberLifetimeQtyLimit',
      'type',
      'price',
      'compareAtPrice',
      'badge',
      'stock',
      'code',
      'description',
      'descriptionFormat',
      'noticeMaker',
      'noticeOrigin',
      'noticeMaterial',
      'noticeSize',
      'noticeMadeOn',
      'noticeAsManager',
      'noticeAsContact',
    ] as const)
      form.set(field, first[field]);
    form.set('description', description);
    const category = first.categoryCode ? context.categories?.find((category) => category.code === first.categoryCode) : null;
    if (first.categoryCode && !category) errors.push('고객 카테고리 코드를 찾을 수 없습니다.');
    if (category?.archived_at && category.id !== record?.good.category_id) errors.push('보관한 카테고리에 새 상품을 연결할 수 없습니다.');
    form.set('categoryId', category?.id ?? '');
    const additionalIds: string[] = [];
    for (const code of new Set(first.additionalCategoryCodes.split(/[\n,]+/).map(code => code.trim()).filter(Boolean))) {
      const additional = context.categories?.find(category => category.code === code);
      if (!additional) { errors.push(`추가 카테고리 코드를 찾을 수 없습니다: ${code}`); continue; }
      if (additional.archived_at && !(Array.isArray(record?.good.additional_category_ids) && record.good.additional_category_ids.includes(additional.id))) {
        errors.push(`보관한 추가 카테고리에 새 상품을 연결할 수 없습니다: ${code}`);
      }
      additionalIds.push(additional.id);
    }
    form.set('additionalCategoryIds', JSON.stringify(additionalIds));
    for (const key of ['claimReturnAllowed', 'claimExchangeAllowed'] as const) {
      if (!['', '예', '아니오'].includes(first[key])) errors.push(`${GOODS_WORKBOOK_HEADERS[key]}은 예/아니오 또는 미검토 공란으로 입력해주세요.`);
      form.set(key, first[key] === '' ? '' : String(first[key] === '예'));
    }
    form.set('price', first.price || '0');
    form.set('allowCardPayment', String(first.allowCardPayment !== '아니오'));
    form.set('showDiscountRate', String(first.showDiscountRate !== '아니오'));
    form.set('allowBankTransfer', String(first.allowBankTransfer !== '아니오'));
    form.set('saleRestriction', first.saleRestriction || 'none');
    form.set('orderQuantityLimitEnabled', String(first.orderQuantityLimitEnabled === '예'));
    form.set('memberPurchaseLimitEnabled', String(first.memberPurchaseLimitEnabled === '예'));
    if (record) form.set('previousId', str(record.good.id));
    if (first.publish === '공개') form.set('intent', 'publish');
    const imageValues: Record<string, unknown> = {
      image_path: null,
      detail_image_path: null,
    };
    const galleries: string[] = [];
    for (const [url, file, field] of imagePairs) {
      if (first[url] && first[file])
        errors.push(
          `${GOODS_WORKBOOK_HEADERS[url]}과 파일명 중 하나만 입력해주세요.`,
        );
      const reference = first[file] || first[url];
      if (!reference) continue;
      const existingPath = field.startsWith('gallery_')
        ? (record?.good.gallery_paths as string[] | null)?.[galleryIndex(field)]
        : record?.good[field];
      const unchanged =
        existingPath &&
        !first[file] &&
        (context.mediaUrl(str(existingPath)) ?? str(existingPath)) ===
          reference;
      if (
        first[file] &&
        (!/^[^/\\\u0000-\u001f]+\.(png|jpe?g|webp)$/i.test(reference) ||
          !context.imageNames?.includes(reference))
      )
        errors.push(
          `${GOODS_WORKBOOK_HEADERS[file]}: ZIP에서 같은 파일명을 찾을 수 없습니다.`,
        );
      if (!first[file] && !unchanged && !safeImageReference(reference))
        errors.push(
          `${GOODS_WORKBOOK_HEADERS[url]}: 공개 HTTPS 이미지 URL을 입력해주세요.`,
        );
      const path = unchanged ? str(existingPath) : `import-image:${field}`;
      if (!unchanged)
        group.images.push({
          field,
          source: reference,
          kind: first[file] ? 'file' : 'url',
        });
      if (field.startsWith('gallery_')) galleries.push(path);
      else imageValues[field] = path;
    }
    form.set('imagePath', str(imageValues.image_path));
    galleries.forEach((path, index) => form.set(`galleryPath${index}`, path));
    // 오류 문구는 엑셀 열 이름(기준 판매가·소비자가)을 따른다 — 미리보기와 실패 행 파일의 오류 칸에 그대로 나간다.
    const normalized = normalizeAdminGoodForm(form, {
      ipIds: new Set(
        context.ips.filter((ip) => !ip.archived_at).map((ip) => ip.id),
      ),
      eventIds: new Set(),
      goodIpById: new Map(),
      verticalKeys: new Set(),
    }, { copy: 'workbook' });
    if (!normalized.ok)
      errors.push(
        ...Object.values(normalized.errors).filter((error): error is string =>
          Boolean(error),
        ),
      );
    const active =
      record?.variants.filter((variant) => !variant.archived_at) ?? [];
    const editable = record?.variants.filter((variant) => !variant.archived_at || variant.is_default) ?? [];
    const options = source.map((row) => {
      const value = row.values;
      const variant = editable.find(
        (variant) =>
          variant.code.toUpperCase() === value.variantCode.toUpperCase(),
      );
      const attributes: Record<string, string> = Object.create(null);
      for (const [axis, optionValue] of [[value.axis1, value.value1], [value.axis2, value.value2], [value.axis3, value.value3]]) {
        if (!axis && !optionValue) continue;
        if (Object.hasOwn(attributes, axis))
          errors.push(`${row.row}행: 옵션 축 이름이 중복됩니다.`);
        attributes[axis] = optionValue;
      }
      if (
        !integer(value.variantPrice || first.price || '0') ||
        !integer(value.stockQty || '0')
      )
        errors.push(
          `${row.row}행: 옵션 판매가·재고는 0~2,147,483,647 정수입니다.`,
        );
      if (value.lowStockThreshold && !integer(value.lowStockThreshold))
        errors.push(`${row.row}행: 안전재고 기준은 0~2,147,483,647 정수이거나 공란이어야 합니다.`);
      if (!['', '사용', '중지'].includes(value.variantActive))
        errors.push(`${row.row}행: 옵션 사용은 사용 또는 중지로 입력해주세요.`);
      const purchaseCost = parsePurchaseCostInput({ unitCostKrw: value.purchaseCostKrw, taxBasis: value.purchaseTaxBasis });
      if (!context.canManageCosts && (value.purchaseCostKrw || value.purchaseTaxBasis)) errors.push(`${row.row}행: 매입단가는 관리자만 입력할 수 있습니다.`);
      if (context.canManageCosts && !purchaseCost) errors.push(`${row.row}행: 매입단가와 세금 구분(included/excluded/exempt)을 함께 입력하거나 함께 비워주세요.`);
      return {
        ...(context.canManageCosts && purchaseCost ? { purchaseCost: { ...purchaseCost, expectedRevision: variant?.purchase_cost_revision ?? null } } : {}),
        ...(variant
          ? { id: variant.id, expectedStockQty: variant.stock_qty }
          : {}),
        code: value.variantCode.trim().toUpperCase(),
        name: value.variantName || '기본 옵션',
        attributes,
        extraPrice:
          Number(value.variantPrice || first.price || 0) -
          Number(first.price || 0),
        stockQty: Number(value.stockQty || 0),
        lowStockThreshold: value.lowStockThreshold ? Number(value.lowStockThreshold) : null,
        isActive: value.variantActive ? value.variantActive === '사용' : !variant?.archived_at,
        erpCode: value.erpCode, erpName: value.erpName, barcode: value.barcode,
        externalUpdatedAt: variant?.external_updated_at ?? null,
      };
    });
    const parsedOptions = parseGoodsOptionRows(
      JSON.stringify(options),
      Number(first.price || 0),
    );
    if (!parsedOptions.ok) errors.push(parsedOptions.error);
    if (record) {
      if (record.good.published_at && first.publish !== '공개') {
        group.warnings.push('공개 상품을 초안으로 되돌립니다. 기존 주문은 유지됩니다.');
      } else if (!record.good.published_at && first.publish === '공개') {
        group.warnings.push('초안 상품을 공개 상태로 바꿉니다.');
      }
      const removed = active.filter(
        (variant) => !options.some((option) => option.id === variant.id),
      );
      if (removed.length)
        group.warnings.push(
          `기존 옵션 ${removed.length}개가 삭제 또는 보관됩니다.`,
        );
      if (
        record.good.published_at &&
        (Number(first.price) !== record.good.price ||
          options.some((option) => {
            const previous = active.find((variant) => variant.id === option.id);
            return (
              !previous ||
              previous.price !== Number(first.price) + option.extraPrice ||
              previous.stock_qty !== option.stockQty
            );
          }))
      )
        group.warnings.push('공개 상품의 가격 또는 재고가 변경됩니다.');
      if (first.id !== str(record.good.id) && record.good.first_published_at)
        errors.push('한 번 공개한 상품의 URL은 바꿀 수 없습니다.');
    }
    if (errors.length || !normalized.ok || !parsedOptions.ok) {
      group.kind = 'error';
      return group;
    }
    const value = normalized.value;
    if (value.descriptionFormat === 'html') group.warnings.push(...sanitizeGoodsDescription(description).warnings);
    group.target = {
      ...(kcPlan.kind === 'save' ? { kc_update: kcPlan.update } : {}),
      ...(customInputPlan.kind === 'save' ? { custom_inputs: customInputPlan.config,
        custom_inputs_expected_revision: customInputPlan.expectedRevision } : {}),
      ...goodSaveFields({
        ...value,
        // Workbook blanks are explicit replacements; the manual form can omit keys.
        previousId: record ? str(record.good.id) : null,
        nameEn: value.nameEn ?? null,
        searchKeywords: value.searchKeywords ?? [],
        displayOrder: value.displayOrder ?? null,
        descriptionFormat: value.descriptionFormat ?? 'plain',
        bg: record?.good.bg as string | null ?? null,
        imagePath: imageValues.image_path as string | null,
        detailImagePath: imageValues.detail_image_path as string | null,
        galleryPaths: galleries,
        allowBankTransfer: first.allowBankTransfer !== '아니오',
        saleRestriction: (first.saleRestriction || 'none') as 'none' | 'adult',
        publish: first.publish === '공개',
      }),
      origin_id: origin?.id ?? null,
      shipping_fee_type: first.shippingFeeType || 'policy',
      individual_fee: Number(first.individualFee || 0),
      variants: parsedOptions.rows,
      variant_baseline: active.map((variant) => variant.id),
    };
    return group;
  });
}
/** Never split a product's option rows across files. */
export function partitionGoodsExports(
  candidates: { id: string; rows: number }[],
): string[][] {
  const parts: string[][] = [];
  let current: string[] = [];
  let count = 0;
  for (const candidate of candidates) {
    const rows = Math.max(1, candidate.rows);
    if (rows > 500)
      throw new Error(
        '한 상품의 옵션이 500행을 초과합니다. 옵션 구성을 확인해주세요.',
      );
    if (count + rows > 500) {
      parts.push(current);
      current = [];
      count = 0;
    }
    current.push(candidate.id);
    count += rows;
  }
  if (current.length) parts.push(current);
  return parts;
}
