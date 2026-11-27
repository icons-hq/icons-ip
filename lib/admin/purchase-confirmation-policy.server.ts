import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { parsePurchaseConfirmationPolicy, type PurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';

/** 거래확정 정책(자동 확정 켜짐·기간). 읽지 못하면 null — 화면은 계속 열리고 그 자리에서 알린다. */
export async function getPurchaseConfirmationPolicy(): Promise<PurchaseConfirmationPolicy | null> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_purchase_confirmation_policy');
    return error ? null : parsePurchaseConfirmationPolicy(data);
  } catch (error) {
    /* 로그인 이동 같은 Next 내부 신호는 삼키지 않는다. */
    unstable_rethrow(error);
    return null;
  }
}
