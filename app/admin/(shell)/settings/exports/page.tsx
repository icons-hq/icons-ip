import { ExportConsole } from '@/components/admin/settings/ExportConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminExportsFilters } from '@/lib/admin/exports';
import { currentUserCanSecureExport, getAdminExportJobs, getAdminExportTemplates } from '@/lib/admin/exports.server';
import { getAdminStockLocations } from '@/lib/admin/variants.server';

/* 엑셀 양식 · 내보내기 — 요청은 원장에 남고 워커가 파일을 만든다. */
export default async function AdminExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/settings/exports');
  const filters = normalizeAdminExportsFilters(await searchParams);
  const [templates, jobs, locations, canSecureExport] = await Promise.all([
    getAdminExportTemplates(),
    getAdminExportJobs({ status: filters.status, page: filters.page }),
    getAdminStockLocations({ activeOnly: true }),
    currentUserCanSecureExport(),
  ]);

  return (
    <ExportConsole
      canSecureExport={canSecureExport}
      filters={filters}
      jobs={jobs}
      locations={locations}
      now={new Date().toISOString()}
      templates={templates}
    />
  );
}
