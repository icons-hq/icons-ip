import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  GOODS_NOTICE_PRESET_PAGE_SIZE,
  type GoodsNoticePresetFilters,
  type GoodsNoticePresetPageData,
} from '@/lib/admin/goods-notice-presets';

export async function loadGoodsNoticePresets(filters: GoodsNoticePresetFilters): Promise<GoodsNoticePresetPageData> {
  const supabase = await createClient();
  let query = supabase.from('goods_notice_presets')
    .select('id,name,maker,origin,material,size,made_on,as_manager,as_contact,updated_at', { count: 'exact' });
  if (filters.query) query = query.ilike('name', `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
  const { data, count, error } = await query.order('name').order('id')
    .range((filters.page - 1) * GOODS_NOTICE_PRESET_PAGE_SIZE, filters.page * GOODS_NOTICE_PRESET_PAGE_SIZE - 1);
  if (error) throw new Error('프리셋 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / GOODS_NOTICE_PRESET_PAGE_SIZE));
  if (filters.page > lastPage) return loadGoodsNoticePresets({ ...filters, page: lastPage });
  return {
    filters, total,
    presets: (data ?? []).map((row) => ({
      id: row.id, name: row.name, updatedAt: row.updated_at,
      notice: { maker: row.maker, origin: row.origin, material: row.material, size: row.size,
        madeOn: row.made_on, asManager: row.as_manager, asContact: row.as_contact },
    })),
  };
}
