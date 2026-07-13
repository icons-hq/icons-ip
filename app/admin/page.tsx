import { notFound, redirect } from 'next/navigation';
import { Admin } from '@/components/admin/Admin';
import { getAdminCatalogRecords } from '@/lib/admin/catalog.server';
import { getAdminInsights } from '@/lib/admin/insights.server';
import { getAdminModerationRecords } from '@/lib/admin/moderation.server';
import { getAdminProfileRecords } from '@/lib/admin/roles.server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { getCatalogSnapshot } from '@/lib/catalog';

export default async function AdminPage() {
  const auth = await getCurrentAdminAuthState();

  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin')}`);
  }

  if (!auth.isStaff) {
    notFound();
  }

  const [catalog, records, moderation, insights, profiles] = await Promise.all([
    getCatalogSnapshot({ previewDefaultSource: 'supabase' }),
    getAdminCatalogRecords(),
    getAdminModerationRecords(),
    getAdminInsights(),
    auth.role === 'admin' ? getAdminProfileRecords() : Promise.resolve([]),
  ]);

  return (
    <Admin
      admin={{
        id: auth.user.id,
        email: auth.user.email,
        role: auth.role ?? 'staff',
      }}
      catalog={catalog}
      insights={insights}
      moderation={moderation}
      profiles={profiles}
      records={records}
    />
  );
}
