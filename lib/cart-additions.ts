import { cartItemKey, setCartItemQuantity, type CartItem } from './cart';

export const MAX_CART_SELECTION_LINES = 51;
const MAX_QUANTITY = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CartSelectionItem extends CartItem { stockQty: number }
export interface CartAdditionEntry extends CartItem { expectedQty: number }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function quantity(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= MAX_QUANTITY;
}
function identity(value: Record<string, unknown>) {
  const goodId = typeof value.goodId === 'string' ? value.goodId.trim() : '';
  const variantId = typeof value.variantId === 'string' ? value.variantId.trim().toLowerCase() : '';
  return goodId && goodId.length <= 200 && UUID.test(variantId) ? { goodId, variantId } : null;
}

/** Every requested line must be valid. Cart storage's best-effort decoder is not
 * a mutation validator: dropping a malformed extra would add only the base. */
export function parseCartAdditionRequest(value: unknown): CartAdditionEntry[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CART_SELECTION_LINES) return null;
  const entries: CartAdditionEntry[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!record(row)) return null;
    const id = identity(row);
    if (!id || !quantity(row.qty, 1) || !quantity(row.expectedQty, 0)
      || !quantity(row.qty + row.expectedQty, 1) || seen.has(id.variantId)) return null;
    seen.add(id.variantId);
    entries.push({ ...id, qty: row.qty, expectedQty: row.expectedQty });
  }
  return entries;
}

export function prepareCartAddition(current: readonly CartItem[], selection: readonly CartSelectionItem[]):
  { ok: true; items: CartItem[]; entries: CartAdditionEntry[] } | { ok: false; reason: 'input' | 'stock' } {
  if (!selection.length || selection.length > MAX_CART_SELECTION_LINES) return { ok: false, reason: 'input' };
  const grouped = new Map<string, CartSelectionItem>();
  for (const line of selection) {
    const id = identity(line as unknown as Record<string, unknown>);
    if (!id || !quantity(line.qty, 1) || !quantity(line.stockQty, 0)) return { ok: false, reason: 'input' };
    const previous = grouped.get(id.variantId);
    const qty = (previous?.qty ?? 0) + line.qty;
    if ((previous && previous.goodId !== id.goodId) || !quantity(qty, 1)) return { ok: false, reason: 'input' };
    grouped.set(id.variantId, { ...id, qty, stockQty: Math.min(previous?.stockQty ?? line.stockQty, line.stockQty) });
  }
  let items = [...current];
  const entries: CartAdditionEntry[] = [];
  for (const line of grouped.values()) {
    const expectedQty = current.find((item) => cartItemKey(item.goodId, item.variantId) === cartItemKey(line.goodId, line.variantId))?.qty ?? 0;
    const nextQty = expectedQty + line.qty;
    if (!quantity(nextQty, 1)) return { ok: false, reason: 'input' };
    if (nextQty > line.stockQty) return { ok: false, reason: 'stock' };
    entries.push({ goodId: line.goodId, variantId: line.variantId, qty: line.qty, expectedQty });
    items = setCartItemQuantity(items, line.goodId, nextQty, line.variantId);
  }
  return { ok: true, items, entries };
}

export function parseCartAdditionSnapshot(value: unknown): CartItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: CartItem[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!record(row)) return null;
    const id = identity(row);
    if (!id || !quantity(row.qty, 1) || seen.has(id.variantId)) return null;
    seen.add(id.variantId); items.push({ ...id, qty: row.qty });
  }
  return items;
}
