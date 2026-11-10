'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { mapCouponActionError } from '@/lib/coupons';

export async function claimCouponCodeAction(code: unknown): Promise<{ ok: boolean; message: string }> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { ok: false, message: '로그인 후 쿠폰을 등록해주세요.' };
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(normalized)) return { ok: false, message: '쿠폰 코드를 확인해주세요.' };
  try {
    const client = await createClient();
    const { error } = await client.rpc('claim_coupon_code', { p_code: normalized });
    if (error) return { ok: false, message: mapCouponActionError(error.message) };
    revalidatePath('/my/coupons'); revalidatePath('/cart'); revalidatePath('/checkout');
    return { ok: true, message: '쿠폰함에 등록했습니다. 쿠폰의 사용기간을 확인해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: '쿠폰을 등록하지 못했습니다. 다시 시도해주세요.' };
  }
}
