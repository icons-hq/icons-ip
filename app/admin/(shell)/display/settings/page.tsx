import { StorePresentationScreen } from '@/components/admin/screens/StorePresentationScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminStorePresentation } from '@/lib/admin/store-presentation.server';
import { STORE_PRESENTATION_PATH } from '@/lib/store-presentation';
export default async function AdminStorePresentationPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  await requireAdminScreenAccess(STORE_PRESENTATION_PATH, { capability: 'store.manage' });
  const [snapshot, params] = await Promise.all([loadAdminStorePresentation(), searchParams]);
  return <StorePresentationScreen snapshot={snapshot} section={params?.tab === 'listing' ? 'listing' : 'common'} />;
}
