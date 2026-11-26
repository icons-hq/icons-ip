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
  /** 지금 유효한 수량. 부분 취소(재고 부족)가 있으면 원래 수량보다 적고, 전부 취소됐으면 0이다. 금액은 이 수량 기준이다. */
  qty: number;
  /** 부분 취소로 빠진 수량. 부분 취소가 없으면 키 자체가 없다. `qty + canceledQty`가 주문 당시 수량이다. */
  canceledQty?: number;
  /** canceledQty 가운데 부분 반품(ADR-0047)으로 돌아온 수량. 없으면 키가 없고 canceledQty는 모두 재고 부족 부분 취소다. */
  returnedQty?: number;
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

/** 배치 RPC `my_order_item_display`의 한 줄. 정가·복수구매 단가 할인이 null이면 영수증 값이 없는 줄(v1·배정 행 정가 불일치)이다. */
export interface OrderItemDisplay {
  regularUnitPrice: number | null;
  volumeUnitDiscount: number | null;
  /** 부분 취소 뒤 남은 수량(0 이상). */
  activeQty: number;
}

export interface OrderLineGoodInfo {
  ipId: string | null;
  imagePath: string | null;
  bg: string | null;
  saleRestriction: 'none' | 'adult';
  adultReadable?: boolean;
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

/**
 * 한 줄의 단가·유효 수량. 배치 RPC 값(`display`)이 있으면 그것을 쓰고(정가가 있으면 구매 단가 = 주문 단가 − 복수구매 단가 할인),
 * 없으면 영수증 줄 매칭, 그것도 없으면 주문 단가 × 주문 수량이다. 유효 수량은 주문 수량을 넘지 않는다.
 */
function lineValues(item: OrderLineInputItem, receipt: GoodsTransactionDisplay | null, display: OrderItemDisplay | undefined) {
  if (display) {
    const hasReceiptValues = display.regularUnitPrice !== null && display.volumeUnitDiscount !== null;
    const activeQty = Number.isSafeInteger(display.activeQty) ? Math.min(Math.max(display.activeQty, 0), item.qty) : item.qty;
    return {
      activeQty,
      purchaseUnit: item.unitPrice === null ? null : hasReceiptValues ? item.unitPrice - display.volumeUnitDiscount! : item.unitPrice,
      regularUnit: hasReceiptValues ? display.regularUnitPrice : null,
    };
  }
  const receiptLine = matchReceiptLine(item, receipt);
  return {
    activeQty: item.qty,
    purchaseUnit: receiptLine ? receiptLine.unitPrice - receiptLine.volumeUnitDiscount : item.unitPrice,
    regularUnit: receiptLine ? receiptLine.regularUnitPrice : null,
  };
}

export function buildOrderLines(input: {
  items: ReadonlyArray<OrderLineInputItem>;
  receipt: GoodsTransactionDisplay | null;
  /** 품목(`lineId`)별 배치 RPC 값. 있으면 영수증 줄 매칭보다 앞선다 — 정가·복수구매 할인과 부분 취소 뒤 수량을 함께 준다. */
  display?: ReadonlyMap<string, OrderItemDisplay>;
  goods: ReadonlyMap<string, OrderLineGoodInfo>;
  ipTitles: ReadonlyMap<string, string>;
  adultAccess: AdultGoodsAccess;
  imageUrl: (path: string) => string | null;
}): OrderLineView[] {
  return input.items.map((item): OrderLineView => {
    const good = input.goods.get(item.goodId);
    const ipName = (good?.ipId ? input.ipTitles.get(good.ipId) : undefined) ?? null;
    const adultMasked = good?.saleRestriction === 'adult' && (good.adultReadable === false
      || (input.adultAccess !== 'full' && !(input.adultAccess === 'scoped' && good.adultReadable === true)));
    const { activeQty, purchaseUnit, regularUnit } = lineValues(item, input.receipt, item.lineId ? input.display?.get(item.lineId) : undefined);
    const canceledQty = item.qty - activeQty;
    return {
      key: item.key,
      goodId: item.goodId,
      name: item.name,
      optionName: item.optionName,
      qty: activeQty,
      ...(canceledQty > 0 ? { canceledQty } : {}),
      ipName,
      thumbnail: adultMasked ? null : thumbnailFor(item, good, input.imageUrl),
      adultMasked,
      /* 전부 취소된 줄(유효 수량 0)은 없는 수량의 가격을 지어내지 않는다. */
      purchaseAmount: purchaseUnit === null ? null : safeAmount(purchaseUnit, activeQty),
      regularAmount: regularUnit === null ? null : safeAmount(regularUnit, activeQty),
    };
  });
}
