import { GoodsNoticePresetsScreen } from '@/components/admin/screens/GoodsNoticePresetsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { GOODS_NOTICE_PRESETS_PATH, normalizeGoodsNoticePresetFilters } from '@/lib/admin/goods-notice-presets';
import { loadGoodsNoticePresets } from '@/lib/admin/goods-notice-presets.server';

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess(GOODS_NOTICE_PRESETS_PATH);
  const data = await loadGoodsNoticePresets(normalizeGoodsNoticePresetFilters(await searchParams));
  return <GoodsNoticePresetsScreen data={data} />;
}
