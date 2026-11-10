import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { GOODS_GROUPS_PATH } from '@/lib/admin/goods-groups';
import { loadGoodsGroup } from '@/lib/admin/goods-groups.server';
import { loadGoodsGroupConsole } from '@/lib/admin/goods-group-console.server';
import { normalizeGoodsGroupFilters } from '@/lib/admin/goods-group-console';
import { loadGoodsCategoryOptions } from '@/lib/admin/category.server';
import { loadGoodsFulfillmentOptions } from '@/lib/admin/fulfillment-origins.server';
import { GoodsGroupsScreen } from '@/components/admin/screens/GoodsGroupsScreen';
import { isUuid } from '@/lib/uuid';

export default async function GoodsGroupsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(GOODS_GROUPS_PATH, { capability: 'catalog.manage' });
  const params = await searchParams;
  const id = params?.id;
  if (id !== undefined && (typeof id !== 'string' || !isUuid(id))) notFound();
  const filters = normalizeGoodsGroupFilters(params ?? {});
  const client = await createClient();
  const [initialGroup, initialConsole, session, categories, origins] = await Promise.all([id ? loadGoodsGroup(id) : Promise.resolve(null), id ? Promise.resolve(null) : loadGoodsGroupConsole(filters), client.auth.getSession(),
    id ? Promise.resolve([]) : loadGoodsCategoryOptions(), id ? Promise.resolve([]) : loadGoodsFulfillmentOptions()]);
  if (id && !initialGroup) notFound();
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <GoodsGroupsScreen key={`${id ?? 'list'}:${auth.user.id}:${sessionId}:${JSON.stringify(filters)}`} initialGroup={initialGroup} initialPage={initialConsole} initialConsole={initialConsole} initialFilters={filters}
    categories={categories.map(row => ({ id: row.id, name: row.name, depth: row.depth }))} origins={origins.map(row => ({ id: row.id, name: row.name }))} actorId={auth.user.id} sessionId={sessionId} />;
}
