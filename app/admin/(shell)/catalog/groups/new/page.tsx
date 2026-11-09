import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { GOODS_GROUPS_PATH, validGoodsGroupGoodId } from '@/lib/admin/goods-groups';
import { loadGoodsGroupSource } from '@/lib/admin/goods-groups.server';
import { GoodsGroupConversion } from '@/components/admin/GoodsGroupConversion';
import { GoodsGroupEditor } from '@/components/admin/GoodsGroupEditor';
import { GoodsGroupsMenuNote } from '@/components/admin/screens/GoodsGroupsMenuNote';

export default async function NewGoodsGroupPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(`${GOODS_GROUPS_PATH}/new`, { capability: 'catalog.manage' });
  const params = await searchParams;
  const sourceGoodId = params?.sourceGoodId;
  if (sourceGoodId !== undefined && !validGoodsGroupGoodId(sourceGoodId) || params?.mode !== undefined && params.mode !== 'assemble') notFound();
  const assemble = params?.mode === 'assemble', client = await createClient();
  const [source, session] = await Promise.all([!assemble && sourceGoodId ? loadGoodsGroupSource(sourceGoodId) : Promise.resolve(null), client.auth.getSession()]);
  if (!assemble && sourceGoodId && !source) notFound();
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  /* 화면 머리(제목·설명·관련 화면)는 각 화면이 등록 방식 탭 아래에 그린다. */
  /* 안내는 넓은 화면에서 셸 제목 줄의 빈자리에 둔다 — 입력이 늦게 시작하지 않게. */
  return <div className="relative flex min-w-0 flex-col gap-4">
    <GoodsGroupsMenuNote className="lg:absolute lg:right-0 lg:bottom-full lg:mb-5" />
    {assemble ? <GoodsGroupEditor key={`new:${auth.user.id}:${sessionId}`} title="기존 상품으로 그룹 구성" initial={null} newGroupId={randomUUID()} actorId={auth.user.id} sessionId={sessionId} />
      : <GoodsGroupConversion key={`${sourceGoodId ?? 'new'}:${auth.user.id}:${sessionId}`} title="선택형 옵션에서 그룹 전환" initialSource={source} actorId={auth.user.id} sessionId={sessionId} />}
  </div>;
}
