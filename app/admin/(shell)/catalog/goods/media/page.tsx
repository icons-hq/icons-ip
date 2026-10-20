import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GoodsMediaScreen } from '@/components/admin/screens/GoodsMediaScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminGoodMedia } from '@/lib/admin/goods-media.server';
import { GOODS_MEDIA_PATH } from '@/lib/goods-media';

export const maxDuration = 60;
export default async function AdminGoodsMediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(GOODS_MEDIA_PATH, { capability: 'catalog.manage' });
  const params = await searchParams, goodId = typeof params.goodId === 'string' ? params.goodId : '';
  if (!goodId) return <section className="wc-admin-kit wc-admin-kit__screen"><h2>상품 동영상·숏클립</h2><p><Link href="/admin/catalog/goods">상품 조회/수정</Link>에서 상품을 선택한 뒤 동영상·숏클립을 등록해주세요.</p></section>;
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(goodId)) notFound();
  const initial = await loadAdminGoodMedia(goodId); if (!initial) notFound();
  return <GoodsMediaScreen key={goodId} initial={initial} />;
}
