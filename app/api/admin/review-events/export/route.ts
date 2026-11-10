import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { REVIEW_EVENTS_ADMIN_PATH } from '@/lib/review-events';
import { normalizeReviewEventExportFilters, parseReviewEventExportSnapshot, reviewEventExportSheet } from '@/lib/admin/review-event-export';
import { buildAdminListExportWorkbook } from '@/lib/admin/list-export.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';

export const runtime = 'nodejs';
export const maxDuration = 60;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: NO_STORE });
export async function GET(request: Request) {
  await requireAdminScreenAccess(REVIEW_EVENTS_ADMIN_PATH);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (params.privacyConfirmed !== 'yes') return fail('개인정보 파일 취급 안내를 확인해주세요.', 400);
  const filters = normalizeReviewEventExportFilters(params);
  if (!filters) return fail('내려받을 목록과 이벤트를 확인해주세요.', 400);
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_export_review_events', { p_filters: filters });
    if (error?.message === 'review_event_export_limit') return fail('최대 10,000건입니다. 검색 조건을 좁혀 다시 내려받아 주세요.', 422);
    if (error?.message === 'review_event_not_found') return fail('이벤트를 찾을 수 없습니다.', 404);
    const snapshot = error ? null : parseReviewEventExportSnapshot(data, filters);
    if (!snapshot) return fail('목록을 불러오지 못해 파일을 만들지 않았습니다.', 503);
    const generatedAt = new Date();
    const bytes = await buildAdminListExportWorkbook(reviewEventExportSheet(snapshot), generatedAt);
    const audit = await client.rpc('admin_record_review_event_export', { p_filters: filters, p_fingerprint: snapshot.fingerprint, p_row_count: snapshot.total });
    if (audit.error?.message === 'review_event_export_changed' || audit.error?.message === 'review_event_export_limit' || audit.error?.message === 'review_event_not_found') return fail('목록이나 저장된 선정 상태가 바뀌어 파일을 만들지 않았습니다. 다시 내려받아 주세요.', 409);
    if (audit.error || !isUuid(audit.data)) return fail('다운로드 기록이나 현재 권한을 확인하지 못해 파일을 만들지 않았습니다.', 503);
    const stamp = kstFileStamp(generatedAt), label = filters.mode === 'events' ? '리뷰이벤트목록' : '리뷰이벤트응모';
    return new Response(new Uint8Array(bytes), { headers: { ...NO_STORE,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition(`icons-${label}-${stamp}.xlsx`, `icons-review-${filters.mode}-${stamp}.xlsx`),
      'X-ICONS-Export-Audit': audit.data, 'X-ICONS-Export-Rows': String(snapshot.total), 'X-ICONS-Export-Records': String(snapshot.total),
    } });
  } catch (error) { unstable_rethrow(error); return fail('파일을 만들지 못했습니다. 현재 권한과 연결 상태를 확인하고 다시 내려받아 주세요.', 503); }
}
