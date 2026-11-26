import { notFound, unstable_rethrow } from 'next/navigation';
import { GoodsMediaGoodChooser } from '@/components/admin/GoodsMediaGoodChooser';
import { GoodsMediaScreen } from '@/components/admin/screens/GoodsMediaScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminGoodMedia } from '@/lib/admin/goods-media.server';
import { GOODS_MEDIA_PATH } from '@/lib/goods-media';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 60;

/* 영상 구성 조회는 상품 이름만 돌려주므로, 머리말에 이름과 함께 보일 상품 자동코드를 따로 읽는다(화면 규칙 8 — 내부 번호 대신).
   읽지 못해도 화면은 상품명만으로 열린다. */
async function loadGoodCode(goodId: string): Promise<string | null> {
  try {
    const client = await createClient();
    const { data } = await client.from('goods').select('code').eq('id', goodId).maybeSingle<{ code: string | null }>();
    return data?.code?.trim() || null;
  } catch (error) { unstable_rethrow(error); return null; }
}

export default async function AdminGoodsMediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(GOODS_MEDIA_PATH, { capability: 'catalog.manage' });
  const params = await searchParams, goodId = typeof params.goodId === 'string' ? params.goodId : '';
  if (!goodId) return <GoodsMediaGoodChooser />;
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(goodId)) notFound();
  const [initial, goodCode] = await Promise.all([loadAdminGoodMedia(goodId), loadGoodCode(goodId)]); if (!initial) notFound();
  return <GoodsMediaScreen key={goodId} initial={initial} goodCode={goodCode} />;
}
