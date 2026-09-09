'use server';

import { isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState, type CurrentAuthState } from '@/lib/auth/server';
import {
  normalizeCartItems,
  type CartActionResult,
  type CartItem,
} from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';

const SYNC_ERROR = '장바구니를 동기화하지 못했습니다. 다시 시도해주세요.';
const SAVE_ERROR = '장바구니를 저장하지 못했습니다. 다시 시도해주세요.';
const STOCK_ERROR = '현재 재고보다 많이 담을 수 없습니다.';
const INPUT_ERROR = '장바구니 수량을 확인해주세요.';

/* 구매 조건(최소·최대·계정당·성인)은 장바구니에서부터 막는다 — 주문 생성이 같은 규칙으로 다시 보지만,
 * 결제 직전에야 "못 산다"를 알리면 손님은 장바구니를 믿을 수 없다(2026-09-09 브라우저 QA: 4개가 결제
 * 화면까지 그대로 갔다). 판정은 DB 함수 하나(good_purchase_block_reason)가 한다. */
const PURCHASE_BLOCK_ERRORS: Record<string, string> = {
  below_min_order_qty: '이 상품은 최소 주문 수량이 정해져 있습니다. 수량을 늘려주세요.',
  above_max_order_qty: '이 상품은 한 번에 담을 수 있는 수량이 정해져 있습니다. 수량을 줄여주세요.',
  above_account_limit: '이 상품은 계정당 구매 수량이 정해져 있어 더 담을 수 없습니다.',
  adult_only: '성인만 구매할 수 있는 상품입니다.',
  adult_verification_required: '성인 전용 상품입니다. 프로필의 생년월일을 확인한 뒤 담을 수 있습니다.',
};

async function purchaseBlockError(
  supabase: CartSupabaseClient,
  goodId: string,
  qty: number,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('good_purchase_block_reason', {
    p_good_id: goodId,
    p_qty: qty,
    p_user_id: userId,
  });
  /* 판정 자체가 실패하면 여기서 막지 않는다 — 주문 생성이 같은 규칙을 다시 본다. */
  if (error) return null;
  const code = typeof data === 'string' ? data : null;
  if (!code || code === 'good_not_found') return null;
  return PURCHASE_BLOCK_ERRORS[code] ?? '지금은 이 수량으로 담을 수 없습니다.';
}

type CartSupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface CartRow {
  good_id: string;
  qty: number;
}

interface GoodStockRow {
  stock: string;
  stock_qty: number;
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
    .select('good_id,qty')
    .eq('user_id', userId)
    .order('created_at');

  if (error) return { items: [], error: true };

  return {
    items: normalizeCartItems(((data ?? []) as CartRow[]).map((row) => ({
      goodId: row.good_id,
      qty: row.qty,
    }))),
    error: false,
  };
}

export async function syncCartAction(localItemsValue: unknown): Promise<CartActionResult> {
  const localItems = normalizeCartItems(localItemsValue);
  const auth = await getCurrentAuthState();
  const user = authenticatedCartUser(auth);
  if (!user) return { ok: true, mode: 'local', items: localItems };

  const supabase = await createClient();
  for (const item of localItems) {
    const blocked = await purchaseBlockError(supabase, item.goodId, item.qty, user.id);
    if (blocked) return { ok: false, mode: 'local', error: blocked };
  }
  if (localItems.length) {
    const { error } = await supabase.rpc('merge_cart_items', {
      p_items: localItems.map((item) => ({ good_id: item.goodId, qty: item.qty })),
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

export async function setCartItemQuantityAction(
  goodIdValue: unknown,
  qtyValue: unknown,
): Promise<CartActionResult> {
  const goodId = typeof goodIdValue === 'string' ? goodIdValue.trim() : '';
  const qty = typeof qtyValue === 'number' ? qtyValue : Number.NaN;
  if (!validMutationInput(goodId, qty)) {
    return { ok: false, mode: 'server', error: INPUT_ERROR };
  }
  if (qty === 0) return deleteCartItemAction(goodId);

  const context = await currentCartAuth();
  if (!context) return { ok: false, mode: 'local' };

  const { data, error: stockLoadError } = await context.supabase
    .from('goods')
    .select('stock,stock_qty')
    .eq('id', goodId)
    .is('archived_at', null)
    .maybeSingle<GoodStockRow>();
  if (stockLoadError || !data) return { ok: false, mode: 'server', error: SAVE_ERROR };
  if (data.stock === 'soldout' || qty > data.stock_qty) {
    return { ok: false, mode: 'server', error: STOCK_ERROR };
  }
  const blocked = await purchaseBlockError(context.supabase, goodId, qty, context.user.id);
  if (blocked) return { ok: false, mode: 'server', error: blocked };

  const { error } = await context.supabase
    .from('cart_items')
    .upsert(
      { user_id: context.user.id, good_id: goodId, qty },
      { onConflict: 'user_id,good_id' },
    );
  if (error) return { ok: false, mode: 'server', error: SAVE_ERROR };

  return serverMutationResult(context.supabase, context.user.id);
}

export async function deleteCartItemAction(goodIdValue: unknown): Promise<CartActionResult> {
  const goodId = typeof goodIdValue === 'string' ? goodIdValue.trim() : '';
  if (!validMutationInput(goodId, 0)) {
    return { ok: false, mode: 'server', error: INPUT_ERROR };
  }

  const context = await currentCartAuth();
  if (!context) return { ok: false, mode: 'local' };

  const { error } = await context.supabase
    .from('cart_items')
    .delete()
    .eq('user_id', context.user.id)
    .eq('good_id', goodId);
  if (error) return { ok: false, mode: 'server', error: SAVE_ERROR };

  return serverMutationResult(context.supabase, context.user.id);
}
