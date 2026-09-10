'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import {
  parseAdminGoodsPreorders, parseAdminPreorderReservations, parseGoodsPreorderInput, preorderMutationError,
  type AdminGoodsPreorder, type AdminPreorderReservationPage,
} from '@/lib/admin/goods-preorders';

type Failure = { ok: false; error: string };
type Saved = { ok: true; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_REQUIRED = '예약판매 관리는 운영자 계정에서 할 수 있습니다.';
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function id(value: unknown) { const key = typeof value === 'string' ? value.trim() : ''; return key && key.length <= 200 ? key : null; }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function integer(value: unknown, minimum = 0): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= 2147483647; }
async function staff() {
  const auth = await getCurrentAdminAuthState();
  return auth.isConfigured && auth.user && auth.isStaff ? auth : null;
}
function refreshGood(goodId: string) {
  for (const path of ['/admin/catalog/goods', '/shop', `/shop/${encodeURIComponent(goodId)}`, '/cart', '/checkout']) revalidatePath(path);
}
export async function listGoodsPreordersAction(goodIdValue: unknown): Promise<{ ok: true; policies: AdminGoodsPreorder[] } | Failure> {
  if (!await staff()) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  if (!goodId) return { ok: false, error: '상품을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_preorders', { p_good_id: goodId });
    const policies = error ? null : parseAdminGoodsPreorders(data);
    return policies ? { ok: true, policies } : { ok: false, error: '예약 조건을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 조건을 불러오지 못했습니다.' }; }
}
export async function saveGoodsPreorderAction(formData: FormData): Promise<Saved | Failure> {
  const auth = await staff();
  if (!auth) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(formData.get('goodId'));
  const variantId = formData.get('variantId');
  const policyId = formData.get('policyId') || null;
  const rawRevision = String(formData.get('revision') ?? '');
  const revision = rawRevision ? Number(rawRevision) : null;
  let input: unknown;
  try { input = JSON.parse(String(formData.get('policy') ?? '')); } catch { return { ok: false, error: '예약 조건 입력을 확인해주세요.' }; }
  const policy = parseGoodsPreorderInput(input);
  if (!goodId || !uuid(variantId) || (policyId !== null && !uuid(policyId)) || !policy
    || (rawRevision && (!/^[1-9]\d*$/.test(rawRevision) || !integer(revision, 1)))
    || (policyId === null) !== (revision === null)) {
    return { ok: false, error: '승인 물량·접수 기간·발송 예정일·승인 근거와 저장된 조건을 확인해주세요.' };
  }
  if (policy.state === 'active' && auth.role !== 'admin') return { ok: false, error: preorderMutationError('preorder_admin_required') };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_preorder', {
      p_good_id: goodId, p_variant_id: variantId, p_policy_id: policyId, p_values: policy, p_expected_revision: revision,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || !uuid(data.id) || !integer(data.revision, 1) || typeof data.changed !== 'boolean') {
      return { ok: false, error: '예약 조건 저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.' };
    }
    refreshGood(goodId);
    return { ok: true, message: policy.state === 'active' ? '승인 조건에 따라 예약 접수를 설정했습니다.'
      : policy.state === 'stopped' ? '새 예약 접수를 중지했습니다. 기존 주문의 약속은 유지됩니다.' : '예약 조건을 초안으로 저장했습니다. 판매에는 반영되지 않습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 조건을 저장하지 못했습니다.' }; }
}
export async function switchToStockSupplyAction(goodIdValue: unknown, variantId: unknown, policyId: unknown, revision: unknown): Promise<Saved | Failure> {
  const auth = await staff();
  if (!auth || auth.role !== 'admin') return { ok: false, error: preorderMutationError('preorder_admin_required') };
  const goodId = id(goodIdValue);
  if (!goodId || !uuid(variantId) || !uuid(policyId) || !integer(revision, 1)) return { ok: false, error: '현재 선택된 예약 조건을 다시 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_use_stock_supply', {
      p_good_id: goodId, p_variant_id: variantId, p_expected_policy_id: policyId, p_expected_revision: revision,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || typeof data.changed !== 'boolean') return { ok: false, error: '판매 방식 변경 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.' };
    refreshGood(goodId);
    return { ok: true, message: '현재 실제 재고를 기준으로 일반 판매하도록 전환했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '판매 방식을 변경하지 못했습니다.' }; }
}
export async function listGoodsPreorderReservationsAction(goodIdValue: unknown, state: string | null = 'reserved', page = 1):
  Promise<{ ok: true; reservations: AdminPreorderReservationPage } | Failure> {
  if (!await staff()) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  if (!goodId || (state !== null && !['reserved', 'allocated', 'released', 'returned'].includes(state)) || !integer(page, 1) || page > 21474836) {
    return { ok: false, error: '예약 주문 조회 범위를 확인해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_preorder_reservations', { p_good_id: goodId, p_state: state, p_limit: 100, p_offset: (page - 1) * 100 });
    const reservations = error ? null : parseAdminPreorderReservations(data);
    return reservations ? { ok: true, reservations } : { ok: false, error: '예약 주문을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 주문을 불러오지 못했습니다.' }; }
}
export async function allocateGoodsPreordersAction(goodIdValue: unknown, selection: unknown, receiptReference: unknown): Promise<Saved | Failure> {
  if (!await staff()) return { ok: false, error: STAFF_REQUIRED };
  const goodId = id(goodIdValue);
  const receipt = typeof receiptReference === 'string' ? receiptReference.trim() : '';
  if (!goodId || !receipt || receipt.length > 2000 || !record(selection) || !Array.isArray(selection.orderItemIds)
    || !selection.orderItemIds.length || selection.orderItemIds.length > 100 || !selection.orderItemIds.every(uuid)
    || new Set(selection.orderItemIds).size !== selection.orderItemIds.length || !record(selection.expectedStock)
    || !Object.entries(selection.expectedStock).every(([key, value]) => uuid(key) && integer(value))) {
    return { ok: false, error: '할당할 예약 주문·현재 실제 재고·입고 근거를 확인해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_allocate_goods_preorders', {
      p_good_id: goodId, p_order_item_ids: selection.orderItemIds, p_expected_stock: selection.expectedStock, p_receipt_reference: receipt,
    });
    if (error) return { ok: false, error: preorderMutationError(error.message) };
    if (!record(data) || !integer(data.allocatedItems) || !integer(data.alreadyAllocatedItems)
      || data.allocatedItems + data.alreadyAllocatedItems !== selection.orderItemIds.length) {
      return { ok: false, error: '재고 할당 결과를 확인하지 못했습니다. 예약 주문 목록을 새로고침해주세요.' };
    }
    refreshGood(goodId);
    for (const path of ['/admin/sales/dispatch', '/admin/sales/shipping', '/admin/sales/orders', '/orders']) revalidatePath(path);
    revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
    return { ok: true, message: `${data.allocatedItems}개 예약 품목에 실제 재고를 할당했습니다.${data.alreadyAllocatedItems ? ` ${data.alreadyAllocatedItems}개는 이미 할당되어 재차 차감하지 않았습니다.` : ''}` };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '재고 할당 결과를 확인하지 못했습니다. 예약 주문 목록을 새로고침해주세요.' }; }
}
