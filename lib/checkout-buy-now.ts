import { isUuid } from '@/lib/uuid';
import { cartItemKey, type CartItem } from './cart';
import { goodsCustomInputValues, parseGoodsCustomInputSelection } from './goods-custom-inputs';

/*
 * 바로구매(ADR-0030 · 10/14 회의 1014-033·037·039). 상품 상세·위시의 [구매하기]는 고른 옵션·수량·추가 구성·직접입력값만
 * 주문서 초안으로 만들고, 장바구니를 읽지도 바꾸지도 않는다(담기·수량 합산 없음).
 *
 * 로그인 전에 누르면 선택을 이 탭의 세션 저장소에 두고 로그인으로 보낸다. 로그인 뒤 상품 상세로 돌아오면 그 선택으로
 * 이어서 주문서를 연다. 직접입력값은 URL에 싣지 않는다(개인정보) — 저장소는 이 탭에서만 읽히고 30분이 지나면 버린다.
 */

export const MAX_DIRECT_LINES = 51;
const MAX_QUANTITY = 999_999_999;
const PENDING_KEY = 'icons_buy_now_v1';
const PENDING_TTL_MS = 30 * 60 * 1000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 바로구매 줄. 같은 굿즈·옵션·직접입력값이 두 번 오거나 본품이 없으면 받지 않는다(DB 초안 검증과 같은 판정). */
export function parseDirectCheckoutEntries(baseGoodId: string, value: unknown): CartItem[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_DIRECT_LINES) return null;
  const lines: CartItem[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!record(row) || typeof row.goodId !== 'string' || !row.goodId.trim() || row.goodId.length > 200
      || typeof row.variantId !== 'string' || !isUuid(row.variantId)
      || typeof row.qty !== 'number' || !Number.isInteger(row.qty) || row.qty < 1 || row.qty > MAX_QUANTITY) return null;
    const customInputs = row.customInputs === undefined ? undefined : parseGoodsCustomInputSelection(row.customInputs);
    if (customInputs === null) return null;
    const line: CartItem = { goodId: row.goodId.trim(), variantId: row.variantId.toLowerCase(), qty: row.qty, ...(customInputs ? { customInputs } : {}) };
    const key = cartItemKey(line.goodId, line.variantId, line.customInputs);
    if (seen.has(key)) return null;
    seen.add(key);
    lines.push(line);
  }
  return lines.some((line) => line.goodId === baseGoodId) ? lines : null;
}

export function directCheckoutLinePayload(line: CartItem) {
  return {
    good_id: line.goodId,
    variant_id: line.variantId,
    qty: line.qty,
    input_revision: line.customInputs?.revision ?? 0,
    input_values: goodsCustomInputValues(line.customInputs),
  };
}

/** 로그인 뒤 이어서 진행할 바로구매 선택. 화면 상태(옵션·수량·추가 구성·입력 칸)와 주문서로 보낼 줄을 함께 둔다. */
export interface PendingBuyNow {
  goodId: string;
  savedAt: number;
  entries: CartItem[];
  selection: {
    variantId: string;
    quantity: number;
    additions: { goodId: string; name: string; variantId?: string; quantity: number }[];
    customInputValues: Record<string, Record<string, string>>;
  };
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingBuyNow(pending: Omit<PendingBuyNow, 'savedAt'>, now = Date.now()): void {
  try {
    storage()?.setItem(PENDING_KEY, JSON.stringify({ ...pending, savedAt: now }));
  } catch {
    /* 저장소가 막혀 있으면 로그인 뒤 다시 고르게 된다. */
  }
}

/** 이 굿즈의 미완료 바로구매를 한 번만 꺼낸다(꺼내면 지운다). 다른 굿즈·오래된·모양이 틀린 값은 버린다. */
export function takePendingBuyNow(goodId: string, now = Date.now()): PendingBuyNow | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(PENDING_KEY);
    if (raw) store.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.goodId !== goodId || typeof value.savedAt !== 'number' || now - value.savedAt > PENDING_TTL_MS || now < value.savedAt) return null;
    const entries = parseDirectCheckoutEntries(goodId, value.entries);
    const selection = value.selection;
    if (!entries || !record(selection) || typeof selection.variantId !== 'string' || typeof selection.quantity !== 'number'
      || !Array.isArray(selection.additions) || !record(selection.customInputValues)) return null;
    return {
      goodId,
      savedAt: value.savedAt,
      entries,
      selection: selection as PendingBuyNow['selection'],
    };
  } catch {
    return null;
  }
}

/** 로그인 뒤 돌아올 상품 상세 주소. 고른 옵션만 기존 `?variant=` 로 싣는다 — 직접입력값은 싣지 않는다. */
export function buyNowReturnPath(goodId: string, variantId: string | null | undefined): string {
  const path = `/shop/${encodeURIComponent(goodId)}`;
  return variantId ? `${path}?variant=${encodeURIComponent(variantId)}` : path;
}
