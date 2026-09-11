'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { readGoodsVariantExternalIdentityForm } from '@/lib/admin/variant-external-identity';

export type GoodsVariantExternalIdentityActionState = {
  errors?: {
    goodId?: string;
    variantId?: string;
    erpCode?: string;
    erpName?: string;
    barcode?: string;
    form?: string;
  };
  message?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveGoodsVariantExternalIdentityAction(
  _state: GoodsVariantExternalIdentityActionState,
  formData: FormData,
): Promise<GoodsVariantExternalIdentityActionState> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin/catalog/goods')}`);
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };

  const goodId = String(formData.get('goodId') ?? '').trim();
  const variantId = String(formData.get('variantId') ?? '').trim();
  if (!goodId || goodId.length > 200) return { errors: { goodId: '상품을 확인해주세요.' } };
  if (!UUID.test(variantId)) return { errors: { variantId: '옵션을 확인해주세요.' } };
  const identity = readGoodsVariantExternalIdentityForm(formData);
  if (!identity.ok) return { errors: { form: 'ERP 코드·ERP 품명·바코드를 확인해주세요.' } };

  const expectedUpdatedAtValue = String(formData.get('expectedUpdatedAt') ?? '').trim();
  const expectedUpdatedAt = expectedUpdatedAtValue ? new Date(expectedUpdatedAtValue) : null;
  if (expectedUpdatedAtValue && (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime()))) {
    return { errors: { form: '목록이 오래되었습니다. 새로고침 후 다시 시도해주세요.' } };
  }

  const client = await createClient();
  const { error } = await client.rpc('admin_save_goods_variant_external_identity', {
    target_good_id: goodId,
    target_variant_id: variantId,
    target_erp_code: identity.value.erpCode,
    target_erp_name: identity.value.erpName,
    target_barcode: identity.value.barcode,
    target_expected_updated_at: expectedUpdatedAt?.toISOString() ?? null,
  });
  if (error) {
    const message = error.message;
    if (message.includes('goods_variant_external_identity_erp_code_key')) return { errors: { erpCode: '이미 사용 중인 ERP 코드입니다.' } };
    if (message.includes('goods_variant_external_identity_barcode_key')) return { errors: { barcode: '이미 사용 중인 바코드입니다.' } };
    if (message.includes('goods_variant_external_identity_changed') || message.includes('PT409')) {
      return { errors: { form: '옵션 ERP 식별자가 변경되었습니다. 새로고침 후 다시 저장해주세요.' } };
    }
    if (message.includes('invalid_goods_variant_external_identity')) return { errors: { form: 'ERP 코드·ERP 품명·바코드를 확인해주세요.' } };
    return { errors: { form: '옵션 ERP 식별자를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' } };
  }

  revalidatePath('/admin/catalog/goods');
  return { message: '옵션 ERP 식별자를 저장했습니다.' };
}
