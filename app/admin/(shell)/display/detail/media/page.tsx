import { DetailMediaScreen } from '@/components/admin/screens/DetailMediaScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminGoodsMediaSettings } from '@/lib/admin/goods-media.server';
import { GOODS_MEDIA_SETTINGS_PATH } from '@/lib/goods-media';

export default async function AdminDetailMediaPage() {
  await requireAdminScreenAccess(GOODS_MEDIA_SETTINGS_PATH, { capability: 'store.manage' });
  return <DetailMediaScreen initial={await loadAdminGoodsMediaSettings()} />;
}
