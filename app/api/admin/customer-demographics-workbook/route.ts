import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeDemographicFilters } from '@/lib/admin/customer-demographics';
import { getCustomerDemographicReport } from '@/lib/admin/customer-demographics.server';
import { buildCustomerDemographicWorkbook } from '@/lib/admin/customer-demographics-workbook.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  await requireAdminScreenAccess('/admin/stats/customers');
  const filters = normalizeDemographicFilters(Object.fromEntries(new URL(request.url).searchParams));
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (filters.error) return Response.json({ error: filters.error }, { status: 400, headers });
  try {
    const data = await getCustomerDemographicReport(filters), generatedAt = new Date(); const bytes = await buildCustomerDemographicWorkbook(data, generatedAt), stamp = kstFileStamp(generatedAt);
    return new Response(new Uint8Array(bytes), { headers: { ...headers,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition(`icons-성별연령통계-${stamp}.xlsx`, `icons-customer-demographics-${stamp}.xlsx`) } });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: '성별·연령 통계 파일을 만들지 못했습니다.' }, { status: 503, headers });
  }
}
