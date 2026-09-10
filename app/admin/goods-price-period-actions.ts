'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { parseAdminGoodsPricePeriods, parseGoodsPricePeriodInput, type AdminGoodsPricePeriod } from '@/lib/admin/goods-price-periods';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type MutationResult = { ok: true; message: string } | { ok: false; error: string };

export async function listGoodsPricePeriodsAction(goodIdValue: unknown): Promise<
  { ok: true; periods: AdminGoodsPricePeriod[] } | { ok: false; error: string }
> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const goodId = typeof goodIdValue === 'string' ? goodIdValue.trim() : '';
  if (!goodId.trim() || goodId.length > 200) return { ok: false, error: '상품을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_price_periods', { p_good_id: goodId });
    const periods = error ? null : parseAdminGoodsPricePeriods(data);
    return periods ? { ok: true, periods } : { ok: false, error: '기간 할인 목록을 불러오지 못했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '기간 할인 목록을 불러오지 못했습니다. 다시 시도해주세요.' };
  }
}

export async function saveGoodsPricePeriodAction(formData: FormData): Promise<MutationResult> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const goodId = String(formData.get('goodId') ?? '').trim();
  const variantId = String(formData.get('variantId') ?? '');
  const periodId = String(formData.get('periodId') ?? '') || null;
  const revisionText = String(formData.get('revision') ?? '');
  const revision = revisionText ? Number(revisionText) : null;
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get('period') ?? '')); } catch { raw = null; }
  const period = parseGoodsPricePeriodInput(raw);
  if (!goodId || goodId.length > 200 || !UUID.test(variantId) || (periodId !== null && !UUID.test(periodId))
    || (periodId !== null && (!revisionText || !/^[1-9]\d*$/.test(revisionText) || !Number.isSafeInteger(revision) || revision! > 2147483647))
    || (periodId === null && revision !== null) || !period) {
    return { ok: false, error: '옵션·할인가·한국 시간 기준 시작과 종료를 확인해주세요. 활성화에는 모든 값이 필요합니다.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_price_period', {
      p_good_id: goodId, p_variant_id: variantId, p_period_id: periodId,
      p_period: period, p_expected_revision: revision,
    });
    if (error) {
      const messages: Record<string, string> = {
        price_period_changed: '기간 할인 정보가 변경되었습니다. 목록을 새로고침하고 다시 확인해주세요.',
        price_period_overlap: '같은 옵션에 시간이 겹치는 활성 기간 할인이 있습니다.',
        price_period_not_configured: '할인가와 시작·종료 시각을 모두 입력한 뒤 활성화해주세요.',
        price_period_requires_new_version: '활성화했던 할인은 금액과 기간을 수정할 수 없습니다. 중지 후 새 할인을 등록해주세요.',
        price_period_regular_price_changed: '옵션 판매가가 변경되었습니다. 새 가격으로 할인 초안을 다시 확인해주세요.',
        price_period_variant_inactive: '사용 중지된 옵션입니다. 옵션을 복원한 뒤 할인을 활성화해주세요.',
      };
      return { ok: false, error: Object.entries(messages).find(([code]) => error.message.includes(code))?.[1]
        ?? '기간 할인을 저장하지 못했습니다. 할인가가 옵션 판매가보다 낮은지 확인해주세요.' };
    }
    revalidatePath('/admin/catalog/goods');
    revalidatePath('/shop');
    revalidatePath(`/shop/${encodeURIComponent(goodId)}`);
    revalidatePath('/cart');
    revalidatePath('/checkout');
    if (data && typeof data.ipId === 'string') revalidatePath(`/ip/${encodeURIComponent(data.ipId)}`);
    return { ok: true, message: period.state === 'draft' ? '할인 초안을 저장했습니다. 가격에는 아직 반영되지 않습니다.'
      : period.state === 'active' ? '기간 할인을 활성화했습니다.' : '기간 할인을 중지했습니다. 기존 주문 금액은 보존됩니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '기간 할인을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
