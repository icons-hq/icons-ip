import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';
import { normalizePgSettlementFilters, PG_SETTLEMENT_PATH } from '@/lib/settlements/console';
import { parsePgSettlementReport, pgSettlementRpcQuery } from '@/lib/settlements/report';
import { buildPgSettlementWorkbook } from '@/lib/settlements/export.server';

export const runtime = 'nodejs';
export const maxDuration = 60;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (message: string, status: number) => Response.json({ error: message }, { status, headers: HEADERS });
export async function GET(request: Request) {
  await requireAdminScreenAccess(PG_SETTLEMENT_PATH, { capability: 'sales.manage', adminOnly: true });
  const filters = normalizePgSettlementFilters(Object.fromEntries(new URL(request.url).searchParams));
  if (filters.rangeError || !filters.importId) return fail(filters.rangeError ?? '내려받을 완료 자료를 먼저 조회해주세요.', 400);
  try {
    const client = await createClient(), query = pgSettlementRpcQuery(filters);
    const result = await client.rpc('admin_export_pg_settlement_report', { p_query: query });
    const report = result.error ? null : parsePgSettlementReport(result.data, filters, true);
    if (!report?.snapshot || !report.fingerprint) return fail('완료 자료와 검색 결과를 확인하지 못해 파일을 만들지 않았습니다.', 503);
    const generatedAt = new Date(), bytes = await buildPgSettlementWorkbook(report, filters, generatedAt);
    const audit = await client.rpc('admin_record_pg_settlement_export', { p_query: query, p_fingerprint: report.fingerprint, p_record_count: report.pagination.total });
    if (audit.error || !isUuid(audit.data)) return fail('현재 권한과 다운로드 기록을 확인하지 못해 파일을 내보내지 않았습니다.', 503);
    const stamp = kstFileStamp(generatedAt);
    return new Response(new Uint8Array(bytes), { headers: { ...HEADERS,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition(`icons-정산내역-${stamp}.xlsx`, `icons-pg-settlements-${stamp}.xlsx`),
      'X-ICONS-Export-Audit': audit.data, 'X-ICONS-Export-Records': String(report.pagination.total), 'X-ICONS-Settlement-Import': report.snapshot.id,
    } });
  } catch (error) { unstable_rethrow(error); return fail('정산 파일을 만들지 못했습니다. 현재 권한과 연결 상태를 확인하고 다시 내려받아 주세요.', 503); }
}
