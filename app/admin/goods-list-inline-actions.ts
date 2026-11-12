'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { validGoodsGroupGoodId } from '@/lib/admin/goods-groups';
import type { GoodsListOptionStock } from '@/lib/admin/goods-list-inline';
import { createClient } from '@/lib/supabase/server';

/*
 * 상품 목록 옵션별 재고 창(1014-106·107)의 '다시 확인' 줄에 보일 현재 수량. 조회만 한다 — 저장은 기존 실재고 조정
 * (adjustAdminStockAction → admin_adjust_stock)이 그대로 맡는다. 창은 목록 페이지와 따로 남아 있어(필터·정렬로 그 상품이
 * 목록에서 빠져도) 목록이 다시 그린 값에 기대지 않고 그 상품의 사용 옵션만 새로 읽는다. 상품 조회 권한(catalog.read)이면 쓸 수 있다.
 */
export type GoodsOptionStockReadResult = { ok: true; options: GoodsListOptionStock[] } | { ok: false; error: string };

export async function readGoodsOptionStocksAction(goodId: unknown): Promise<GoodsOptionStockReadResult> {
  try {
    if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.read' })) return { ok: false, error: '상품을 조회할 권한이 필요합니다.' };
    if (!validGoodsGroupGoodId(goodId)) return { ok: false, error: '상품을 확인하지 못했습니다.' };
    const { data, error } = await (await createClient()).from('goods_variants').select('id,name,code,stock_qty')
      .eq('good_id', goodId).is('archived_at', null).order('sort_order').order('id').limit(1000);
    if (error || !Array.isArray(data)) return { ok: false, error: '현재 옵션 수량을 읽지 못했습니다. 잠시 후 다시 시도해주세요.' };
    const rows = data as { id: unknown; name: unknown; code: unknown; stock_qty: unknown }[];
    if (rows.some(row => typeof row.id !== 'string' || !Number.isSafeInteger(row.stock_qty) || (row.stock_qty as number) < 0)) {
      return { ok: false, error: '현재 옵션 수량을 읽지 못했습니다. 잠시 후 다시 시도해주세요.' };
    }
    return { ok: true, options: rows.map(row => ({ variantId: row.id as string, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : '이름 없는 옵션',
      code: typeof row.code === 'string' ? row.code : '', stockQty: row.stock_qty as number })) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '현재 옵션 수량을 읽지 못했습니다. 잠시 후 다시 시도해주세요.' };
  }
}
