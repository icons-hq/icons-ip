import { DispatchScreen } from '@/components/admin/screens/DispatchScreen';
import { normalizeAdminDispatchFilters } from '@/lib/admin/dispatch';
import { getAdminDispatchOrders } from '@/lib/admin/dispatch.server';
import { getAdminExportTemplates } from '@/lib/admin/exports.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminStockLocations } from '@/lib/admin/variants.server';

export default async function AdminSalesDispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 여기 주문 조회를
   * 막지 못한다.
   */
  await requireAdminScreenAccess('/admin/sales/dispatch');
  const query = await searchParams;

  /* 발주서 양식·출고지는 여기서 함께 읽는다 — 양식을 고르러 설정 화면으로 갔다 오면
     보던 탭·페이지가 사라진다(현업 3-2 #2). */
  const [data, exportTemplates, locations] = await Promise.all([
    getAdminDispatchOrders(normalizeAdminDispatchFilters(query)),
    getAdminExportTemplates(),
    getAdminStockLocations(),
  ]);

  return <DispatchScreen data={data} exportTemplates={exportTemplates} locations={locations} />;
}
