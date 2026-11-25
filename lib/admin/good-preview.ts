import type { GoodOption, Ip, Stock } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import { imageBg } from '@/lib/media';
import { parseGoodBadgeText } from '@/lib/goods-taxonomy';
import { GOODS_DETAIL_IMAGE_FIELD_NAMES, GOODS_GALLERY_MAX, normalizeGoodsSearchKeywords } from './catalog';
import { restoreGoodsOptionRows, type GoodsOptionRow } from './goods-option-editor';
import { collapseRandomGoodOptions, goodCompareAtPrice, optionPriceRange } from '@/lib/goods-options';
import type { GoodsOptionLimitPolicy, GoodsOptionSaleMode } from '@/lib/goods-option-sale-mode';
import { sanitizeGoodsDescription } from '@/lib/goods-description';
import { parseGoodsKcDisclosures, parseGoodsOtherCertificationDisclosures, type GoodsKcDisclosure, type GoodsOtherCertificationDisclosure } from '@/lib/goods-kc';

/*
 * 어드민 굿즈 미리보기 (#184).
 *
 * 저장된 레코드가 아니라 **지금 폼에 들어 있는 값**을 공개 화면이 그리는 모양으로
 * 옮긴다. 저장된 값만 보여주면 저장 전에 확인한다는 목적 자체가 사라진다.
 *
 * 순수 함수라 실제 데이터에 손대지 않는다 — 미리보기가 카탈로그를 바꾸지 않는다는
 * 조건을 구조로 보장한다.
 */

const STOCK_VALUES = new Set<Stock>(['low', 'ok', 'soldout']);
const PREVIEW_PLACEHOLDER_BG = 'linear-gradient(150deg, #2A2440, #4A3F73)';
/* 폼에서 계산한 기간 할인이라 저장된 기간 할인 번호가 없다. 공개 화면이 '기간 할인 중'으로 읽는 표지만 필요하다. */
const PREVIEW_PRICE_PERIOD_ID = 'preview-price-period';

/** 특정기간만 할인(기간 즉시할인) 한 건. 금액은 옵션마다 같이 뺀다(lib/admin/goods-price-editor의 `period`). */
export interface GoodPreviewPricePeriod {
  amount: number;
  /** ISO 시각. */
  startsAt: string;
  endsAt: string;
}

/** 할인 기간 안인가. 시작 시각부터 종료 시각 직전까지가 할인가이고, 종료 시각부터 판매가로 돌아간다. */
export function goodPreviewPeriodState(period: Pick<GoodPreviewPricePeriod, 'startsAt' | 'endsAt'>, now: number): 'before' | 'active' | 'ended' {
  if (now < Date.parse(period.startsAt)) return 'before';
  return now < Date.parse(period.endsAt) ? 'active' : 'ended';
}

/** 할인 시작 전이면 미리보기에 할인이 없는 까닭을 알린다. 기간 안이면 할인이 보이고, 기간이 없으면 말할 것이 없다. */
export function goodPreviewPeriodNote(period: Pick<GoodPreviewPricePeriod, 'startsAt' | 'endsAt'> | null, now: number = Date.now()): string | undefined {
  return period && goodPreviewPeriodState(period, now) === 'before' ? '할인 시작 전이라 미리보기에는 아직 할인이 나오지 않습니다.' : undefined;
}

/* 숨은 칸 'badge'에 고른 순서대로 쉼표로 이은 상품 표시문구. 표준 값만 고른 순서로 보이고, 첫 값은 옛 칸(badge)에도 둔다. */
function previewBadges(values: Record<string, string>): { badge: string | null; badges: string[] } {
  const { badges } = parseGoodBadgeText(values.badge ?? '');
  return { badge: badges[0] ?? null, badges };
}

export interface GoodPreviewInput {
  /** 폼에서 그대로 읽은 값 (FormData 키 기준) */
  values: Record<string, string>;
  /** 업로드 칸이 지금 보여주는 이미지 URL. 업로드 전 선택본도 포함된다. */
  imageUrls: Record<string, string | null>;
  /** 아트워크가 없는 레거시 레코드가 쓰던 배경 값 */
  fallbackBg: string | null;
  ip: Ip | null;
  /** 옵션 입력이 없는 레거시 호출의 재고 기본값. */
  stockQty: number;
  /** Only the saved, current review projection; never unsaved internal evidence. */
  kcDisclosures?: readonly GoodsKcDisclosure[];
  /** 저장된 기타 인증 공개 사본(SHEET-014). 고객 상세와 같은 parser를 거친다. */
  otherCertifications?: readonly GoodsOtherCertificationDisclosure[];
  /** 저장된 판매 방식(goods.option_sale_mode). 랜덤 판매면 공개 상세처럼 옵션을 '랜덤' 한 줄로 접는다(S36-051). */
  optionSaleMode?: GoodsOptionSaleMode;
  /**
   * 특정기간만 할인. 폼의 `price`는 판매가 그대로라 값만으로는 기간 할인이 보이지 않으므로 따로 받는다.
   * 지금이 할인 기간 안일 때만 옵션마다 이 금액을 빼고 정가를 취소선으로 남긴다 — 고객 화면도 기간 밖에서는 판매가다.
   */
  pricePeriod?: GoodPreviewPricePeriod | null;
  /** 기간 판정에 쓸 지금 시각(ms). 시험에서 고정한다. */
  now?: number;
}

