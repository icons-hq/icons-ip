'use server';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';

import { isUuid } from '@/lib/uuid';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_PREORDER_RESERVATION_PAGE_SIZE, parseAdminGoodsPreorders, parseAdminPreorderReservations, parseGoodsPreorderBulkRequest, parseGoodsPreorderInput,
  parseRandomPreorderRequest, preorderMutationError,
  type AdminGoodsPreorder, type AdminPreorderReservationPage,
} from '@/lib/admin/goods-preorders';

type Failure = { ok: false; error: string };
type Saved = { ok: true; message: string };
const STAFF_REQUIRED = '이 예약판매 작업을 할 권한이 없습니다. 예약 조건 보기·저장·중지·전환은 상품 관리 권한, 예약 주문 보기는 주문 조회 권한, 입고 확인은 주문 관리 권한이 있어야 합니다.';
/* 저장·전환·입고 확인이 처리됐는지 모를 때: 패널의 새로고침 버튼으로 먼저 확인하게 한다(같은 품목의 입고 확인은 재고수량을 두 번 빼지 않는다). */
const SAVE_UNKNOWN = '예약판매 변경이 반영됐는지 확인하지 못했습니다. [저장된 예약 조건 새로고침]을 눌러 먼저 확인하고, 반영되지 않았을 때만 다시 시도해주세요.';
const SAVE_FAILED = '예약판매 변경을 저장하지 못했습니다. [저장된 예약 조건 새로고침]으로 반영됐는지 확인한 뒤 다시 시도해주세요.';
const ALLOCATE_UNKNOWN = "입고 확인이 처리됐는지 확인하지 못했습니다. [예약 주문 새로고침]을 눌러 예약 상태 '입고 확인 완료'에 있는지 먼저 확인해주세요. 같은 주문을 다시 입고 확인해도 재고수량은 두 번 빠지지 않습니다.";
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function id(value: unknown) { const key = typeof value === 'string' ? value.trim() : ''; return key && key.length <= 200 ? key : null; }
function integer(value: unknown, minimum = 0): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647; }
const LIST_FAILED = '예약 조건을 불러오지 못했습니다. [저장된 예약 조건 새로고침]을 눌러 다시 불러와주세요.';
/**
 * 예약 조건과 함께 지금 저장돼 있는 판매기간이 있는지(`salePeriodSaved`)를 읽는다. 판매기간과 예약은 함께 저장할 수 없어
 * (DB goods_sale_period_preorder_conflict), 화면이 판매기간이 켜진 채 예약 저장을 누르지 않게 먼저 막는다.
 */
