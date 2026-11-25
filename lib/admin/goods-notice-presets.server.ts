import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  GOODS_NOTICE_PRESET_PAGE_SIZE,
  normalizeGoodsKcPresetTemplate,
  type GoodsNoticePresetFilters,
  type GoodsNoticePresetPageData,
} from '@/lib/admin/goods-notice-presets';
import type { GoodsNoticeInfo } from '@/lib/goods-notice';

/** `admin_last_good_notice`가 읽는 칸과 같다. */
const GOOD_NOTICE_SELECT = 'name,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact';

/**
 * 보관하지 않은 상품 하나의 상품명과 고시정보 7칸. 상품 선택창에서 고른 다른 상품의 고시를 복사할 때 읽는다.
 * 상품이 없거나 보관됐으면 null, 읽지 못하면 예외다. 값이 비어 있는지는 부르는 쪽이 본다.
 */
export async function loadGoodNoticeOfGood(goodId: string): Promise<{ name: string; notice: GoodsNoticeInfo } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('goods').select(GOOD_NOTICE_SELECT).eq('id', goodId).is('archived_at', null).maybeSingle();
  if (error) throw new Error('상품의 고시정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  if (!data) return null;
  return {
    name: data.name,
    notice: {
      maker: data.notice_maker, origin: data.notice_origin, material: data.notice_material, size: data.notice_size,
      madeOn: data.notice_made_on, asManager: data.notice_as_manager, asContact: data.notice_as_contact,
    },
  };
}

export async function loadGoodsNoticePresets(filters: GoodsNoticePresetFilters): Promise<GoodsNoticePresetPageData> {
  const supabase = await createClient();
  let query = supabase.from('goods_notice_presets')
    .select('id,name,maker,origin,material,size,made_on,as_manager,as_contact,kc_template,updated_at', { count: 'exact' });
  if (filters.query) query = query.ilike('name', `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
  const { data, count, error } = await query.order('name').order('id')
    .range((filters.page - 1) * GOODS_NOTICE_PRESET_PAGE_SIZE, filters.page * GOODS_NOTICE_PRESET_PAGE_SIZE - 1);
  if (error) throw new Error('상품정보제공고시 템플릿 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / GOODS_NOTICE_PRESET_PAGE_SIZE));
  if (filters.page > lastPage) return loadGoodsNoticePresets({ ...filters, page: lastPage });
  return {
    filters, total,
    presets: (data ?? []).map((row) => ({
      id: row.id, name: row.name, updatedAt: row.updated_at,
      kcTemplate: normalizeGoodsKcPresetTemplate(row.kc_template),
      notice: { maker: row.maker, origin: row.origin, material: row.material, size: row.size,
        madeOn: row.made_on, asManager: row.as_manager, asContact: row.as_contact },
    })),
  };
}