/** 판매 중인 모든 옵션이 같은 '같은 옵션 배정 상한'을 쓸 때만 그 값을 안내한다(공개 계산 열의 allocation_limit과 같은 뜻). */
function randomAllocationLimit(rows: readonly GoodsOptionRow[]): GoodsOptionLimitPolicy | null {
  const active = rows.filter((row) => row.isActive !== false);
  const first = active[0];
  if (!first) return null;
  const limit = { orderMaxQty: first.orderMaxQty ?? null, memberMaxQty: first.memberMaxQty ?? null };
  if (active.some((row) => (row.orderMaxQty ?? null) !== limit.orderMaxQty || (row.memberMaxQty ?? null) !== limit.memberMaxQty)) return null;
  return limit.orderMaxQty === null && limit.memberMaxQty === null ? null : limit;
}

/** 비운 재고 칸(NaN, 0901-015)은 미리보기에서 0개로 본다. */
const previewQuantity = (value: number) => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

/**
 * 지금 폼에 들어 있는 값을 그대로 읽는다.
 * 필드마다 상태를 두면 입력을 하나 추가할 때마다 미리보기 배선을 잊게 된다 —
 * 폼 전체를 한 번에 읽으면 새 입력이 자동으로 미리보기에 반영된다.
 */
export function goodFormValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function trimmed(values: Record<string, string>, key: string) {
  return (values[key] ?? '').trim();
}

function previewNotice(values: Record<string, string>): GoodsNoticeInfo {
  return Object.fromEntries(
    GOODS_NOTICE_FIELDS.map((field) => [field.key, trimmed(values, field.formName) || null]),
  ) as GoodsNoticeInfo;
}

