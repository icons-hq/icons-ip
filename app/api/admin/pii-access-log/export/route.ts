import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { buildAdminListExportWorkbook } from '@/lib/admin/list-export.server';
import { encryptAdminWorkbook } from '@/lib/admin/encrypted-workbook.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';
import { EXPORT_NO_STORE, ExportRequestError, exportErrorResponse, readExportPassword } from '@/lib/admin/export-request.server';
import { PII_ACCESS_LOG_EXPORT_QUERY_KEYS, PII_ACCESS_LOG_PATH, normalizePiiAccessLogFilters, piiAccessLogExportSheet } from '@/lib/admin/pii-access-log';
import { loadPiiAccessLogExport, PiiAccessLogError, PiiAccessLogExportLimitError, recordPiiAccess } from '@/lib/admin/pii-access-log.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 접속기록 목록 엑셀은 운영자 IP가 담겨 비밀번호를 건 POST로만 준다. 평문 GET은 없다. */
export async function GET() {
  return Response.json({ error: '개인정보 접속기록 화면에서 비밀번호를 입력해 내려받아 주세요.' }, { status: 405, headers: { ...EXPORT_NO_STORE, Allow: 'POST' } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScreenAccess(PII_ACCESS_LOG_PATH);
  try {
    const password = await readExportPassword(request, PII_ACCESS_LOG_EXPORT_QUERY_KEYS);
    const filters = normalizePiiAccessLogFilters(Object.fromEntries(new URL(request.url).searchParams));
    if (filters.adjusted) throw new ExportRequestError('다운로드 조건을 확인해주세요.');
    const data = await loadPiiAccessLogExport(filters);
    const actorName = filters.actor ? data.rows.find(row => row.actorId === filters.actor)?.actorName ?? null : null;
    const plain = await buildAdminListExportWorkbook(piiAccessLogExportSheet(data, filters, actorName), new Date(data.capturedAt));
    let encrypted;
    try { encrypted = encryptAdminWorkbook(plain, password); }
    finally { plain.fill(0); }
    // 이 파일을 내려받은 사실도 접속기록이다. 기록이 남아야 파일을 준다.
    const recordId = await recordPiiAccess({ actorId: auth.user.id, action: 'export', surface: 'access_log', path: '/api/admin/pii-access-log/export',
      subjectKind: 'none', detail: { from: filters.from, to: filters.to, records: data.rows.length, actorFiltered: Boolean(filters.actor),
        subjectFiltered: Boolean(filters.subject), action: filters.action, surface: filters.surface, flag: filters.flag } });
    const stamp = kstFileStamp(new Date(data.capturedAt));
    return new Response(new Uint8Array(encrypted.bytes), { headers: {
      ...EXPORT_NO_STORE,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition(`xsquare-개인정보접속기록-${stamp}.xlsx`, `xsquare-pii-access-log-${stamp}.xlsx`),
      'X-ICONS-Export-Audit': recordId, 'X-ICONS-Export-Rows': String(data.rows.length), 'X-ICONS-Export-Records': String(data.rows.length),
      'X-ICONS-Export-Encryption': 'ECMA-376-Agile',
    } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ExportRequestError) return exportErrorResponse(error.message, error.status);
    if (error instanceof PiiAccessLogExportLimitError) return exportErrorResponse(error.message, 400);
    if (error instanceof PiiAccessLogError) return exportErrorResponse(error.message, 500);
    return exportErrorResponse('접속기록을 불러오지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.', 500);
  }
}
