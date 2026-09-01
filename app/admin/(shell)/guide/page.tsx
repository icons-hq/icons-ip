import { AdminGuideIndexScreen } from '@/components/admin/screens/AdminGuideIndexScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminGuidePage() {
  await requireAdminScreenAccess('/admin/guide');

  return <AdminGuideIndexScreen />;
}
