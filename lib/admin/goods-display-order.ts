/*
 * 상품의 진열 순서(`goods.display_order`) — 고객 화면 '추천순'에서 숫자가 작은 상품이 앞에 나온다.
 * 숫자를 넣은 상품이 뒤따르는 넣지 않은 상품보다 앞이고, 같은 숫자끼리는 상품 URL 순이다(lib/shop-catalog.ts `compareRecommendedGoods`).
 * 이 파일은 '지금 순서 보기' 선택창과 번호 칸 요약이 함께 쓰는 값·판정이다. 운영자 화면에는 상품 URL(내부 번호)을 보이지 않는다(화면 규칙 8).
 */
export const GOODS_DISPLAY_ORDER_PATH = '/admin/catalog/goods';
export const GOODS_DISPLAY_ORDER_PAGE_SIZE = 20;
/** 진열 순서는 0 이상의 정수이고 DB 정수 칸에 들어가는 값까지만 받는다(lib/admin/catalog.ts INT32_MAX와 같다). */
export const GOODS_DISPLAY_ORDER_MAX = 2147483647;
/** 같은 번호의 상품 이름을 요약에 보일 개수. 그보다 많으면 '외 N개'로 줄인다. */
export const GOODS_DISPLAY_ORDER_SLOT_NAMES = 3;

export interface GoodsDisplayOrderRow {
  /** 상품 URL. 줄을 알아보고 '이 상품'을 가리는 데만 쓰고 화면에 보이지 않는다. */
  id: string;
  name: string;
  imageUrl: string | null;
  /** 이 상품의 진열 순서(0 이상). */
  order: number;
  /** 전체 순서에서 바로 앞 줄 상품의 번호. 맨 앞이면 null. 같은 번호가 앞에 있으면 이 줄의 번호와 같다. */
  previousOrder: number | null;
  published: boolean;
}
export interface GoodsDisplayOrderPage { rows: GoodsDisplayOrderRow[]; total: number; page: number; pageSize: 20 }
export interface GoodsDisplayOrderRequest { query: string; page: number }
/** 어떤 번호를 쓰고 있는 다른 상품들. `names`는 앞쪽 몇 개, `total`은 전체 개수다. */
export interface GoodsDisplayOrderSlot { order: number; names: string[]; total: number }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** 진열 순서 글자(`"3"`)를 숫자로 읽는다. 비었거나 0 이상의 정수가 아니면 null이다. */
export function parseDisplayOrderText(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,10}$/.test(value)) return null;
  const order = Number(value);
  return order <= GOODS_DISPLAY_ORDER_MAX ? order : null;
}
export function parseGoodsDisplayOrderRequest(value: unknown): GoodsDisplayOrderRequest | null {
  if (!record(value) || typeof value.query !== 'string' || value.query.trim().length > 100
    || !Number.isSafeInteger(value.page) || Number(value.page) < 1 || Number(value.page) > 100000) return null;
  return { query: value.query.trim(), page: Number(value.page) };
}
export function parseGoodsDisplayOrderSlotRequest(value: unknown): { order: number; goodId: string | null } | null {
  if (!record(value) || !Number.isSafeInteger(value.order) || Number(value.order) < 0 || Number(value.order) > GOODS_DISPLAY_ORDER_MAX) return null;
  const goodId = value.goodId === null || value.goodId === undefined ? null : typeof value.goodId === 'string' ? value.goodId.trim() : undefined;
  return goodId === undefined || goodId === '' || (goodId !== null && goodId.length > 200) ? null : { order: Number(value.order), goodId };
}

/**
 * 이 줄의 '바로 앞'에 둘 번호. 한 칸 앞 번호(`order - 1`)가 비어 있을 때만 준다.
 * 줄의 번호가 0이거나, 바로 앞 줄이 그 번호를 쓰고 있거나, 같은 번호의 상품이 앞에 있으면 이유를 돌려준다.
 * 같은 번호가 앞에 있는 줄은 그 묶음의 첫 줄에서 같은 일을 할 수 있다.
 */
export function displayOrderBefore(row: Pick<GoodsDisplayOrderRow, 'order' | 'previousOrder'>): { order: number } | { reason: string } {
  if (row.order <= 0) return { reason: '더 앞 번호 없음' };
  if (row.previousOrder !== null && row.previousOrder >= row.order) return { reason: '같은 번호가 앞에 있음' };
  if (row.previousOrder !== null && row.previousOrder >= row.order - 1) return { reason: '바로 앞 번호를 쓰는 상품이 있음' };
  return { order: row.order - 1 };
}

/** 번호 칸 아래 한 줄: 이 번호를 이미 쓰는 상품이 있는지 알려 준다. */
export function displayOrderSlotReadback(slot: GoodsDisplayOrderSlot): string {
  if (slot.total <= 0) return `${slot.order}번은 아직 쓰는 상품이 없습니다.`;
  const rest = slot.total - slot.names.length;
  return `${slot.order}번은 이미 쓰는 상품이 있습니다(${slot.names.join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}). 번호가 같은 상품끼리는 앞뒤를 정할 수 없습니다.`;
}
/** '[이 앞에 두기]'로 넣은 번호를 그대로 두고 있을 때의 한 줄. */
export function displayOrderAnchorReadback(anchor: { name: string; order: number }): string {
  return `‘${anchor.name}’ 바로 앞에 둡니다. 그 상품은 지금 ${anchor.order}번입니다.`;
}
