import { ExportConsole } from '@/components/admin/settings/ExportConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminExportsFilters } from '@/lib/admin/exports';
import { currentUserCanSecureExport, getAdminExportJobs, getAdminExportTemplates } from '@/lib/admin/exports.server';
import { getAdminIpOptions } from '@/lib/admin/catalog-list.server';
import { getAdminStockLocations } from '@/lib/admin/variants.server';

/* 엑셀 양식 · 내보내기 — 요청은 원장에 남고 워커가 파일을 만든다. */
export default async function AdminExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/settings/exports');
  const query = await searchParams;
  const filters = normalizeAdminExportsFilters(query);
  const initialSourceId = typeof query.source === 'string' ? query.source : null;
  const [templates, jobs, locations, ipOptions, canSecureExport] = await Promise.all([
    getAdminExportTemplates(),
    getAdminExportJobs({ status: filters.status, page: filters.page }),
    getAdminStockLocations({ activeOnly: true }),
    getAdminIpOptions(),
    currentUserCanSecureExport(),
  ]);

  return (
    <ExportConsole
      initialSourceId={initialSourceId}
      canSecureExport={canSecureExport}
      filters={filters}
      ipOptions={ipOptions}
      jobs={jobs}
      locations={locations}
      now={new Date().toISOString()}
      templates={templates}
    />
  );
}
