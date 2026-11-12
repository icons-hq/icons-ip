import type { GoodsNoticeInfo } from '@/lib/goods-notice';
import {
  GOOD_TYPE_PUBLISH_REQUIRED,
  normalizeAdminGoodForm,
  normalizeGoodsSearchKeywords,
  validateGoodsSearchKeywords,
} from './catalog';
import { categoryGoodType } from './category';
import { GOOD_TYPE_CATEGORY_MESSAGES } from './good-workspace';
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
/**
 * v8(ADR-0038·S36-012): 첫 열 상품번호, 열 이름을 상품 수정 화면과 맞춘다 — 판매자상품코드·관리코드·재고수량·상품 표시문구·판매상태,
 * 가격은 화면처럼 판매가(할인 전)·즉시할인(원)·옵션가(추가금액), 매입단가는 공급가(매입단가). v3~v7 파일도 읽는다(아래 구형 열).
 */
export const GOODS_WORKBOOK_VERSION = 'ICONS 상품 일괄 등록 v8';
export const GOODS_WORKBOOK_V7_VERSION = 'ICONS 상품 일괄 등록 v7';
export const GOODS_WORKBOOK_V6_VERSION = 'ICONS 상품 일괄 등록 v6';
export const GOODS_WORKBOOK_V5_VERSION = 'ICONS 상품 일괄 등록 v5';
/** v4는 옵션 축/값 3이 없고, v3는 갤러리 5~9도 없다. 구형 양식의 열 순서를 유지해 읽는다. */
export const GOODS_WORKBOOK_V4_VERSION = 'ICONS 상품 일괄 등록 v4';
export const GOODS_WORKBOOK_V3_VERSION = 'ICONS 상품 일괄 등록 v3';
export const GOODS_WORKBOOK_HEADERS = {
  productNo: '상품번호',
  code: '판매자상품코드',
  name: '상품명',
  ipId: 'IP ID',
  id: '상품 URL',
  publish: '게시 상태',
  type: '상품 유형',
  salePrice: '판매가',
  instantDiscount: '즉시할인',
  showDiscountRate: '할인율 표시',
  badge: '상품 표시문구',
  stock: '판매상태',
  allowBankTransfer: '무통장 허용',
  saleRestriction: '판매 제한',
  originCode: '출고지 코드',
  shippingFeeType: '배송비 유형',
  individualFee: '개별 배송비',
  variantCode: '관리코드',
  variantName: '옵션명',
  axis1: '옵션 축 1',
  value1: '옵션 값 1',
  axis2: '옵션 축 2',
  value2: '옵션 값 2',
  axis3: '옵션 축 3',
  value3: '옵션 값 3',
  optionPrice: '옵션가',
  stockQty: '재고수량',
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
  purchaseCostKrw: '공급가(매입단가) (관리자 전용)',
  purchaseTaxBasis: '공급가(매입단가) 세금 구분 (관리자 전용)',
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
/**
 * v3~v7 가격 열. 저장값 그대로(기준 판매가 = 고객 결제 기준 금액, 소비자가 = 할인 전 금액, 옵션 판매가 = 최종 옵션 금액)라
 * 읽을 때 v8의 판매가·즉시할인·옵션가로 옮긴다(goodsWorkbookPricesFromLegacy).
 */
export type GoodsWorkbookLegacyPrices = { price: string; compareAtPrice: string; variantPrice: string };
type GoodsWorkbookLegacyPriceKey = `legacy:${keyof GoodsWorkbookLegacyPrices}`;
export type GoodsWorkbookColumnKey = GoodsWorkbookKey | GoodsWorkbookLegacyPriceKey;
export type GoodsWorkbookColumn = { key: GoodsWorkbookColumnKey; header: string };
const LEGACY_PRICE_COLUMNS: Partial<Record<GoodsWorkbookKey, GoodsWorkbookLegacyPriceKey>> = {
  salePrice: 'legacy:price', instantDiscount: 'legacy:compareAtPrice', optionPrice: 'legacy:variantPrice',
};
/** v3~v7의 열 이름(v8에서 화면 이름으로 바뀐 열만). */
const LEGACY_HEADERS: Partial<Record<GoodsWorkbookColumnKey, string>> = {
  code: '상품코드', 'legacy:price': '기준 판매가', 'legacy:compareAtPrice': '소비자가', badge: '배지', stock: '재고 표시',
  variantCode: '옵션코드', 'legacy:variantPrice': '옵션 판매가', stockQty: '옵션 재고',
  purchaseCostKrw: '매입단가 (관리자 전용)', purchaseTaxBasis: '매입단가 세금 구분 (관리자 전용)',
};
/** v5~v7 상품 시트의 열(상품번호 없음). v4는 옵션 축 3이, v3는 갤러리 5~9도 없다. */
const GOODS_WORKBOOK_V7_COLUMNS: readonly GoodsWorkbookColumn[] = GOODS_WORKBOOK_KEYS.filter((key) => key !== 'productNo').map((key) => {
  const column = LEGACY_PRICE_COLUMNS[key] ?? key;
  return { key: column, header: LEGACY_HEADERS[column] ?? GOODS_WORKBOOK_HEADERS[key] };
});
const GOODS_WORKBOOK_COLUMNS: readonly GoodsWorkbookColumn[] = GOODS_WORKBOOK_KEYS.map((key) => ({ key, header: GOODS_WORKBOOK_HEADERS[key] }));
/** v3 양식에 없는 열 — 추가 이미지 5~9(갤러리 5~9). */
const GOODS_WORKBOOK_V3_ABSENT = /^gallery(Url|File)[4-8]$/;
/** 구형(v3~v7) 양식 표시. v3·v4는 열이 더 적고, 셋 다 상품번호 열이 없으며 가격 열을 옮겨 읽는다. */
export type GoodsWorkbookLegacyLayout = 'v3' | 'v4' | 'v7';
/** 업로드한 상품 시트의 A1 버전에 맞는 열 순서와 열 이름. 모르는 버전이면 null이다. */
export function goodsWorkbookLayout(version: string): { columns: readonly GoodsWorkbookColumn[]; layout?: GoodsWorkbookLegacyLayout } | null {
  if (version === GOODS_WORKBOOK_VERSION) return { columns: GOODS_WORKBOOK_COLUMNS };
  if ([GOODS_WORKBOOK_V7_VERSION, GOODS_WORKBOOK_V6_VERSION, GOODS_WORKBOOK_V5_VERSION].includes(version)) return { columns: GOODS_WORKBOOK_V7_COLUMNS, layout: 'v7' };
  const oldOptionColumns = GOODS_WORKBOOK_V7_COLUMNS.filter(({ key }) => key !== 'axis3' && key !== 'value3');
  if (version === GOODS_WORKBOOK_V4_VERSION) return { columns: oldOptionColumns, layout: 'v4' };
  if (version === GOODS_WORKBOOK_V3_VERSION)
    return { columns: oldOptionColumns.filter(({ key }) => !GOODS_WORKBOOK_V3_ABSENT.test(key)), layout: 'v3' };
  return null;
}
const INT32_MAX = 2147483647;
const wholeWon = (text: string) => /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) <= INT32_MAX;
/**
 * v3~v7 가격 열을 v8 열로 옮긴다. 판매가 = 소비자가(할인 중) 또는 기준 판매가, 즉시할인 = 소비자가 − 기준 판매가,
 * 옵션가 = 옵션 판매가 − 기준 판매가. 저장되는 price·compare_at_price·옵션 금액은 v7과 같다. 옮길 수 없는 값은
 * 구형 열 이름으로 오류를 돌려주고 그 칸은 비운다(같은 오류를 v8 이름으로 한 번 더 말하지 않게).
 */
