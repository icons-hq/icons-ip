'use server';

import { goodsCustomInputValues, parseGoodsCustomInputSelection } from '@/lib/goods-custom-inputs';
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
import { createServiceClient } from '@/lib/supabase/service';
import { parseCartAdditionRequest, parseCartAdditionSnapshot } from '@/lib/cart-additions';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { adultGoodsRestrictions } from '@/lib/adult-goods';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { cartLineIdentityPayload } from '@/lib/checkout-selection';
import { loadLatestPendingCheckoutOrderId } from '@/lib/checkout.server';

const SYNC_ERROR = '장바구니를 동기화하지 못했습니다. 다시 시도해주세요.';
const SAVE_ERROR = '장바구니를 저장하지 못했습니다. 다시 시도해주세요.';
const STOCK_ERROR = '현재 재고보다 많이 담을 수 없습니다.';
const INPUT_ERROR = '장바구니 수량을 확인해주세요.';
/* 19금 굿즈는 유효한 성인 인증이 있어야 담긴다(ADR-0024) — DB가 adult_verification_required로 알린다. */
const ADULT_VERIFICATION_ERROR = '19금 굿즈는 성인 인증을 마친 회원만 담을 수 있어요. 마이 > 성인 인증에서 인증해주세요.';

type CartSupabaseClient = Awaited<ReturnType<typeof createClient>>;

interface CartRow {
  id: string;
  good_id: string;
  variant_id: string;
  qty: number;
  input_snapshot?: unknown;
}

