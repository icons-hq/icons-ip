import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { GOODS_GROUPS_PATH, validGoodsGroupGoodId } from '@/lib/admin/goods-groups';
import { loadGoodsGroupSource } from '@/lib/admin/goods-groups.server';
import { GoodsGroupConversion } from '@/components/admin/GoodsGroupConversion';
import { GoodsGroupEditor } from '@/components/admin/GoodsGroupEditor';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';

export default async function NewGoodsGroupPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(`${GOODS_GROUPS_PATH}/new`, { capability: 'catalog.manage' });
  const params = await searchParams;
  const sourceGoodId = params?.sourceGoodId;
  if (sourceGoodId !== undefined && !validGoodsGroupGoodId(sourceGoodId) || params?.mode !== undefined && params.mode !== 'assemble') notFound();
  const assemble = params?.mode === 'assemble', client = await createClient();
  const [source, session] = await Promise.all([!assemble && sourceGoodId ? loadGoodsGroupSource(sourceGoodId) : Promise.resolve(null), client.auth.getSession()]);
  if (!assemble && sourceGoodId && !source) notFound();
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <><AdminPageHeader title={assemble ? '기존 상품으로 그룹 구성' : '선택형 옵션에서 그룹 전환'} />
    {assemble ? <GoodsGroupEditor key={`new:${auth.user.id}:${sessionId}`} initial={null} newGroupId={randomUUID()} actorId={auth.user.id} sessionId={sessionId} />
      : <GoodsGroupConversion key={`${sourceGoodId ?? 'new'}:${auth.user.id}:${sessionId}`} initialSource={source} actorId={auth.user.id} sessionId={sessionId} />}</>;
}