export function goodsWorkbookPricesFromLegacy(legacy: GoodsWorkbookLegacyPrices): {
  values: Pick<GoodsWorkbookRow, 'salePrice' | 'instantDiscount' | 'optionPrice'>; errors: string[];
} {
  const price = legacy.price.trim(), compare = legacy.compareAtPrice.trim(), variant = legacy.variantPrice.trim();
  const errors: string[] = [];
  const values = { salePrice: price, instantDiscount: '', optionPrice: '' };
  const base = wholeWon(price || '0') ? Number(price || 0) : null;
  if (compare) {
    if (base === null || !wholeWon(compare)) errors.push('기준 판매가·소비자가는 0 이상의 정수입니다.');
    else if (Number(compare) <= base) errors.push('소비자가는 기준 판매가보다 커야 합니다.');
    else Object.assign(values, { salePrice: compare, instantDiscount: String(Number(compare) - base) });
  }
  if (variant) {
    if (base === null || !wholeWon(variant)) errors.push('옵션 판매가는 0~2,147,483,647 정수입니다.');
    else if (Number(variant) < base) errors.push('옵션 판매가는 기준 판매가보다 낮게 입력할 수 없습니다.');
    else values.optionPrice = String(Number(variant) - base);
  }
  return { values, errors };
}
/**
 * 상품 시트의 판매가·즉시할인을 저장 계약(price = 고객 결제 기준 금액, compareAtPrice = 할인 전 금액)으로 바꾼다.
 * 상품 수정 화면의 판매가·즉시할인(원)과 같은 뜻이다. 즉시할인 빈칸·0은 할인 없음이다.
 */
