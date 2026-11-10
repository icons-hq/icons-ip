import { goodsCustomInputIdentity, parseGoodsCustomInputSelection, type GoodsCustomInputSelection } from './goods-custom-inputs';
export const CART_STORAGE_KEY = 'icons_cart_v1';

export interface CartItem { goodId: string; variantId: string; qty: number; customInputs?: GoodsCustomInputSelection }
/** Only the storage migration boundary accepts a missing option. */
export interface LegacyCartItem { goodId: string; qty: number; variantId?: undefined }
export type StoredCartItem = CartItem | LegacyCartItem;
export type CartMode = 'local'|'server';
export type CartActionResult =
  | {ok:true;mode:CartMode;items:CartItem[]}
  | {ok:false;mode:CartMode;error?:string;unresolvedItems?:LegacyCartItem[]};

const VARIANT_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isRecord(value:unknown):value is Record<string,unknown> {return typeof value==='object'&&value!==null&&!Array.isArray(value);}
export function cartItemKey(goodId:string,variantId:string,customInputs?:GoodsCustomInputSelection) {
  return customInputs ? JSON.stringify([goodId,variantId,goodsCustomInputIdentity(customInputs)]) : JSON.stringify([goodId,variantId]);
}
function normalizeVariant(value:unknown):string|null|undefined {
  if (value===undefined || value===null) return undefined;
  return typeof value==='string'&&VARIANT_UUID.test(value.trim())?value.trim().toLowerCase():null;
}
export function normalizeStoredCartItems(value:unknown):StoredCartItem[] {
  if (!Array.isArray(value)) return [];
  const items:StoredCartItem[]=[];
  const indices=new Map<string,number>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const goodId=typeof candidate.goodId==='string'?candidate.goodId.trim():'';
    const variantId=normalizeVariant(candidate.variantId);
    const qty=candidate.qty;
    const customInputs=candidate.customInputs===undefined ? undefined : parseGoodsCustomInputSelection(candidate.customInputs);
    if (customInputs===null || (customInputs && !variantId)) continue;
    if (!goodId || variantId===null || !Number.isInteger(qty) || (qty as number)<=0) continue;
    const key=variantId ? cartItemKey(goodId,variantId,customInputs) : JSON.stringify([goodId,null]);
    const index=indices.get(key);
    if (index===undefined) {
      indices.set(key,items.length);items.push({goodId,...(variantId?{variantId}:{}),qty:qty as number,...(customInputs?{customInputs}:{})});
    } else {items[index]={...items[index],qty:Math.max(items[index].qty,qty as number)};}
  }
  return items;
}
export function normalizeCartItems(value: unknown): CartItem[] {
  return normalizeStoredCartItems(value).filter((item): item is CartItem => Boolean(item.variantId));
}
export function legacyCartItems(value: unknown): LegacyCartItem[] {
  return normalizeStoredCartItems(value).filter((item): item is LegacyCartItem => !item.variantId);
}
export function canonicalizeStoredCartItems(value: unknown, defaults: ReadonlyMap<string, string>):
  { ok: true; items: CartItem[] } | { ok: false; unresolved: LegacyCartItem[] } {
  const stored = normalizeStoredCartItems(value);
  const unresolved = legacyCartItems(stored).filter((item) => !normalizeVariant(defaults.get(item.goodId)));
  if (unresolved.length) return { ok: false, unresolved };
  const quantities = new Map<string, CartItem>();
  for (const item of stored) {
    const variantId = item.variantId ?? normalizeVariant(defaults.get(item.goodId))!;
    const key = cartItemKey(item.goodId, variantId, 'customInputs' in item ? item.customInputs : undefined);
    const previous = quantities.get(key);
    // Distinct legacy/explicit identities were independently added. Max is only
    // for duplicate copies of one identity (handled by the storage decoder).
    quantities.set(key, { goodId: item.goodId, variantId, qty: (previous?.qty ?? 0) + item.qty, ...('customInputs' in item && item.customInputs ? {customInputs:item.customInputs}: {}) });
  }
  return { ok: true, items: [...quantities.values()] };
}
export function parseStoredCart(value:string|null):StoredCartItem[] {
  if (!value) return [];
  try {
    const parsed:unknown=JSON.parse(value);
    if (!isRecord(parsed) || ![1,2,3].includes(parsed.version as number)) return [];
    return normalizeStoredCartItems(parsed.items);
  } catch {return [];}
}
export function serializeCart(items:readonly CartItem[]):string {
  return JSON.stringify({version:3,items:normalizeCartItems(items)});
}
/** Used only when the customer explicitly removes an unresolved legacy line. */
export function serializeUnmigratedCart(items: readonly StoredCartItem[]): string {
  return JSON.stringify({ version: legacyCartItems(items).length ? 1 : 3, items: normalizeStoredCartItems(items) });
}
export function setCartItemQuantity(items:readonly CartItem[],goodIdValue:string,qty:number,variantIdValue:string,customInputs?:GoodsCustomInputSelection):CartItem[] {
  const normalized=normalizeCartItems(items);
  const goodId=goodIdValue.trim();
  const variantId=normalizeVariant(variantIdValue);
  if (!goodId || !variantId || !Number.isInteger(qty)) return normalized;
  const key=cartItemKey(goodId,variantId,customInputs);
  const index=normalized.findIndex(item=>cartItemKey(item.goodId,item.variantId,item.customInputs)===key);
  if (qty<=0) return normalized.filter(item=>cartItemKey(item.goodId,item.variantId,item.customInputs)!==key);
  const next={goodId,variantId,qty,...(customInputs?{customInputs}:{})};
  if (index===-1) return [...normalized,next];
  return normalized.map((item,i)=>i===index?next:item);
}
export function cartQuantityTotal(items:readonly CartItem[]):number {return normalizeCartItems(items).reduce((total,item)=>total+item.qty,0);}
export function cartItemsAfterSignOut(mode:CartMode,localItems:readonly StoredCartItem[]):StoredCartItem[] {return mode==='local'?normalizeStoredCartItems(localItems):[];}

/** Quotes price a variant once after summing all buyer-input lines. */
export function aggregateCartVariantQuantities(items: readonly CartItem[]): CartItem[] {
  const grouped = new Map<string, CartItem>();
  for (const item of items) {
    const key = cartItemKey(item.goodId, item.variantId);
    grouped.set(key, { goodId:item.goodId, variantId:item.variantId, qty:(grouped.get(key)?.qty ?? 0)+item.qty });
  }
  return [...grouped.values()];
}
