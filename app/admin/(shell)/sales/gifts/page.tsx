import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminGiftFilters } from '@/lib/admin/gifts';
import { loadAdminGifts } from '@/lib/admin/gifts.server';
import { AdminGiftsScreen } from '@/components/admin/screens/AdminGiftsScreen';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess('/admin/sales/gifts', { capability: 'sales.read' });
  const filters = normalizeAdminGiftFilters(await searchParams), data = await loadAdminGifts(auth.user.id, filters);
  return <AdminGiftsScreen data={data} />;
}