export function goodsWorkbookStoredPrice(values: Pick<GoodsWorkbookRow, 'salePrice' | 'instantDiscount'>): {
  price: number; compareAtPrice: number | null; error?: string;
} {
  const sale = values.salePrice.trim(), discount = values.instantDiscount.trim();
  if (!wholeWon(sale || '0')) return { price: 0, compareAtPrice: null, error: '판매가는 0~2,147,483,647 원 단위 정수입니다.' };
  const regular = Number(sale || 0);
  if (!discount || discount === '0') return { price: regular, compareAtPrice: null };
  if (!wholeWon(discount) || Number(discount) >= regular)
    return { price: regular, compareAtPrice: null, error: `즉시할인은 1원 이상, 판매가 ${regular.toLocaleString('ko-KR')}원보다 작은 원 단위 정수로 입력하거나 비워 주세요.` };
  return { price: regular - Number(discount), compareAtPrice: regular };
}
export type GoodsWorkbookInputRow = {
  row: number;
  values: GoodsWorkbookRow;
  errors?: string[];
  /** 구형 양식에서 읽은 행. v3의 갤러리 5~9는 보존하고, v3·v4의 3축 상품은 최신 양식을 요구한다. 상품번호는 수정 대상의 번호로 채운다. */
  layout?: GoodsWorkbookLegacyLayout;
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
  /** 대표·추가 카테고리 코드와 상품 유형 연결(SHEET-003: 상품 유형 = 대표 카테고리(없으면 가까운 상위)의 연결값). */
  categories?: { id: string; code: string; archived_at: string | null; parent_id?: string | null; good_type?: string | null }[];
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
  'optionPrice',
  'stockQty',
  'lowStockThreshold',
  'variantActive',
  'erpCode', 'erpName', 'barcode', 'purchaseCostKrw', 'purchaseTaxBasis',
]);
const str = (value: unknown) => (value == null ? '' : String(value));
const integer = wholeWon;
// Form submissions use CRLF while XLSX XML readers normalize line endings to LF.
// Normalize only for comparison: preserve the raw stored/input text, blanks,
// zero values, spaces and every other content change.
const comparableCellText = (value: string) => value.replace(/\r\n?/g, '\n');
/**
 * SHEET-003(ADR-0037): 상품 유형 열은 내보내기에만 쓰고(대표 카테고리에서 정해진 저장 유형) 반입은 반영하지 않는다.
 * 그래서 변경 여부·같은 상품 행 일치 비교에서도 뺀다.
 */
const IGNORED_ON_IMPORT_KEYS = new Set<GoodsWorkbookKey>(['type']);
const canonical = (values: GoodsWorkbookRow) =>
  JSON.stringify(GOODS_WORKBOOK_KEYS.filter((key) => !IGNORED_ON_IMPORT_KEYS.has(key)).map((key) => comparableCellText(values[key])));
