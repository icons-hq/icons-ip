'use server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { parseCouponTargetGoods, type CouponTargetGood } from '@/lib/coupon-targeting';

export type CouponTargetSearch = { ok: true; items: CouponTargetGood[]; total: number; page: number; pageSize: number } | { ok: false; error: string };
export async function searchCouponTargetGoodsAction(queryValue: unknown, pageValue: unknown = 1): Promise<CouponTargetSearch> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user || !auth.isStaff) return { ok: false, error: '상품 검색은 운영자만 할 수 있습니다.' };
  const query = typeof queryValue === 'string' ? queryValue.trim() : '';
  const page = typeof pageValue === 'number' ? pageValue : Number.NaN;
  if (query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100_000) return { ok: false, error: '검색어와 페이지를 확인해주세요.' };
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase.rpc('admin_search_goods', { search_text: query }, { count: 'exact' })
      .select('id,code,name,archived_at').is('archived_at', null).order('code').order('id').range((page - 1) * 20, page * 20 - 1);
    if (error || !Array.isArray(data) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < data.length) return { ok: false, error: '상품 검색 결과를 불러오지 못했습니다.' };
    const items = parseCouponTargetGoods(data.map(row => ({ id: row.id, code: row.code, name: row.name, archivedAt: row.archived_at })));
    return items ? { ok: true, items, total: count, page, pageSize: 20 } : { ok: false, error: '상품 검색 결과를 확인할 수 없습니다.' };
  } catch { return { ok: false, error: '상품 검색 결과를 불러오지 못했습니다.' }; }
}
