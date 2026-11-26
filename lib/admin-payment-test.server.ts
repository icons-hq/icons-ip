import 'server-only';
import { ADMIN_PAYMENT_TEST_GOOD_ID } from './admin-payment-test';
import { toGood } from './catalog';
import { PUBLIC_MEDIA_BUCKET, normalizePublicMediaPath } from './media';
import { getSupabaseConfig } from './supabase/config';
import { createClient } from './supabase/server';

/** 공유 카탈로그 캐시를 거치지 않는다. 일반 회원과 스태프 세션에는 goods RLS가 빈 행을 돌려준다. */
export async function loadAdminPaymentTestGood() {
  if (!getSupabaseConfig().isConfigured) return null;
  const db = await createClient();
  const { data, error } = await db.from('goods')
    .select('id,ip_id,name,price,origin_id,shipping_fee_type,stock,stock_qty,bg,image_path,badge,allow_bank_transfer,allow_card_payment,order_quantity_limit_enabled,min_order_qty,max_order_qty,ips!inner(id),goods_variants(id,name,code,price,stock_qty,is_default,attributes,archived_at,sort_order)')
    .eq('id', ADMIN_PAYMENT_TEST_GOOD_ID).is('published_at', null).is('archived_at', null)
    .not('ips.published_at', 'is', null).is('ips.archived_at', null).maybeSingle();
  if (error) throw new Error('결제 테스트 상품을 조회하지 못했습니다.');
  if (!data) return null;
  return toGood(data, path => db.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl);
}
