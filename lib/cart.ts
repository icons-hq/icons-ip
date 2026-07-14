export const CART_STORAGE_KEY = 'icons_cart_v1';

export interface CartItem {
  goodId: string;
  qty: number;
}

export type CartMode = 'local' | 'server';

export type CartActionResult =
  | { ok: true; mode: CartMode; items: CartItem[] }
  | { ok: false; mode: CartMode; error?: string };

interface StoredCartV1 {
  version: 1;
  items: CartItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];

  const items: CartItem[] = [];
  const indexByGoodId = new Map<string, number>();

  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const goodId = typeof candidate.goodId === 'string' ? candidate.goodId.trim() : '';
    const qty = candidate.qty;
    if (!goodId || !Number.isInteger(qty) || (qty as number) <= 0) continue;

    const existingIndex = indexByGoodId.get(goodId);
    if (existingIndex === undefined) {
      indexByGoodId.set(goodId, items.length);
      items.push({ goodId, qty: qty as number });
      continue;
    }

    items[existingIndex] = {
      goodId,
      qty: Math.max(items[existingIndex].qty, qty as number),
    };
  }

  return items;
}

export function parseStoredCart(value: string | null): CartItem[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1) return [];
    return normalizeCartItems(parsed.items);
  } catch {
    return [];
  }
}

export function serializeCart(items: readonly CartItem[]): string {
  const payload: StoredCartV1 = {
    version: 1,
    items: normalizeCartItems(items),
  };
  return JSON.stringify(payload);
}

export function setCartItemQuantity(
  items: readonly CartItem[],
  goodIdValue: string,
  qty: number,
): CartItem[] {
  const normalized = normalizeCartItems(items);
  const goodId = goodIdValue.trim();
  if (!goodId || !Number.isInteger(qty)) return normalized;

  const existingIndex = normalized.findIndex((item) => item.goodId === goodId);
  if (qty <= 0) {
    return existingIndex === -1
      ? normalized
      : normalized.filter((item) => item.goodId !== goodId);
  }

  if (existingIndex === -1) return [...normalized, { goodId, qty }];

  return normalized.map((item) => (
    item.goodId === goodId ? { goodId, qty } : item
  ));
}

export function cartQuantityTotal(items: readonly CartItem[]): number {
  return normalizeCartItems(items).reduce((total, item) => total + item.qty, 0);
}

export function cartItemsAfterSignOut(mode: CartMode, localItems: readonly CartItem[]): CartItem[] {
  return mode === 'local' ? normalizeCartItems(localItems) : [];
}
