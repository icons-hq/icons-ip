import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { GOODS_PHOTOS_PATH } from '@/lib/admin/goods-photo-library';
import { loadGoodsPhotos } from '@/lib/admin/goods-photo-library.server';
import { GoodsPhotoLibraryScreen } from '@/components/admin/screens/GoodsPhotoLibraryScreen';

export default async function Page() {
  await requireAdminScreenAccess(GOODS_PHOTOS_PATH);
  return <GoodsPhotoLibraryScreen initial={await loadGoodsPhotos()} />;
}
