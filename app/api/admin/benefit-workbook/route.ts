import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { BENEFIT_REPORT_PATH, BenefitIssuanceError, normalizeBenefitReportFilters } from '@/lib/admin/benefit-report';
import { getBenefitIssuances, getBenefitReport } from '@/lib/admin/benefit-report.server';
import { buildBenefitWorkbook } from '@/lib/admin/benefit-workbook.server';
import { adminStatsPreviousFilters } from '@/lib/admin/stats';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  await requireAdminScreenAccess(BENEFIT_REPORT_PATH);
  const filters = normalizeBenefitReportFilters(Object.fromEntries(new URL(request.url).searchParams));
  if (filters.rangeError) return Response.json({ error: filters.rangeError }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const now = new Date();
    const [data, comparison, issuances] = await Promise.all([
      getBenefitReport(filters, now, true),
      filters.compare ? getBenefitReport({ ...filters, ...adminStatsPreviousFilters(filters, now), page: 1 }, now) : null,
      filters.detail === 'issuances' ? getBenefitIssuances(filters, now, true) : null,
    ]);
    const bytes = await buildBenefitWorkbook(data, comparison, filters, now, issuances);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="icons-benefit-report.xlsx"', 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof BenefitIssuanceError) {
      const status = error.code === 'benefit_issuance_forbidden' ? 403 : error.code === 'benefit_issuance_read_failed' ? 500 : 400;
      const message = error.code === 'benefit_issuance_export_limit' ? '발급 상세 내보내기는 최대 10,000건입니다. 기간이나 혜택 조건을 줄여주세요.'
        : error.code === 'benefit_issuance_forbidden' ? '혜택 리포트를 조회할 권한이 없습니다.'
          : error.code === 'benefit_issuance_invalid_filters' ? '쿠폰과 조회기간을 다시 확인해주세요.' : '발급 상세를 읽지 못했습니다. 잠시 후 다시 시도해주세요.';
      return Response.json({ error: message, code: error.code }, { status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const tooLarge = error instanceof Error && error.message === 'benefit_export_limit';
    return Response.json({ error: tooLarge ? '내보내기 한도는 10,000행입니다. 기간이나 혜택 조건을 줄여주세요.' : '리포트를 만들지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: tooLarge ? 400 : 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
