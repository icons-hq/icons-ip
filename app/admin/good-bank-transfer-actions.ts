'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * 굿즈 무통장 토글(#256).
 *
 * 굿즈 폼(admin_upsert_good)에 넣지 않는다. 그 RPC는 고시정보 7칸을 필수로 받아서,
 * 운영 스위치 하나를 끄려고 상품 정보 전체를 다시 제출하게 만든다 — 한정 드롭
 * 직전에 정작 못 끄는 상황이 생긴다. 보관 토글과 같은 등급의 행 단위 액션이지만
 * 바꾸는 것은 카탈로그 노출이 아니라 결제 수단이라, 보관 액션과 한 파일에 두지 않고
 * 결제 액션(unpaid-actions.ts)과 같은 층위의 모듈로 둔다.
 */
export interface AdminGoodBankTransferActionState {
  error?: string;
  message?: string;
}

export async function setGoodBankTransferAction(
  _state: AdminGoodBankTransferActionState,
  formData: FormData,
): Promise<AdminGoodBankTransferActionState> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin');
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '굿즈를 찾을 수 없습니다.' };
  const allowed = String(formData.get('allowed') ?? '') === 'true';

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_bank_transfer', {
    target_id: id,
    target_allowed: allowed,
  });
  if (error) {
    return {
      error: error.message.includes('catalog_record_missing')
        ? '굿즈를 찾을 수 없습니다.'
        : '무통장 설정을 바꾸지 못했습니다.',
    };
  }

  revalidatePath('/admin');
  revalidatePath('/shop');
  return {
    message: allowed
      ? '이 굿즈로 무통장 입금 주문을 받습니다.'
      : '이 굿즈는 무통장 입금을 받지 않습니다. 카드 결제만 열립니다.',
  };
}
