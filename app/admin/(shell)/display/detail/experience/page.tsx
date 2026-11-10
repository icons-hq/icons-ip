import { DetailExperienceScreen } from '@/components/admin/screens/DetailExperienceScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminDetailExperiences } from '@/lib/admin/product-detail-experiences.server';
import { PRODUCT_DETAIL_EXPERIENCE_PATH } from '@/lib/product-detail-experiences';
export default async function AdminDetailExperiencePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  await requireAdminScreenAccess(PRODUCT_DETAIL_EXPERIENCE_PATH, { capability: 'store.manage' });
  const [snapshot, params] = await Promise.all([loadAdminDetailExperiences(), searchParams]);
  return <DetailExperienceScreen snapshot={snapshot} section={params?.tab === 'discovery' ? 'discovery' : 'messages'} />;
}
