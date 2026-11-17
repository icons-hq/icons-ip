import type { AdultGoodsAccess } from '@/lib/adult-goods';
import type { GoodsTransactionDisplay, GoodsTransactionLine } from '@/lib/goods-transaction';
import { imageBg } from '@/lib/media';

/**
 * 주문 품목 줄(MD-0036). 주문내역과 주문 상세가 같은 `OrderLineItem`으로 그리는 읽기 모델이다.
 *
 * 이름·수량·단가는 주문 시점 스냅샷이고, 썸네일·IP명은 현재 굿즈 행에서, 정가·복수구매 할인은 거래 영수증에서 보강한다.
 * 보강 값이 없어도 줄은 항상 만들어진다 — 이 모듈은 throw하지 않는다.
 */
export interface OrderLineView {
  /** order_items.id 또는 선물 `${goodId}:${variantId}`. */
  key: string;
  goodId: string;
  name: string;
  optionName: string | null;
  qty: number;
  ipName: string | null;
  /** CSS background 원값. 렌더에서 `goodsImageBackground`를 거친다. 19금 가림 줄은 항상 null이다. */
  thumbnail: string | null;
  adultMasked: boolean;
  /** 구매가격(줄 합계): v2 영수증 줄이면 (판매가 − 복수구매 단가 할인) × 수량, 아니면 주문 단가 × 수량. 주문 단위 쿠폰·적립금은 섞지 않는다. */
  purchaseAmount: number | null;
  /** 제품 가격(줄 합계): 영수증 줄의 정가 × 수량. 영수증이 없으면 null. */
  regularAmount: number | null;
}

export interface OrderLinePriceDisplay {
  primary: number;
  strike: number | null;
}

/** 주문내역에서 옵션 줄을 보이지 않는 이름. 옵션이 하나뿐인 굿즈의 자동 이름이라 고객에게 정보가 없다. */
const DEFAULT_OPTION_NAME = '기본 옵션';

export function visibleOptionName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name && name !== DEFAULT_OPTION_NAME ? name : null;
}

/**
 * 가격 표시 규칙(MD-0036 5번): 구매가격이 제품 가격보다 낮으면 구매가격 + 정가 취소선, 같거나 제품 가격이 없으면 숫자 하나
 * ("동일 시 제품 가격만 노출"), 구매가격이 더 높은 데이터 이상은 구매가격만. 구매가격을 모르면 아무것도 보이지 않는다.
 */
export function orderLinePriceDisplay(line: Pick<OrderLineView, 'purchaseAmount' | 'regularAmount'>): OrderLinePriceDisplay | null {
  const { purchaseAmount, regularAmount } = line;
  if (purchaseAmount === null) return null;
  if (regularAmount !== null && purchaseAmount < regularAmount) return { primary: purchaseAmount, strike: regularAmount };
  return { primary: purchaseAmount, strike: null };
}

export interface OrderLineInputItem {
  key: string;
  /** 영수증 줄 id. 주문 품목 id와 같다. 선물 목록처럼 품목 id가 없으면 생략한다. */
  lineId?: string;
  goodId: string;
  variantId?: string | null;
  name: string;
  optionName: string | null;
  qty: number;
  unitPrice: number | null;
  /** 품목이 자기 이미지 경로를 가진 경우(선물 스냅샷). 있으면 굿즈 행의 이미지보다 먼저 쓴다. */
  imagePath?: string | null;
}

export interface OrderLineGoodInfo {
  ipId: string | null;
  imagePath: string | null;
  bg: string | null;
  saleRestriction: 'none' | 'adult';
}

function safeAmount(unit: number, qty: number): number | null {
  if (!Number.isSafeInteger(unit) || unit < 0 || !Number.isSafeInteger(qty) || qty < 1) return null;
  const total = unit * qty;
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * 영수증 줄 매칭(순서대로): ① lineId 일치 ② (goodId, variantId) 일치 줄이 정확히 1개 ③ 같은 goodId 줄이 모두 같은
 * 정가·판매가·복수구매 단가 할인이면 그 값 ④ 그 밖에는 영수증 값 없음(구매가 = 주문 단가 × 수량, 정가 없음).
 * 랜덤 판매 줄은 합쳐진 한 줄이라 ①이 어긋나도 ②·③에서 같은 단가로 이어진다.
 */
function matchReceiptLine(item: OrderLineInputItem, receipt: GoodsTransactionDisplay | null): GoodsTransactionLine | null {
  const lines = receipt?.lines;
  if (!lines?.length) return null;
  if (item.lineId) {
    const exact = lines.find((line) => line.lineId === item.lineId);
    if (exact) return exact;
  }
  if (item.variantId) {
    const byVariant = lines.filter((line) => line.goodId === item.goodId && line.variantId === item.variantId);
    if (byVariant.length === 1) return byVariant[0];
  }
  const sameGood = lines.filter((line) => line.goodId === item.goodId);
  const [first] = sameGood;
  if (first && sameGood.every((line) => line.regularUnitPrice === first.regularUnitPrice
    && line.unitPrice === first.unitPrice && line.volumeUnitDiscount === first.volumeUnitDiscount)) return first;
  return null;
}

function thumbnailFor(item: OrderLineInputItem, good: OrderLineGoodInfo | undefined, imageUrl: (path: string) => string | null): string | null {
  const path = item.imagePath ?? good?.imagePath ?? null;
  if (path) {
    const url = imageUrl(path);
    if (url) return imageBg(url);
  }
  return good?.bg ?? null;
}

export function buildOrderLines(input: {
  items: ReadonlyArray<OrderLineInputItem>;
  receipt: GoodsTransactionDisplay | null;
  goods: ReadonlyMap<string, OrderLineGoodInfo>;
  ipTitles: ReadonlyMap<string, string>;
  adultAccess: AdultGoodsAccess;
  imageUrl: (path: string) => string | null;
}): OrderLineView[] {
  return input.items.map((item): OrderLineView => {
    const good = input.goods.get(item.goodId);
    const ipName = (good?.ipId ? input.ipTitles.get(good.ipId) : undefined) ?? null;
    const adultMasked = good?.saleRestriction === 'adult' && input.adultAccess !== 'full';
    const receiptLine = matchReceiptLine(item, input.receipt);
    const purchaseUnit = receiptLine ? receiptLine.unitPrice - receiptLine.volumeUnitDiscount : item.unitPrice;
    return {
      key: item.key,
      goodId: item.goodId,
      name: item.name,
      optionName: item.optionName,
      qty: item.qty,
      ipName,
      thumbnail: adultMasked ? null : thumbnailFor(item, good, input.imageUrl),
      adultMasked,
      purchaseAmount: purchaseUnit === null ? null : safeAmount(purchaseUnit, item.qty),
      regularAmount: receiptLine ? safeAmount(receiptLine.regularUnitPrice, item.qty) : null,
    };
  });
}