export function buildGoodPreview(input: GoodPreviewInput): GoodDetailContent {
  const { fallbackBg, imageUrls, ip, stockQty, values } = input;
  const descriptionFormat = values.descriptionFormat === 'html' ? 'html' : 'plain';
  const htmlContent = descriptionFormat === 'html' ? sanitizeGoodsDescription(trimmed(values, 'description')) : null;
  const stock = trimmed(values, 'stock') as Stock;
  const price = Number(trimmed(values, 'price'));
  const basePrice = Number.isFinite(price) && price >= 0 ? Math.trunc(price) : 0;
  const displayOrderText = trimmed(values, 'displayOrder');
  const displayOrderValue = displayOrderText ? Number(displayOrderText) : null;
  const rows = restoreGoodsOptionRows(values.variants);
  const now = input.now ?? Date.now();
  const period = input.pricePeriod && goodPreviewPeriodState(input.pricePeriod, now) === 'active' ? input.pricePeriod : null;
  const selectable: GoodOption[] | undefined = rows?.filter((row) => row.isActive !== false).map((row, index) => {
    const regularPrice = basePrice + Math.max(0, Math.trunc(row.extraPrice));
    /* 기간 중에는 옵션마다 같은 금액을 뺀 값이 판매 금액이고, 취소선 정가는 그 옵션의 할인 전 금액이다(공개 상세의 optionCompareAtPrice).
       저장 규칙상 할인 금액은 가장 싼 옵션보다 작지만, 입력이 어긋나도 0원 밑으로 내리지 않는다. */
    const sellingPrice = period ? Math.max(0, regularPrice - period.amount) : regularPrice;
    return {
      id: row.id ?? `preview-option-${index}`, name: row.name, code: row.code, attributes: row.attributes,
      price: sellingPrice, stockQty: previewQuantity(row.stockQty), isDefault: index === 0,
      ...(period ? { pricing: { regularPrice, effectivePrice: sellingPrice, pricePeriodId: PREVIEW_PRICE_PERIOD_ID, startsAt: period.startsAt, endsAt: period.endsAt, calculatedAt: new Date(now).toISOString() } } : {}),
    };
  });
  /* 공개 상세(lib/catalog toGood)와 같게 랜덤 판매는 판매 중인 옵션을 '랜덤' 한 줄(풀 합계)로 접고 같은 옵션 배정 상한을 싣는다. */
  const random = input.optionSaleMode === 'random';
  const options = random && selectable && rows
    ? collapseRandomGoodOptions(selectable).map((option) => ({ ...option, randomAllocationLimit: randomAllocationLimit(rows) }))
    : selectable;
  /* 즉시할인(기간 없음)은 폼 값만으로 정해진다: price=할인가, compareAtPrice=판매가. 판매가보다 크지 않은 값은 할인이 아니다. */
  const compare = Number(trimmed(values, 'compareAtPrice'));
  const catalogCompareAtPrice = trimmed(values, 'compareAtPrice') !== '' && Number.isInteger(compare) && compare > basePrice ? compare : null;
  const mainUrl = imageUrls.imagePath ?? null;
  const gallery: string[] = [];

  for (let slot = 0; slot < GOODS_GALLERY_MAX; slot += 1) {
    const url = imageUrls[`galleryPath${slot}`];
    if (url) gallery.push(imageBg(url));
  }

  return {
    good: {
      id: trimmed(values, 'id'),
      /* 상품 자동코드 칸의 값(저장 규칙처럼 대문자). 미리보기 카드 링크가 공개 상세 주소(ADR-0050)를 가리킨다. */
      ...(trimmed(values, 'code') ? { code: trimmed(values, 'code').toUpperCase() } : {}),
      ...(random ? { optionSaleMode: 'random' as const } : {}),
      name: trimmed(values, 'name') || '(상품 이름 미입력)',
      nameEn: trimmed(values, 'nameEn') || undefined,
      categoryId: trimmed(values, 'categoryId') || null,
      searchKeywords: normalizeGoodsSearchKeywords(trimmed(values, 'searchKeywords')),
      displayOrder: displayOrderValue !== null && Number.isInteger(displayOrderValue) && displayOrderValue >= 0 ? displayOrderValue : null,
      allowCardPayment: values.allowCardPayment !== 'false',
      allowBankTransfer: values.allowBankTransfer !== 'false',
      saleRestriction: values.saleRestriction === 'adult' ? 'adult' : 'none',
      orderQuantityLimitEnabled: values.orderQuantityLimitEnabled === 'true',
      minOrderQty: trimmed(values, 'minOrderQty') ? Number(values.minOrderQty) : null,
      maxOrderQty: trimmed(values, 'maxOrderQty') ? Number(values.maxOrderQty) : null,
      memberPurchaseLimitEnabled: values.memberPurchaseLimitEnabled === 'true',
      memberLifetimeQtyLimit: trimmed(values, 'memberLifetimeQtyLimit') ? Number(values.memberLifetimeQtyLimit) : null,
      ip: trimmed(values, 'ipId'),
      /* 옵션 입력이 없는 옛 호출은 기본 판매가에 기간 할인을 바로 적용한다. 옵션이 있으면 아래 optionPriceRange가 옵션 금액으로 덮는다. */
      price: period && !options ? Math.max(0, basePrice - period.amount) : basePrice,
      catalogPrice: basePrice,
      catalogCompareAtPrice,
      /* 공개 상세·목록과 같은 규칙으로 취소선 정가를 정한다(옵션이 있으면 가장 싼 옵션의 정가). 어느 쪽 할인이든 할인율 표시 설정이 켜져 있어야 보인다. */
      compareAtPrice: period && !options ? basePrice : goodCompareAtPrice({ price: basePrice, compareAtPrice: catalogCompareAtPrice }, options),
      showDiscountRate: values.showDiscountRate !== 'false',
      ...(options ? { options, ...optionPriceRange(options) } : {}),
      ...previewBadges(values),
      stock: options && !options.some((option) => option.stockQty > 0) ? 'soldout' : STOCK_VALUES.has(stock) ? stock : 'ok',
      stockQty: options ? options.reduce((total, option) => total + option.stockQty, 0) : stockQty,
      img: mainUrl ? imageBg(mainUrl) : fallbackBg || PREVIEW_PLACEHOLDER_BG,
    },
    ip,
    description: htmlContent ? htmlContent.html || null : trimmed(values, 'description') || null,
    descriptionFormat,
    descriptionImagePaths: htmlContent?.imagePaths ?? [],
    gallery,
    detailImageUrls: GOODS_DETAIL_IMAGE_FIELD_NAMES.map((name) => imageUrls[name]).filter((url): url is string => Boolean(url)),
    notice: previewNotice(values),
    kcDisclosures: parseGoodsKcDisclosures(input.kcDisclosures ?? []) ?? [],
    otherCertifications: parseGoodsOtherCertificationDisclosures(input.otherCertifications ?? []) ?? [],
  };
}