/** 공개 계산 열 `goods_random_option`의 장바구니 키. 랜덤이 아니거나(null) 모양이 틀리면 null — 항목은 미해결로 남는다. */
function randomOptionKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
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
  const { data, error } = await readCompleteIdPages<CartRow>((afterId,pageSize)=>{
    let query=supabase.from('cart_items').select('id,good_id,variant_id,qty,input_snapshot',{count:'exact'})
      .eq('user_id',userId).order('id',{ascending:true}).limit(pageSize);
    if(afterId)query=query.gt('id',afterId);
    return query;
  });

  if (error) return { items: [], error: true };

  const items = normalizeCartItems(((data ?? []) as CartRow[]).map((row) => ({
      goodId: row.good_id,
      variantId: row.variant_id,
      qty: row.qty,
      ...(row.input_snapshot ? { customInputs: row.input_snapshot } : {}),
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
      .not('goods.published_at', 'is', null).is('goods.archived_at', null)
      // 19금 굿즈는 인증 성인에게만 기본 옵션을 찾는다(ADR-0024). 옵션 RLS도 같은 판정이다.
      .in('goods.sale_restriction', adultGoodsRestrictions(await getAdultGoodsAccess() === 'full' ? 'full' : 'hidden'))
      .not('goods.ips.published_at', 'is', null).is('goods.ips.archived_at', null);
    if (error) return { ok: false, mode: 'local', error: SYNC_ERROR, unresolvedItems: legacy };
    for (const row of data ?? []) defaults.set(row.good_id, row.id);
    // 랜덤 판매 굿즈(D5②)의 옵션 행은 기본 옵션까지 고객·익명에게 숨는다(restrictive RLS). 장바구니 키는 공개 계산 열
    // goods_random_option의 id(= 기본 옵션)로 받는다. 위에서 찾은 굿즈(옵션 선택 판매, 또는 원본을 읽는 운영자)는 다시 묻지 않는다.
    const randomGoodIds = [...new Set(legacy.map((item) => item.goodId))].filter((goodId) => !defaults.has(goodId));
    if (randomGoodIds.length) {
      const { data: randomGoods, error: randomError } = await supabase.from('goods')
        .select('id,random_option:goods_random_option')
        .in('id', randomGoodIds).eq('option_sale_mode', 'random')
        .not('published_at', 'is', null).is('archived_at', null).eq('sale_restriction', 'none');
      if (randomError) return { ok: false, mode: 'local', error: SYNC_ERROR, unresolvedItems: legacy };
      for (const row of (randomGoods ?? []) as { id: string; random_option: unknown }[]) {
        const key = randomOptionKey(row.random_option);
        if (key) defaults.set(row.id, key);
      }
    }
  }
  const normalized = canonicalizeStoredCartItems(stored, defaults);
  if (!normalized.ok) return { ok: false, mode: 'local', unresolvedItems: normalized.unresolved,
    error: '이전 장바구니의 일부 굿즈를 확인할 수 없습니다. 다시 시도하거나 해당 항목을 삭제해주세요.' };
  const localItems = normalized.items;
  if (!user) return { ok: true, mode: 'local', items: localItems };
  supabase ??= await createClient();
  if (localItems.length) {
    const { error } = await supabase.rpc('merge_cart_items', {
      p_items: localItems.map((item) => ({ good_id: item.goodId, variant_id: item.variantId, qty: item.qty, ...(item.customInputs ? {input_revision:item.customInputs.revision,input_values:goodsCustomInputValues(item.customInputs)} : {}) })),
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
  customInputsValue?: unknown,
): Promise<CartActionResult> {
  const goodId = typeof goodIdValue === 'string' ? goodIdValue.trim() : '';
  const qty = typeof qtyValue === 'number' ? qtyValue : Number.NaN;
  const variantId = variantArgument(variantIdValue);
  const customInputs = customInputsValue === undefined ? undefined : parseGoodsCustomInputSelection(customInputsValue);
  if (!validMutationInput(goodId, qty) || variantId === false || customInputs === null) {
    return { ok: false, mode: 'server', error: INPUT_ERROR };
  }
  const context = await currentCartAuth();
  if (!context) return { ok: false, mode: 'local' };

  // The RPC owns option membership, publication, account and stock checks atomically.
  const { error } = customInputs
    ? await context.supabase.rpc('set_cart_item_quantity_with_inputs', { p_good_id:goodId,p_variant_id:variantId,p_qty:qty,p_input_revision:customInputs.revision,p_input_values:goodsCustomInputValues(customInputs) })
    : await context.supabase.rpc('set_cart_item_quantity', {p_good_id:goodId,p_variant_id:variantId,p_qty:qty});
  if (error) return { ok: false, mode: 'server', error: error.message === 'goods_sale_not_open' ? '판매기간이 시작되지 않았거나 종료된 굿즈입니다.' : error.message === 'adult_verification_required' ? ADULT_VERIFICATION_ERROR : error.message === 'out of stock' ? STOCK_ERROR : /goods_custom_inputs/.test(error.message) ? '직접입력형 옵션 설정이 변경되었습니다. 굿즈에서 내용을 다시 확인해주세요.' : SAVE_ERROR };
  return serverMutationResult(context.supabase, context.user.id);
}

export async function deleteCartItemAction(goodIdValue: unknown, variantIdValue: unknown, customInputsValue?: unknown): Promise<CartActionResult> {
  return setCartItemQuantityAction(goodIdValue, 0, variantIdValue, customInputsValue);
}

/** DB 일괄 삭제가 받는 줄 수 상한(remove_cart_lines). 장바구니 스냅샷 계약과 같은 값이다. */
const MAX_REMOVE_LINES = 19239;

/**
 * 장바구니 선택 삭제·전체 비우기(ADR-0030 · 1014-035·036). 화면이 보고 있는 줄만 넘긴다 — 전체 비우기도
 * 다른 탭에서 막 담겨 아직 보이지 않은 줄은 지우지 않는다. 이미 없는 줄은 DB가 조용히 건너뛴다.
 */
export async function removeCartLinesAction(linesValue: unknown): Promise<CartActionResult> {
  const lines = normalizeCartItems(linesValue);
  if (!Array.isArray(linesValue) || !lines.length || lines.length !== linesValue.length || lines.length > MAX_REMOVE_LINES) {
    return { ok: false, mode: 'server', error: INPUT_ERROR };
  }
  const context = await currentCartAuth();
  if (!context) return { ok: false, mode: 'local' };
  const { error } = await context.supabase.rpc('remove_cart_lines', { p_lines: lines.map(cartLineIdentityPayload) });
  if (error) return { ok: false, mode: 'server', error: SAVE_ERROR };
  return serverMutationResult(context.supabase, context.user.id);
}

export async function addCartSelectionAction(baseGoodIdValue: unknown, entriesValue: unknown): Promise<CartActionResult> {
  const baseGoodId = typeof baseGoodIdValue === 'string' ? baseGoodIdValue.trim() : '';
  const entries = parseCartAdditionRequest(entriesValue);
  if (!baseGoodId || baseGoodId.length > 200 || !entries || !entries.some((entry) => entry.goodId === baseGoodId)) {
    return { ok: false, mode: 'server', error: INPUT_ERROR };
  }
  const context = await currentCartAuth();
  if (!context) return { ok: false, mode: 'local' };
  const { data, error } = await context.supabase.rpc('add_cart_selection', {
    p_base_good_id: baseGoodId,
    p_items: entries.map((entry) => ({ good_id: entry.goodId, variant_id: entry.variantId, qty: entry.qty, expected_qty: entry.expectedQty, ...(entry.customInputs ? {input_revision:entry.customInputs.revision,input_values:goodsCustomInputValues(entry.customInputs)} : {}) })),
  });
  if (error) {
    return { ok: false, mode: 'server', error: error.message === 'goods_sale_not_open' ? '판매기간이 시작되지 않았거나 종료된 굿즈입니다.' : error.message === 'adult_verification_required' ? ADULT_VERIFICATION_ERROR : error.message === 'out of stock' ? STOCK_ERROR
      : /goods_custom_inputs/.test(error.message) ? '직접입력형 옵션 설정이 변경되었습니다. 굿즈에서 내용을 다시 확인해주세요.'
      : error.message === 'cart_selection_changed' ? '장바구니가 변경되었습니다. 현재 수량을 확인하고 다시 담아주세요.'
        : error.message === 'additional_good_unavailable' ? '추가 구성 굿즈의 판매 또는 연결 상태가 변경되었습니다. 선택을 다시 확인해주세요.'
          : SAVE_ERROR };
  }
  const items = parseCartAdditionSnapshot(data);
  return items ? { ok: true, mode: 'server', items }
    : { ok: false, mode: 'server', error: '장바구니 반영 결과를 확인하지 못했습니다. 현재 수량을 새로고침한 뒤 다시 확인해주세요.' };
}

/**
 * 고객이 장바구니·주문서로 돌아왔을 때 결제를 마치지 않은 이전 카드 장바구니 주문을 닫는다
 * (ADR-0026). 장바구니는 결제가 끝날 때까지 그대로 남으므로, 그 주문이 잡고 있던 재고·쿠폰·
 * 적립금·구매 한도를 돌려줘야 견적이 막히지 않는다. 승인 확인 중이거나 결과가 확정되지 않은
 * 주문은 DB가 닫지 않는다. 실패해도 장바구니 화면은 그대로 쓸 수 있다 — 새 주문 생성이 같은
 * 정리를 다시 한다.
 */
export async function releaseUnpaidCartOrdersAction(): Promise<{ released: number }> {
  const user = authenticatedCartUser(await getCurrentAuthState());
  if (!user) return { released: 0 };
  try {
    const { data, error } = await createServiceClient().rpc('release_unpaid_cart_orders', { p_user_id: user.id });
    return { released: !error && typeof data === 'number' && Number.isSafeInteger(data) && data > 0 ? data : 0 };
  } catch {
    return { released: 0 };
  }
}

export type ReleaseUnpaidCheckoutOrdersResult =
  | {
      readonly ok: true;
      /** 이번에 닫은 결제 대기 카드 주문 수. */
      readonly released: number;
      /** 결제 승인을 확인 중이라 닫지 않은 주문이 있다 — 확인이 끝난 뒤 다시 시도한다. */
      readonly confirming: boolean;
      /** 닫은 뒤에도 남은 결제 대기 주문(무통장 입금 대기 등). 화면이 그 주문으로 안내한다. */
      readonly pendingOrderId: string | null;
    }
  | { readonly ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * '진행 중인 미결제 주문 취소하고 계속'(ADR-0030). 견적이 결제 대기 주문의 쿠폰·첫구매 예약·구매 한도 때문에 막혔을 때
 * 고객이 누른 경우에만 부른다 — 주문서·장바구니를 열기만 해서는 다른 탭의 결제창을 끊지 않는다. 출처(장바구니·바로구매)와
 * 무관하게 결제를 마치지 않은 카드 주문을 ADR-0026 닫기 경로로 닫고, 결제 승인을 확인 중인 주문은 닫지 않는다.
 */
export async function releaseUnpaidCheckoutOrdersAction(): Promise<ReleaseUnpaidCheckoutOrdersResult> {
  const user = authenticatedCartUser(await getCurrentAuthState());
  if (!user) return { ok: false };
  try {
    const { data, error } = await createServiceClient().rpc('release_unpaid_checkout_orders', { p_user_id: user.id });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return { ok: false };
    const value = data as Record<string, unknown>;
    const released = typeof value.released === 'number' && Number.isSafeInteger(value.released) && value.released > 0 ? value.released : 0;
    const confirming = typeof value.confirming === 'number' && value.confirming > 0;
    const pendingOrderId = typeof value.pendingOrderId === 'string' && UUID.test(value.pendingOrderId) ? value.pendingOrderId.toLowerCase() : null;
    return { ok: true, released, confirming, pendingOrderId };
  } catch {
    return { ok: false };
  }
}

/** 견적이 결제 대기 주문 때문에 막혔을 때 그 주문을 알린다(가장 최근의 결제 대기 주문). 읽지 못하면 null. */
export async function loadPendingCheckoutOrderAction(): Promise<{ orderId: string | null }> {
  const user = authenticatedCartUser(await getCurrentAuthState());
  if (!user) return { orderId: null };
  try {
    return { orderId: await loadLatestPendingCheckoutOrderId(user.id) };
  } catch {
    return { orderId: null };
  }
}