export async function listGoodsPreordersAction(goodIdValue: unknown): Promise<{ ok: true; policies: AdminGoodsPreorder[]; salePeriodSaved: boolean } | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  if (!goodId) return { ok: false, error: '상품 정보를 읽지 못했습니다. 상품 목록에서 상품을 다시 열어주세요.' };
  try {
    const client = await createClient();
    const [{ data, error }, period] = await Promise.all([
      client.rpc('admin_list_goods_preorders', { p_good_id: goodId }),
      client.from('goods').select('sale_starts_at').eq('id', goodId).maybeSingle(),
    ]);
    const policies = error ? null : parseAdminGoodsPreorders(data);
    if (!policies || period.error || !period.data) return { ok: false, error: LIST_FAILED };
    return { ok: true, policies, salePeriodSaved: (period.data as { sale_starts_at?: unknown }).sale_starts_at != null };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: LIST_FAILED }; }
}
export async function saveGoodsPreorderAction(formData: FormData): Promise<Saved | Failure> {
  const auth = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  if (!auth) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(formData.get('goodId'));
  const variantId = formData.get('variantId');
  const policyId = formData.get('policyId') || null;
  const rawRevision = String(formData.get('revision') ?? '');
  const revision = rawRevision ? Number(rawRevision) : null;
  let input: unknown;
  try { input = JSON.parse(String(formData.get('policy') ?? '')); } catch { return { ok: false, error: '예약 조건을 읽지 못했습니다. 화면을 새로고침한 뒤 다시 입력해 저장해주세요.' }; }
  const policy = parseGoodsPreorderInput(input);
  if (!goodId || !isUuid(variantId) || (policyId !== null && !isUuid(policyId)) || !policy
    || (rawRevision && (!/^[1-9]\d*$/.test(rawRevision) || !integer(revision, 1)))
    || (policyId === null) !== (revision === null)) {
    return { ok: false, error: '예약 물량(1 이상의 정수)·접수 기간(종료가 시작보다 뒤)·발송 예정일(접수 종료일과 같거나 뒤)을 확인한 뒤 다시 저장해주세요. 그래도 안 되면 화면을 새로고침해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_preorder', {
      p_good_id: goodId, p_variant_id: variantId, p_policy_id: policyId, p_values: policy, p_expected_revision: revision,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || !isUuid(data.id) || !integer(data.revision, 1) || typeof data.changed !== 'boolean') {
      return { ok: false, error: SAVE_UNKNOWN };
    }
    revalidateGoodsSurfaces();
    return { ok: true, message: policy.state === 'active' ? '예약판매를 저장했습니다. 접수 기간 동안 예약 물량으로 판매합니다.'
      : '새 예약 접수를 중지했습니다. 이미 받은 예약 주문의 발송 예정일은 그대로입니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: SAVE_FAILED }; }
}
/**
 * 옵션 선택 판매 상품: 여러 옵션의 예약을 한 번에 저장한다(한 트랜잭션 — 하나라도 거절되면 아무것도 저장하지 않는다).
 * 이미 예약판매 중인 옵션은 DB가 건너뛰고(`skippedVariantIds`) 그대로 둔다 — 중지하고 새로 만들면 남은 예약 물량이 처음부터 다시 계산된다.
 */
export async function saveGoodsPreordersBulkAction(goodIdValue: unknown, optionsValue: unknown):
  Promise<{ ok: true; savedVariantIds: string[]; skippedVariantIds: string[] } | Failure> {
  const auth = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  if (!auth) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  const options = parseGoodsPreorderBulkRequest(optionsValue);
  if (!goodId || !options) {
    return { ok: false, error: '예약 물량(1 이상의 정수)·접수 기간(종료가 시작보다 뒤)·발송 예정일(접수 종료일과 같거나 뒤)을 확인한 뒤 다시 저장해주세요. 그래도 안 되면 화면을 새로고침해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_preorders_bulk', { p_good_id: goodId, p_options: options });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    const variantIds = (rows: unknown) => Array.isArray(rows) && rows.every((row) => record(row) && isUuid(row.variantId)) ? rows.map((row) => (row as { variantId: string }).variantId) : null;
    const savedVariantIds = record(data) ? variantIds(data.saved) : null, skippedVariantIds = record(data) ? variantIds(data.skipped) : null;
    const requested = new Set(options.map((option) => option.variantId));
    if (!record(data) || data.goodId !== goodId || !savedVariantIds || !skippedVariantIds || savedVariantIds.length + skippedVariantIds.length !== options.length
      || [...savedVariantIds, ...skippedVariantIds].some((variantId) => !requested.delete(variantId))) {
      return { ok: false, error: SAVE_UNKNOWN };
    }
    revalidateGoodsSurfaces();
    return { ok: true, savedVariantIds, skippedVariantIds };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: SAVE_FAILED }; }
}
const RANDOM_PREORDER_SAVED = {
  active: '모든 옵션에 같은 일정으로 예약판매를 저장했습니다. 주문할 때 남은 예약 물량에 비례해 옵션이 정해집니다.',
  stopped: '모든 옵션의 새 예약 접수를 중지했습니다. 이미 받은 예약 주문의 발송 예정일은 그대로입니다.',
  stock: '모든 옵션을 일반 재고 판매로 전환했습니다. 지금 재고수량으로 바로 판매합니다.',
} as const;
/** 랜덤 판매 상품: 모든 판매 중 옵션의 예약을 한 번에 저장한다(적용·중지·일반 재고 전환). */
export async function saveRandomGoodsPreordersAction(goodIdValue: unknown, stateValue: unknown, valuesValue: unknown, optionsValue: unknown): Promise<Saved | Failure> {
  const auth = await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' });
  if (!auth) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  const request = parseRandomPreorderRequest(stateValue, valuesValue, optionsValue);
  if (!goodId || !request) return { ok: false, error: '저장 요청의 형식이 맞지 않습니다. 화면을 새로고침한 뒤 접수 기간·발송 예정일·옵션별 예약 물량을 다시 확인하고 저장해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_random_goods_preorders', {
      p_good_id: goodId, p_state: request.state, p_values: request.values, p_options: request.options,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || data.goodId !== goodId || data.state !== request.state || !Array.isArray(data.results)
      || data.results.length !== request.options.length) {
      return { ok: false, error: SAVE_UNKNOWN };
    }
    revalidateGoodsSurfaces();
    return { ok: true, message: RANDOM_PREORDER_SAVED[request.state] };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: SAVE_FAILED }; }
}
export async function switchToStockSupplyAction(goodIdValue: unknown, variantId: unknown, policyId: unknown, revision: unknown): Promise<Saved | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  if (!goodId || !isUuid(variantId) || !isUuid(policyId) || !integer(revision, 1)) return { ok: false, error: '예약 조건 정보를 읽지 못했습니다. [저장된 예약 조건 새로고침]을 누른 뒤 다시 전환해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_use_stock_supply', {
      p_good_id: goodId, p_variant_id: variantId, p_expected_policy_id: policyId, p_expected_revision: revision,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || typeof data.changed !== 'boolean') return { ok: false, error: '일반 재고 판매로 전환됐는지 확인하지 못했습니다. [저장된 예약 조건 새로고침]을 눌러 전환됐는지 먼저 확인해주세요.' };
    revalidateGoodsSurfaces();
    return { ok: true, message: '예약 접수를 마치고 현재 재고수량으로 일반 판매하도록 전환했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '일반 재고 판매로 전환하지 못했습니다. [저장된 예약 조건 새로고침]으로 지금 상태를 확인한 뒤 다시 시도해주세요.' }; }
}
export async function listGoodsPreorderReservationsAction(goodIdValue: unknown, state: string | null = 'reserved', page = 1):
  Promise<{ ok: true; reservations: AdminPreorderReservationPage } | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'sales.read' })) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  if (!goodId || (state !== null && !['reserved', 'allocated', 'released', 'returned'].includes(state)) || !integer(page, 1) || page > 21474836) {
    return { ok: false, error: '예약 주문을 불러올 조건이 맞지 않습니다. 화면을 새로고침해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_preorder_reservations', { p_good_id: goodId, p_state: state, p_limit: ADMIN_PREORDER_RESERVATION_PAGE_SIZE, p_offset: (page - 1) * ADMIN_PREORDER_RESERVATION_PAGE_SIZE });
    const reservations = error ? null : parseAdminPreorderReservations(data);
    return reservations ? { ok: true, reservations } : { ok: false, error: '예약 주문을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 주문을 불러오지 못했습니다.' }; }
}
export async function allocateGoodsPreordersAction(goodIdValue: unknown, selection: unknown, receiptReference: unknown): Promise<Saved | Failure> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'sales.manage' })) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  const receipt = typeof receiptReference === 'string' ? receiptReference.trim() : '';
  if (!goodId || !receipt || receipt.length > 2000 || !record(selection) || !Array.isArray(selection.orderItemIds)
    || !selection.orderItemIds.length || selection.orderItemIds.length > 100 || !selection.orderItemIds.every(isUuid)
    || new Set(selection.orderItemIds).size !== selection.orderItemIds.length || !record(selection.expectedStock)
    || !Object.entries(selection.expectedStock).every(([key, value]) => isUuid(key) && integer(value))) {
    return { ok: false, error: '입고 확인할 예약 주문(한 번에 100개까지)과 입고 확인 근거(2,000자까지)를 확인한 뒤 다시 눌러주세요. 그래도 안 되면 [예약 주문 새로고침]을 눌러주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_allocate_goods_preorders', {
      p_good_id: goodId, p_order_item_ids: selection.orderItemIds, p_expected_stock: selection.expectedStock, p_receipt_reference: receipt,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || !integer(data.allocatedItems) || !integer(data.alreadyAllocatedItems)
      || data.allocatedItems + data.alreadyAllocatedItems !== selection.orderItemIds.length) {
      return { ok: false, error: ALLOCATE_UNKNOWN };
    }
    revalidateGoodsSurfaces();
    for (const path of ['/admin/sales/dispatch', '/admin/sales/shipping', '/admin/sales/orders', '/orders']) revalidatePath(path);
    revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
    return { ok: true, message: `예약 품목 ${data.allocatedItems}개를 입고 확인하고 그만큼 옵션 재고수량에서 뺐습니다.${data.alreadyAllocatedItems ? ` ${data.alreadyAllocatedItems}개는 이미 입고 확인된 품목이라 재고수량을 다시 빼지 않았습니다.` : ''}` };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: ALLOCATE_UNKNOWN }; }
}
