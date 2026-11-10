import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeCustomerPurchaseFilters } from '@/lib/admin/customer-purchase-report';
import { getCustomerPurchaseReport } from '@/lib/admin/customer-purchase-report.server';
import { buildCustomerPurchaseWorkbook } from '@/lib/admin/customer-purchase-workbook.server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  await requireAdminScreenAccess('/admin/stats/customers');
  const now = new Date();
  const filters = normalizeCustomerPurchaseFilters(Object.fromEntries(new URL(request.url).searchParams), now);
  const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (filters.error) return Response.json({ error: filters.error }, { status: 400, headers: privateHeaders });
  try {
    const data = await getCustomerPurchaseReport(filters);
    const bytes = await buildCustomerPurchaseWorkbook(data, filters, now);
    return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="icons-customer-purchase-report.xlsx"',
    } });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: '고객 구매 분석 파일을 만들지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500, headers: privateHeaders });
  }
}
