import { SettledScreen } from '@/components/admin/screens/SettledScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminSettledFilters } from '@/lib/admin/settled';
import { getAdminSettledOrders } from '@/lib/admin/settled.server';
import { getAdminExportTemplates } from '@/lib/admin/exports.server';

export default async function AdminSalesSettledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/sales/settled');
  const query = await searchParams;

  /* 내보내기 양식은 화면에서 바로 고른다(현업 3-3) — 설정으로 갔다 오면 조건이 흐려진다. */
  const [data, templates] = await Promise.all([
    getAdminSettledOrders(normalizeAdminSettledFilters(query)),
    getAdminExportTemplates(),
  ]);

  return <SettledScreen data={data} templates={templates} />;
}
