'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import type { AdminGoodSaleRestriction } from '@/lib/admin/catalog.server';
import { createClient } from '@/lib/supabase/server';

/*
 * 굿즈 판매 제한 유형(#392).
 *
 * 무통장 토글(good-bank-transfer-actions.ts)과 같은 층위의 행 단위 액션이다.
 * 굿즈 폼(admin_upsert_good)에 넣지 않는 이유도 같다 — 그 RPC는 고시정보 7칸을
 * 필수로 받아서, 19금 상품 하나를 잠그려고 상품 정보 전체를 다시 제출하게 만든다.
 * 바꾸는 것이 결제 수단이 아니라 노출·구매 가능 여부와 결제 PG 분기라는 점만
 * 다르고, 앞으로 값이 늘어날 수 있어(random_box) 불리언 토글이 아니라 enum 이다.
 *
 * enum 이라서 이상값을 "닫는 쪽"으로 읽지 않는다 — 임의 문자열은 DB 에러가 되기
 * 전에 여기서 거부한다. 운영자가 무엇을 고른 줄 알았는데 다른 값이 저장되는 것이
 * 성인 상품에서는 그대로 노출 사고가 된다.
 */
const SALE_RESTRICTIONS: readonly AdminGoodSaleRestriction[] = ['none', 'adult'];

const SALE_RESTRICTION_MESSAGES: Record<AdminGoodSaleRestriction, string> = {
  none: '이 굿즈는 판매 제한 없이 스토어에 노출됩니다.',
  adult: '이 굿즈는 성인(19금) 상품입니다. 성인인증 도입 전까지 스토어에서 숨기고 구매를 막습니다.',
};

export interface AdminGoodSaleRestrictionActionState {
  error?: string;
  message?: string;
}

export async function setGoodSaleRestrictionAction(
  _state: AdminGoodSaleRestrictionActionState,
  formData: FormData,
): Promise<AdminGoodSaleRestrictionActionState> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin');
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '굿즈를 찾을 수 없습니다.' };
  const submitted = String(formData.get('restriction') ?? '');
  const restriction = SALE_RESTRICTIONS.find((value) => value === submitted);
  if (!restriction) return { error: '지원하지 않는 판매 제한 유형입니다.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_sale_restriction', {
    target_id: id,
    target_restriction: restriction,
  });
  if (error) {
    return {
      error: error.message.includes('catalog_record_missing')
        ? '굿즈를 찾을 수 없습니다.'
        : '판매 제한 설정을 바꾸지 못했습니다.',
    };
  }

  revalidatePath('/admin');
  revalidatePath('/shop');
  return { message: SALE_RESTRICTION_MESSAGES[restriction] };
}
