import { isUuid } from '@/lib/uuid';
import { parseGoodsCustomInputSelection } from './goods-custom-inputs';
import { cartItemKey, setCartItemQuantity, type CartItem } from './cart';

export const MAX_CART_SELECTION_LINES = 51;
const MAX_QUANTITY = 2147483647;
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
  const customInputs = value.customInputs === undefined ? undefined : parseGoodsCustomInputSelection(value.customInputs);
  return goodId && goodId.length <= 200 && isUuid(variantId) && customInputs !== null ? { goodId, variantId, ...(customInputs ? { customInputs } : {}) } : null;
}

/** Every requested line must be valid. Cart storage's best-effort decoder is not
 * a mutation validator: dropping a malformed extra would add only the base. */
export function parseCartAdditionRequest(value: unknown): CartAdditionEntry[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_CART_SELECTION_LINES) return null;
  const entries: CartAdditionEntry[] = [];
  const seen = new Set<string>();
  const owners = new Map<string,string>();
  for (const row of value) {
    if (!record(row)) return null;
    const id = identity(row);
    if (!id || (owners.has(id.variantId) && owners.get(id.variantId)!==id.goodId) || !quantity(row.qty, 1) || !quantity(row.expectedQty, 0)
      || !quantity(row.qty + row.expectedQty, 1) || seen.has(cartItemKey(id.goodId,id.variantId,id.customInputs))) return null;
    owners.set(id.variantId,id.goodId);
    seen.add(cartItemKey(id.goodId,id.variantId,id.customInputs));
    entries.push({ ...id, qty: row.qty, expectedQty: row.expectedQty });
  }
  return entries;
}

export function prepareCartAddition(current: readonly CartItem[], selection: readonly CartSelectionItem[]):
  { ok: true; items: CartItem[]; entries: CartAdditionEntry[] } | { ok: false; reason: 'input' | 'stock' } {
  if (!selection.length || selection.length > MAX_CART_SELECTION_LINES) return { ok: false, reason: 'input' };
  const grouped = new Map<string, CartSelectionItem>();
  const owners = new Map<string,string>();
  for (const line of selection) {
    const id = identity(line as unknown as Record<string, unknown>);
    if (!id || (owners.has(id.variantId) && owners.get(id.variantId)!==id.goodId) || !quantity(line.qty, 1) || !quantity(line.stockQty, 0)) return { ok: false, reason: 'input' };
    owners.set(id.variantId,id.goodId);
    const key = cartItemKey(id.goodId,id.variantId,id.customInputs);
    const previous = grouped.get(key);
    const qty = (previous?.qty ?? 0) + line.qty;
    if ((previous && previous.goodId !== id.goodId) || !quantity(qty, 1)) return { ok: false, reason: 'input' };
    grouped.set(key, { ...id, qty, stockQty: Math.min(previous?.stockQty ?? line.stockQty, line.stockQty) });
  }
  let items = [...current];
  const entries: CartAdditionEntry[] = [];
  for (const line of grouped.values()) {
    const expectedQty = current.find((item) => cartItemKey(item.goodId, item.variantId,item.customInputs) === cartItemKey(line.goodId, line.variantId,line.customInputs))?.qty ?? 0;
    const nextQty = expectedQty + line.qty;
    if (!quantity(nextQty, 1)) return { ok: false, reason: 'input' };
    const otherQty = items.filter(item => item.variantId === line.variantId && cartItemKey(item.goodId,item.variantId,item.customInputs) !== cartItemKey(line.goodId,line.variantId,line.customInputs)).reduce((sum,item)=>sum+item.qty,0);
    if (nextQty+otherQty > line.stockQty) return { ok: false, reason: 'stock' };
    entries.push({ goodId: line.goodId, variantId: line.variantId, qty: line.qty, expectedQty, ...(line.customInputs?{customInputs:line.customInputs}:{}) });
    items = setCartItemQuantity(items, line.goodId, nextQty, line.variantId,line.customInputs);
  }
  return { ok: true, items, entries };
}

export function parseCartAdditionSnapshot(value: unknown): CartItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: CartItem[] = [];
  const seen = new Set<string>();
  const owners = new Map<string,string>();
  for (const row of value) {
    if (!record(row)) return null;
    const id = identity(row);
    if (!id || (owners.has(id.variantId) && owners.get(id.variantId)!==id.goodId) || !quantity(row.qty, 1) || seen.has(cartItemKey(id.goodId,id.variantId,id.customInputs))) return null;
    owners.set(id.variantId,id.goodId);
    seen.add(cartItemKey(id.goodId,id.variantId,id.customInputs)); items.push({ ...id, qty: row.qty });
  }
  return items;
}
