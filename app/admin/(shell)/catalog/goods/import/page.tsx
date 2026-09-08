import { unstable_rethrow } from 'next/navigation';
import { GoodsImportScreen } from '@/components/admin/screens/GoodsImportScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import {
  goodsImportView,
  loadGoodsImportBatch,
} from '@/lib/admin/goods-import.server';
import { GOODS_IMPORT_PATH } from '@/lib/admin/goods-workbook';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess(GOODS_IMPORT_PATH);
  const params = await searchParams;
  let initialView: ReturnType<typeof goodsImportView> | undefined;
  let initialError: string | undefined;
  try {
    const batch =
      typeof params.batch === 'string'
        ? await loadGoodsImportBatch(params.batch, auth.user.id)
        : undefined;
    initialView =
      batch && batch.state !== 'uploading' ? goodsImportView(batch) : undefined;
  } catch (error) {
    unstable_rethrow(error);
    initialError =
      '작업을 찾을 수 없거나 24시간 유효기간이 지났습니다. 파일을 다시 올려주세요.';
  }
  return (
    <GoodsImportScreen initialView={initialView} initialError={initialError} />
  );
}
export const maxDuration = 300;