/** 반입에서 상품 유형 열을 무시한다는 안내. 파일 값이 적용될 유형과 다를 때만 보인다. */
export function goodsWorkbookTypeIgnoredWarning(fileType: string, appliedType: string): string | null {
  const value = fileType.trim();
  if (!value || value === appliedType) return null;
  return `상품 유형 열(‘${value}’)은 반영하지 않습니다. 상품 유형은 대표 카테고리(없으면 가까운 상위)에 연결한 값${appliedType ? `(‘${appliedType}’)` : '(지금 연결 없음)'}으로 정해집니다.`;
}
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
/**
 * 저장된 검증 결과(24시간)의 행을 지금 양식의 행으로 맞춘다. v8 배포 전에 만든 작업은 행이 v7 키(price·compareAtPrice·variantPrice)라
 * 실패 행 파일을 v8 열로 다시 쓸 수 있게 옮긴다. 이미 v8 행이면 그대로다.
 */
export function goodsWorkbookRowFromStored(values: Record<string, unknown>): GoodsWorkbookRow {
  const row = emptyGoodsWorkbookRow();
  for (const key of GOODS_WORKBOOK_KEYS) if (typeof values[key] === 'string') row[key] = values[key] as string;
  if (typeof values.salePrice !== 'string' && ['price', 'compareAtPrice', 'variantPrice'].some((key) => typeof values[key] === 'string'))
    Object.assign(row, goodsWorkbookPricesFromLegacy({
      price: str(values.price), compareAtPrice: str(values.compareAtPrice), variantPrice: str(values.variantPrice),
    }).values);
  return row;
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
  // 화면과 같은 판매가(할인 전)·즉시할인(원). 할인 중이 아니면 즉시할인은 빈칸이다.
  const storedPrice = Number(good.price ?? 0);
  const storedCompare = good.compare_at_price == null ? null : Number(good.compare_at_price);
  const discounted = storedCompare !== null && Number.isFinite(storedCompare) && storedCompare > storedPrice;
  const base: GoodsWorkbookRow = {
    ...emptyGoodsWorkbookRow(),
    productNo: str(good.product_no),
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
    salePrice: discounted ? str(storedCompare) : str(good.price),
    instantDiscount: discounted ? String(storedCompare! - storedPrice) : '',
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
      // 옵션가는 상품 수정 화면처럼 판매가(할인하면 할인가)에 더하는 추가금액이다.
      optionPrice: String(Number(variant?.price ?? good.price ?? 0) - storedPrice),
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
/** 상품번호는 1부터 매기는 양의 정수다(상품 목록·내보내기 그대로). */
const PRODUCT_NO_PATTERN = /^[1-9]\d{0,15}$/;
const MATCHED_BY_NUMBER_ONLY = '판매자상품코드가 비어 있어 상품번호로 찾은 기존 상품을 수정합니다.';
/**
 * 반입 키(ADR-0038): 상품번호 → 판매자상품코드 순서로 수정할 기존 상품을 찾는다. 찾으면 그 상품의 판매자상품코드·상품번호를
 * 행에 채워 같은 상품의 행끼리 묶이고, 내려받은 파일과 같으면 '변경 없음'이 된다. 상품번호와 판매자상품코드가 서로 다른 상품을
 * 가리키면 덮어쓰지 않고 오류다(판매자상품코드는 상품 수정 화면에서 바꾼다).
 * 상품 URL은 키가 아니다(구형 파일도 같다). 번호·코드가 모두 빈 행은 새 상품이고, 그 상품 URL을 이미 다른 상품이 쓰면 오류다 —
 * 기존 행을 복사해 새 상품을 만들며 URL만 남긴 행이 원래 상품을 덮지 않게 한다.
 */
function resolveGoodsWorkbookTarget(row: GoodsWorkbookInputRow, existing: readonly GoodsImportExisting[]): {
  row: GoodsWorkbookInputRow; matchedByNumberOnly: boolean;
} {
  const values = { ...row.values };
  const number = values.productNo.trim(), code = values.code.trim().toUpperCase(), url = values.id.trim();
  const errors = [...(row.errors ?? [])];
  let record: GoodsImportExisting | undefined;
  let matchedByNumberOnly = false;
  if (number) {
    const byNumber = PRODUCT_NO_PATTERN.test(number) ? existing.find((item) => str(item.good.product_no) === number) : undefined;
    if (!PRODUCT_NO_PATTERN.test(number)) errors.push('상품번호는 내려받은 숫자 그대로 두거나, 새 상품이면 비워 주세요.');
    else if (!byNumber) errors.push(`상품번호 ${number}인 상품을 찾을 수 없습니다. 새 상품은 상품번호를 비워 주세요.`);
    else if (code && str(byNumber.good.code).toUpperCase() !== code)
      errors.push(`상품번호 ${number}와 판매자상품코드 ${code}가 서로 다른 상품을 가리킵니다. 판매자상품코드는 상품 수정 화면에서 바꿔 주세요.`);
    else { record = byNumber; matchedByNumberOnly = !code; }
  } else if (code) record = existing.find((item) => str(item.good.code).toUpperCase() === code);
  else if (url && existing.some((item) => str(item.good.id) === url))
    errors.push(`이미 쓰는 상품 URL입니다(${url}). 기존 상품을 고치려면 상품번호나 판매자상품코드를 그대로 두고, 새 상품이면 상품 URL을 비우거나 다른 값을 넣어 주세요.`);
  values.code = record ? str(record.good.code).toUpperCase() : code;
  if (record) values.productNo = str(record.good.product_no);
  return { row: { ...row, values, errors }, matchedByNumberOnly };
}
export function planGoodsWorkbookImport(
  inputRows: GoodsWorkbookInputRow[],
  context: GoodsWorkbookContext,
): GoodsImportGroup[] {
  if (inputRows.length > GOODS_WORKBOOK_ROW_LIMIT)
    throw new Error(
      '옵션 행은 파일당 최대 500행입니다. 파일을 나누어 올려주세요.',
    );
  const targets = inputRows.map((row) => resolveGoodsWorkbookTarget(row, context.existing));
  const rows = targets.map((target) => target.row);
  const matchedByNumberOnly = new Set(targets.flatMap((target) => target.matchedByNumberOnly ? [target.row.row] : []));
  const typeNodes = (context.categories ?? []).map((category) => ({ id: category.id, parentId: category.parent_id ?? null, goodType: category.good_type ?? null }));
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
    if (record && source.some((row) => matchedByNumberOnly.has(row.row))) group.warnings.push(MATCHED_BY_NUMBER_ONLY);
    if (record?.variants.some(variant => (!variant.archived_at || variant.is_default) && Object.keys(variant.attributes).length > 2)
      && source.some(row => row.layout === 'v3' || row.layout === 'v4')) errors.push('3축 옵션 상품은 최신 양식(v8)으로 다시 내려받아 수정해주세요. 구형 양식에는 세 번째 옵션 축이 없어 적용할 수 없습니다.');
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
            && key !== 'searchKeywords' && !IGNORED_ON_IMPORT_KEYS.has(key)
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
    if (first.code.length > 100) errors.push('판매자상품코드는 100자 이내입니다.');
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
    /*
     * SHEET-003(ADR-0037): 상품 유형 열은 반영하지 않는다. 초안은 대표 카테고리(없으면 가까운 상위)의 연결값이고, 연결이 없으면
     * 저장된 값을 그대로 둔다(그 초안은 공개할 수 없다). 공개 중이면 저장된 유형을 유지하고 유형이 바뀌는 카테고리 변경은 막는다.
     */
    const categoryType = category ? categoryGoodType(typeNodes, category.id) : '';
    const storedType = str(record?.good.type);
    const publishedNow = Boolean(record?.good.published_at);
    const appliedType = publishedNow ? storedType : categoryType || storedType;
    form.set('type', appliedType);
    const typeWarning = goodsWorkbookTypeIgnoredWarning(first.type, appliedType);
    if (typeWarning) group.warnings.push(typeWarning);
    if (publishedNow && (category?.id ?? null) !== (str(record?.good.category_id) || null) && categoryType !== storedType)
      errors.push(categoryType ? GOOD_TYPE_CATEGORY_MESSAGES.locked : GOOD_TYPE_CATEGORY_MESSAGES.required);
    else if (first.publish === '공개' && !publishedNow && !categoryType) errors.push(GOOD_TYPE_PUBLISH_REQUIRED);
    else if (publishedNow && first.publish !== '공개' && categoryType && categoryType !== storedType)
      group.warnings.push(`초안으로 되돌리면 상품 유형이 카테고리 유형 ‘${categoryType}’으로 바뀌고 KC를 다시 검토해야 공개할 수 있습니다.`);
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
    // 판매가·즉시할인(화면 이름)을 저장 계약 price(할인하면 할인가)·compareAtPrice(할인 전)로 바꾼다. 오류면 할인 없이 검증을 이어 간다.
    const stored = goodsWorkbookStoredPrice(first);
    if (stored.error) errors.push(stored.error);
    form.set('price', String(stored.price));
    form.set('compareAtPrice', stored.compareAtPrice === null ? '' : String(stored.compareAtPrice));
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
    // 가격 오류는 위에서 엑셀 열 이름(판매가·즉시할인)으로 알렸다 — 여기로는 검증된 저장값만 넘긴다.
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
          Boolean(error) && !errors.includes(error),
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
      // 0901-015: 재고는 비워 둘 수 없다(신규·수정 모두). 재고가 없으면 0을 직접 적고, 빈칸을 0으로 바꿔 덮어쓰지 않는다.
      const stockText = value.stockQty.trim();
      if (!stockText)
        errors.push(`${row.row}행: 재고수량(옵션 재고)을 입력해주세요. 재고가 없으면 0을 입력합니다.`);
      if (
        !integer(value.optionPrice || '0') ||
        (stockText && !integer(stockText))
      )
        errors.push(
          `${row.row}행: 옵션가·재고수량은 0~2,147,483,647 정수입니다.`,
        );
      if (value.lowStockThreshold && !integer(value.lowStockThreshold))
        errors.push(`${row.row}행: 안전재고 기준은 0~2,147,483,647 정수이거나 공란이어야 합니다.`);
      if (!['', '사용', '중지'].includes(value.variantActive))
        errors.push(`${row.row}행: 옵션 사용은 사용 또는 중지로 입력해주세요.`);
      const purchaseCost = parsePurchaseCostInput({ unitCostKrw: value.purchaseCostKrw, taxBasis: value.purchaseTaxBasis });
      if (!context.canManageCosts && (value.purchaseCostKrw || value.purchaseTaxBasis)) errors.push(`${row.row}행: 공급가(매입단가)는 관리자만 입력할 수 있습니다.`);
      if (context.canManageCosts && !purchaseCost) errors.push(`${row.row}행: 공급가(매입단가)와 세금 구분(included/excluded/exempt)을 함께 입력하거나 함께 비워주세요.`);
      return {
        ...(context.canManageCosts && purchaseCost ? { purchaseCost: { ...purchaseCost, expectedRevision: variant?.purchase_cost_revision ?? null } } : {}),
        ...(variant
          ? { id: variant.id, expectedStockQty: variant.stock_qty }
          : {}),
        code: value.variantCode.trim().toUpperCase(),
        name: value.variantName || '기본 옵션',
        attributes,
        extraPrice: integer(value.optionPrice || '0') ? Number(value.optionPrice || 0) : 0,
        stockQty: Number(stockText || 0),
        lowStockThreshold: value.lowStockThreshold ? Number(value.lowStockThreshold) : null,
        isActive: value.variantActive ? value.variantActive === '사용' : !variant?.archived_at,
        erpCode: value.erpCode, erpName: value.erpName, barcode: value.barcode,
        externalUpdatedAt: variant?.external_updated_at ?? null,
      };
    });
    const parsedOptions = parseGoodsOptionRows(
      JSON.stringify(options),
      stored.price,
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
        (stored.price !== Number(record.good.price) ||
          options.some((option) => {
            const previous = active.find((variant) => variant.id === option.id);
            return (
              !previous ||
              previous.price !== stored.price + option.extraPrice ||
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
