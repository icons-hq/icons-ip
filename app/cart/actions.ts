'use server';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState, type CurrentAuthState } from '@/lib/auth/server';
import {
  normalizeCartItems,
  normalizeStoredCartItems,
  canonicalizeStoredCartItems,
  legacyCartItems,
  type CartActionResult,
  type CartItem,
} from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';

const SYNC_ERROR = '장바구니를 동기화하지 못했습니다. 다시 시도해주세요.';
const SAVE_ERROR = '장바구니를 저장하지 못했습니다. 다시 시도해주세요.';
const STOCK_ERROR = '현재 재고보다 많이 담을 수 없습니다.';
const INPUT_ERROR = '장바구니 수량을 확인해주세요.';

type CartSupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface CartRow {
  good_id: string;
  variant_id: string;
  qty: number;
}

function authenticatedCartUser(auth: CurrentAuthState) {
  if (!auth.isConfigured || !auth.user) return null;
  if (!isOnboarded(auth.profile, auth.user.email)) return null;
  return auth.user;
}

async function loadServerCart(
  supabase: CartSupabaseClient,
  userId: string,
): Promise<{ items: CartItem[]; error: boolean }> {
  const { data, error } = await supabase
    .from('cart_items')
    .select('good_id,variant_id,qty')
    .eq('user_id', userId)
    .order('created_at');

  if (error) return { items: [], error: true };

  const items = normalizeCartItems(((data ?? []) as CartRow[]).map((row) => ({
      goodId: row.good_id,
      variantId: row.variant_id,
      qty: row.qty,
    })));
  return { items, error: items.length !== (data ?? []).length };
}

export async function syncCartAction(localItemsValue: unknown): Promise<CartActionResult> {
  const stored = normalizeStoredCartItems(localItemsValue);
  const auth = await getCurrentAuthState();
  const user = authenticatedCartUser(auth);
  const legacy = legacyCartItems(stored);
  const defaults = new Map<string, string>();
  let supabase: CartSupabaseClient | undefined;
  if (legacy.length) {
    if (!auth.isConfigured) return { ok: false, mode: 'local', error: SYNC_ERROR, unresolvedItems: legacy };
    supabase = await createClient();
    // Staff shares this action too: explicitly require the public catalog even
    // when its broader RLS policy would otherwise reveal draft parent records.
    const { data, error } = await supabase.from('goods_variants')
      .select('id,good_id,goods!inner(id,ips!inner(id))')
      .in('good_id', [...new Set(legacy.map((item) => item.goodId))]).eq('is_default', true).is('archived_at', null)
      .not('goods.published_at', 'is', null).is('goods.archived_at', null).eq('goods.sale_restriction', 'none')
      .not('goods.ips.published_at', 'is', null).is('goods.ips.archived_at', null);
    if (error) return { ok: false, mode: 'local', error: SYNC_ERROR, unresolvedItems: legacy };
    for (const row of data ?? []) defaults.set(row.good_id, row.id);
  }
  const normalized = canonicalizeStoredCartItems(stored, defaults);
  if (!normalized.ok) return { ok: false, mode: 'local', unresolvedItems: normalized.unresolved,
    error: '이전 장바구니의 일부 상품을 확인할 수 없습니다. 다시 시도하거나 해당 항목을 삭제해주세요.' };
  const localItems = normalized.items;
  if (!user) return { ok: true, mode: 'local', items: localItems };
  supabase ??= await createClient();
  if (localItems.length) {
    const { error } = await supabase.rpc('merge_cart_items', {
      p_items: localItems.map((item) => ({ good_id: item.goodId, variant_id: item.variantId, qty: item.qty })),
    });
    if (error) return { ok: false, mode: 'local', error: SYNC_ERROR };
  }

  const snapshot = await loadServerCart(supabase, user.id);
  if (snapshot.error) return { ok: false, mode: 'local', error: SYNC_ERROR };

  return { ok: true, mode: 'server', items: snapshot.items };
}

async function currentCartAuth(): Promise<{
  user: NonNullable<CurrentAuthState['user']>;
  supabase: CartSupabaseClient;
} | null> {
  const auth = await getCurrentAuthState();
  const user = authenticatedCartUser(auth);
  if (!user) return null;
  return { user, supabase: await createClient() };
}

function validMutationInput(goodId: string, qty: number) {
  return Boolean(goodId.trim()) && Number.isInteger(qty) && qty >= 0;
}

async function serverMutationResult(
  supabase: CartSupabaseClient,
  userId: string,
): Promise<CartActionResult> {
  const snapshot = await loadServerCart(supabase, userId);
  return snapshot.error
    ? { ok: false, mode: 'server', error: SAVE_ERROR }
    : { ok: true, mode: 'server', items: snapshot.items };
}

function variantArgument(value: unknown): string | false {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
    ? value.trim().toLowerCase() : false;
}

export async function setCartItemQuantityAction(
  goodIdValue: unknown,
  qtyValue: unknown,
  variantIdValue: unknown,
): Promise<CartActionResult> {
  const goodId = typeof goodIdValue === 'string' ? goodIdValue.trim() : '';
  const qty = typeof qtyValue === 'number' ? qtyValue : Number.NaN;
  const variantId = variantArgument(variantIdValue);
  if (!validMutationInput(goodId, qty) || variantId === false) {
    return { ok: false, mode: 'server', error: INPUT_ERROR };
  }
  const context = await currentCartAuth();
  if (!context) return { ok: false, mode: 'local' };

  // The RPC owns option membership, publication, account and stock checks atomically.
  const { error } = await context.supabase.rpc('set_cart_item_quantity', {
    p_good_id: goodId, p_variant_id: variantId, p_qty: qty,
  });
  if (error) return { ok: false, mode: 'server', error: error.message === 'out of stock' ? STOCK_ERROR : SAVE_ERROR };
  return serverMutationResult(context.supabase, context.user.id);
}

export async function deleteCartItemAction(goodIdValue: unknown, variantIdValue: unknown): Promise<CartActionResult> {
  return setCartItemQuantityAction(goodIdValue, 0, variantIdValue);
}
