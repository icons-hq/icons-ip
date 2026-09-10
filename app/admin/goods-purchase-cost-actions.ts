'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import {
  parseAdminPurchaseCosts, parsePurchaseCostHistory, parsePurchaseCostInput,
  type AdminGoodsPurchaseCost, type PurchaseCostChange,
} from '@/lib/admin/goods-purchase-costs';

const ADMIN_REQUIRED = '매입단가는 관리자 계정에서만 조회·수정할 수 있습니다.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Failure = { ok: false; error: string };
async function canManageCosts() {
  const auth = await getCurrentAdminAuthState();
  return auth.isConfigured && Boolean(auth.user) && auth.isStaff && auth.role === 'admin';
}
function goodId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 200 ? id : null;
}

export async function listGoodsPurchaseCostsAction(goodIdValue: unknown): Promise<
  { ok: true; costs: AdminGoodsPurchaseCost[] } | Failure
> {
  if (!await canManageCosts()) return { ok: false, error: ADMIN_REQUIRED };
  const id = goodId(goodIdValue);
  if (!id) return { ok: false, error: '상품을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_variant_purchase_costs', { p_good_id: id });
    const costs = error ? null : parseAdminPurchaseCosts(data);
    return costs ? { ok: true, costs } : { ok: false, error: '매입단가를 불러오지 못했습니다. 다시 시도해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '매입단가를 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}

export async function listGoodsPurchaseCostHistoryAction(goodIdValue: unknown, variantIdValue: unknown, beforeRevision?: number): Promise<
  { ok: true; history: PurchaseCostChange[]; hasMore: boolean } | Failure
> {
  if (!await canManageCosts()) return { ok: false, error: ADMIN_REQUIRED };
  const id = goodId(goodIdValue);
  const variantId = typeof variantIdValue === 'string' ? variantIdValue : '';
  if (!id || !UUID.test(variantId) || (beforeRevision !== undefined && (!Number.isSafeInteger(beforeRevision) || beforeRevision < 1 || beforeRevision > 2147483647))) {
    return { ok: false, error: '상품·옵션과 이력 조회 범위를 다시 확인해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_purchase_cost_history', {
      p_good_id: id, p_variant_id: variantId, p_before_revision: beforeRevision ?? null,
    });
    const history = error ? null : parsePurchaseCostHistory(data);
    return history ? { ok: true, history, hasMore: history.length === 50 && (history.at(-1)?.revision ?? 0) > 1 }
      : { ok: false, error: '매입단가 변경 이력을 불러오지 못했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '매입단가 변경 이력을 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}

export async function saveGoodsPurchaseCostAction(formData: FormData): Promise<{ ok: true; message: string } | Failure> {
  if (!await canManageCosts()) return { ok: false, error: ADMIN_REQUIRED };
  const id = goodId(formData.get('goodId'));
  const variantId = String(formData.get('variantId') ?? '');
  const rawRevision = String(formData.get('expectedRevision') ?? '');
  const revision = rawRevision ? Number(rawRevision) : null;
  const cost = parsePurchaseCostInput({ unitCostKrw: formData.get('unitCostKrw'), taxBasis: formData.get('taxBasis') });
  if (!id || !UUID.test(variantId) || !cost || (rawRevision && (!/^[1-9]\d*$/.test(rawRevision)
    || !Number.isSafeInteger(revision) || revision! > 2147483647))) {
    return { ok: false, error: '매입단가(원 단위 정수)와 세금 구분을 함께 입력해주세요. 해제하려면 두 값을 모두 비워주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_variant_purchase_cost', {
      p_good_id: id, p_variant_id: variantId, p_unit_cost_krw: cost.unitCostKrw, p_tax_basis: cost.taxBasis,
      p_expected_revision: revision,
    });
    if (error) {
      return { ok: false, error: error.message.includes('goods_purchase_cost_changed')
        ? '매입단가 정보가 변경되었습니다. 목록을 새로고침하고 다시 확인해주세요.'
        : error.message.includes('purchase_cost_admin_required') ? ADMIN_REQUIRED
          : '매입단가를 저장하지 못했습니다. 금액과 세금 구분을 확인해주세요.' };
    }
    if (!data || typeof data.changed !== 'boolean') return { ok: false, error: '저장 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.' };
    revalidatePath('/admin/catalog/goods');
    return { ok: true, message: cost.unitCostKrw === null ? '매입단가를 미설정 상태로 저장했습니다.' : '매입단가와 세금 구분을 저장했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '매입단가를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
