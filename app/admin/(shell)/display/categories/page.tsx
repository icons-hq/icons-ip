import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminCategoryDisplay, loadAdminCategoryDisplays } from '@/lib/admin/category-display.server';
import { CATEGORY_DISPLAY_ADMIN_PATH } from '@/lib/category-display';
import { CategoryDisplayScreen } from '@/components/admin/screens/CategoryDisplayScreen';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';

export default async function CategoryDisplayPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess(CATEGORY_DISPLAY_ADMIN_PATH, { capability: 'store.manage' });
  const [directory, params, client] = await Promise.all([loadAdminCategoryDisplays(), searchParams, createClient()]);
  const id = params?.id === undefined ? directory.categories[0]?.id : typeof params.id === 'string' ? params.id : null;
  if (params?.id !== undefined && (!id || !directory.categories.some(category => category.id === id))) notFound();
  const [initial, session] = await Promise.all([id ? loadAdminCategoryDisplay(id) : Promise.resolve(null), client.auth.getSession()]);
  if (id && !initial) notFound();
  return <CategoryDisplayScreen directory={directory} initial={initial} actorId={auth.user.id} sessionId={session.data.session ? inquiryDraftSessionId(session.data.session.access_token) : null} />;
}
