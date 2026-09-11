'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

export interface GoodsVariantActionState {
  error?: string;
  message?: string;
}

export async function setGoodsVariantActiveAction(
  _state: GoodsVariantActionState,
  formData: FormData,
): Promise<GoodsVariantActionState> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin%2Fcatalog%2Fgoods');
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };

  const goodId = String(formData.get('goodId') ?? '').trim();
  const variantId = String(formData.get('variantId') ?? '');
  const activeValue = String(formData.get('active') ?? '');
  const active = activeValue === 'true';
  const expectedUpdatedAt = String(formData.get('expectedUpdatedAt') ?? '');
  const priceValue = String(formData.get('price') ?? '');
  const price = Number(priceValue);
  if (!goodId || goodId.length > 200
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(variantId)
    || !['true', 'false'].includes(activeValue) || !Number.isFinite(Date.parse(expectedUpdatedAt))
    || (active && (!/^\d+$/.test(priceValue) || !Number.isSafeInteger(price) || price < 0 || price > 2147483647))) {
    return { error: '옵션과 복원 판매가를 확인해주세요. 목록이 오래되었다면 새로고침해주세요.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_set_goods_variant_active', {
    target_good_id: goodId,
    target_variant_id: variantId,
    target_active: active,
    target_expected_updated_at: expectedUpdatedAt,
    target_price: active ? price : null,
  });
  if (error) {
    const messages: Record<string, string> = {
      goods_variant_changed: '옵션 정보가 변경되었습니다. 새로고침 후 다시 확인해주세요.',
      goods_variant_combination_exists: '같은 조합의 옵션이 사용 중입니다. 기존 옵션을 확인해주세요.',
      variant_price_below_base: '복원 판매가는 현재 상품 기준 판매가 이상이어야 합니다.',
      goods_options_limit: '사용 옵션은 기본 옵션을 포함해 최대 100개입니다. 다른 옵션을 먼저 중지해주세요.',
      catalog_archived: '보관된 상품입니다. 상품을 복원한 뒤 옵션을 변경해주세요.',
    };
    return { error: Object.entries(messages).find(([code]) => error.message.includes(code))?.[1]
      ?? '옵션 사용 상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
  revalidatePath('/admin/catalog/goods');
  revalidatePath('/shop');
  revalidatePath(`/shop/${encodeURIComponent(goodId)}`);
  revalidatePath('/cart');
  if (data && typeof data.ipId === 'string') revalidatePath(`/ip/${encodeURIComponent(data.ipId)}`);
  return { message: active ? '옵션을 복원했습니다.' : '옵션 사용을 중지했습니다. 재고와 주문 이력은 보존됩니다.' };
}
