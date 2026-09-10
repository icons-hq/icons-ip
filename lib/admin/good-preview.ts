import type { GoodOption, Ip, Stock } from '@/lib/data';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { GOODS_NOTICE_FIELDS, type GoodsNoticeInfo } from '@/lib/goods-notice';
import { imageBg } from '@/lib/media';
import { GOODS_GALLERY_MAX, normalizeGoodsSearchKeywords } from './catalog';
import { restoreGoodsOptionRows } from './goods-option-editor';
import { optionPriceRange } from '@/lib/goods-options';

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
}

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
  const stock = trimmed(values, 'stock') as Stock;
  const price = Number(trimmed(values, 'price'));
  const basePrice = Number.isFinite(price) && price >= 0 ? Math.trunc(price) : 0;
  const displayOrderText = trimmed(values, 'displayOrder');
  const displayOrderValue = displayOrderText ? Number(displayOrderText) : null;
  const rows = restoreGoodsOptionRows(values.variants);
  const options: GoodOption[] | undefined = rows?.filter((row) => row.isActive !== false).map((row, index) => ({
    id: row.id ?? `preview-option-${index}`, name: row.name, code: row.code, attributes: row.attributes,
    price: basePrice + Math.max(0, Math.trunc(row.extraPrice)), stockQty: Math.max(0, Math.trunc(row.stockQty)), isDefault: index === 0,
  }));
  const mainUrl = imageUrls.imagePath ?? null;
  const gallery: string[] = [];

  for (let slot = 0; slot < GOODS_GALLERY_MAX; slot += 1) {
    const url = imageUrls[`galleryPath${slot}`];
    if (url) gallery.push(imageBg(url));
  }

  return {
    good: {
      id: trimmed(values, 'id'),
      name: trimmed(values, 'name') || '(굿즈 이름 미입력)',
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
      type: trimmed(values, 'type') || '(유형 미입력)',
      price: basePrice,
      ...(options ? { options, ...optionPriceRange(options) } : {}),
      badge: trimmed(values, 'badge') || null,
      stock: options && !options.some((option) => option.stockQty > 0) ? 'soldout' : STOCK_VALUES.has(stock) ? stock : 'ok',
      stockQty: options ? options.reduce((total, option) => total + option.stockQty, 0) : stockQty,
      img: mainUrl ? imageBg(mainUrl) : fallbackBg || PREVIEW_PLACEHOLDER_BG,
    },
    ip,
    description: trimmed(values, 'description') || null,
    gallery,
    detailImageUrl: imageUrls.detailImagePath ?? null,
    notice: previewNotice(values),
  };
}
