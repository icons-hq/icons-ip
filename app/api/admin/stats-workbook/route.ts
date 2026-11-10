import { getAdminSalesGoodsExport } from '@/lib/admin/stats-sales-goods.server';
import { SalesGoodsExportLimitError } from '@/lib/admin/stats-sales-goods';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminStatsComparisonFilters, normalizeAdminStatsFilters } from '@/lib/admin/stats';
import { getAdminClaimsReport, getAdminCustomerReport, getAdminSalesReport } from '@/lib/admin/stats.server';
import { buildStatsWorkbook } from '@/lib/admin/stats-workbook.server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const kind = params.report;
  await requireAdminScreenAccess(`/admin/stats/${kind === 'claims' || kind === 'customers' ? kind : 'sales'}`);
  if (!['sales', 'claims', 'customers'].includes(kind)) return Response.json({ error: '지원하지 않는 리포트입니다.' }, { status: 400 });
  const filters = normalizeAdminStatsFilters(params);
  if (filters.rangeError) return Response.json({ error: filters.rangeError }, { status: 400 });
  try {
    const now = new Date();
    const comparisonFilters = adminStatsComparisonFilters(filters, now);
    let bytes: Buffer;
    if (kind === 'sales') {
      const [data, comparison, goods, comparisonGoods] = await Promise.all([
        getAdminSalesReport(filters, now), comparisonFilters ? getAdminSalesReport(comparisonFilters, now) : null,
        getAdminSalesGoodsExport(filters, now), comparisonFilters ? getAdminSalesGoodsExport(comparisonFilters, now) : null,
      ]);
      bytes = await buildStatsWorkbook({ kind, data, comparison, goods, comparisonGoods }, filters, now);
    } else if (kind === 'claims') {
      const [data, comparison] = await Promise.all([getAdminClaimsReport(filters, now), comparisonFilters ? getAdminClaimsReport(comparisonFilters, now) : null]);
      bytes = await buildStatsWorkbook({ kind, data, comparison }, filters, now);
    } else {
      const [data, comparison] = await Promise.all([getAdminCustomerReport(filters, now), comparisonFilters ? getAdminCustomerReport(comparisonFilters, now) : null]);
      bytes = await buildStatsWorkbook({ kind: 'customers', data, comparison }, filters, now);
    }
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="icons-${kind}-report.xlsx"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof SalesGoodsExportLimitError) return Response.json({ error: error.message }, { status: 422 });
    return Response.json({ error: '리포트를 만들지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
