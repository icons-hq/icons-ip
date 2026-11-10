import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { buildAdminListExportWorkbook } from '@/lib/admin/list-export.server';
import { encryptAdminWorkbook } from '@/lib/admin/encrypted-workbook.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';
import { EXPORT_NO_STORE, ExportRequestError, exportErrorResponse, readExportPassword } from '@/lib/admin/export-request.server';
import { parseReviewExportQuery, REVIEW_EXPORT_QUERY_KEYS, reviewExportSheet } from '@/lib/admin/review-export';
import { prepareReviewExport, ReviewExportError } from '@/lib/admin/review-export.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

function methodNotAllowed() {
  return Response.json({ error: '리뷰 관리 화면에서 비밀번호를 입력해 내려받아 주세요.' }, {
    status: 405, headers: { ...EXPORT_NO_STORE, Allow: 'POST' },
  });
}
export { methodNotAllowed as GET, methodNotAllowed as HEAD, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE, methodNotAllowed as OPTIONS };

export async function POST(request: Request) {
  let auth;
  try { auth = await requireAdminScreenAccess('/admin/cs/reviews', { capability: 'cs.manage' }); }
  catch {
    // A download POST returns a private JSON denial, including guard redirects,
    // instead of navigating the file request to an HTML sign-in/error page.
    return exportErrorResponse('로그인 상태와 리뷰 관리 권한을 확인한 뒤 다시 내려받아 주세요.', 403);
  }
  try {
    const password = await readExportPassword(request, REVIEW_EXPORT_QUERY_KEYS);
    const filters = parseReviewExportQuery(new URL(request.url).searchParams);
    if (!filters) throw new ExportRequestError('다운로드 조건을 확인해주세요.');
    const prepared = await prepareReviewExport(auth.user.id, filters), generatedAt = new Date();
    const plain = await buildAdminListExportWorkbook(reviewExportSheet(prepared.snapshot), generatedAt);
    let encrypted;
    try { encrypted = encryptAdminWorkbook(plain, password); }
    finally { plain.fill(0); }
    const auditId = await prepared.recordEncryptedFile(encrypted.sha256), stamp = kstFileStamp(generatedAt);
    return new Response(new Uint8Array(encrypted.bytes), { headers: {
      ...EXPORT_NO_STORE, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition(`icons-리뷰-${stamp}.xlsx`, `icons-reviews-${stamp}.xlsx`),
      'X-ICONS-Export-Audit': auditId, 'X-ICONS-Export-Rows': String(prepared.snapshot.total),
      'X-ICONS-Export-Records': String(prepared.snapshot.total), 'X-ICONS-Export-Encryption': 'ECMA-376-Agile',
    } });
  } catch (error) {
    if (error instanceof ExportRequestError || error instanceof ReviewExportError) return exportErrorResponse(error.message, error.status);
    return exportErrorResponse('파일을 만들지 못했습니다. 현재 권한과 연결 상태를 확인하고 다시 내려받아 주세요.', 503);
  }
}
