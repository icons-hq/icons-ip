import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { isSettledExportId, settledExportErrorMessage } from '@/lib/admin/settled-export';
import { buildSettledWorkbook, loadSettledExportNumbers } from '@/lib/admin/settled-workbook.server';
import { encryptAdminWorkbook } from '@/lib/admin/encrypted-workbook.server';
import { recordEncryptedSettledExport } from '@/lib/admin/encrypted-export-audit.server';
import { EXPORT_NO_STORE, ExportRequestError, exportErrorResponse, readExportPassword } from '@/lib/admin/export-request.server';
import { AdminListExportAuditError } from '@/lib/admin/list-export-data.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';
import { PiiAccessLogError, recordPiiAccess } from '@/lib/admin/pii-access-log.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Old saved links return to the same receipt's password entry, never a plaintext file. */
export async function GET(request: Request) {
  await requireAdminScreenAccess('/admin/sales/settled');
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!isSettledExportId(id)) return exportErrorResponse('엑셀 기록 번호를 확인해주세요.', 400);
  return new Response(null, { status: 303, headers: { ...EXPORT_NO_STORE, Location: `/admin/sales/settled?exportReceipt=${id}` } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScreenAccess('/admin/sales/settled');
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!isSettledExportId(id)) return exportErrorResponse('엑셀 기록 번호를 확인해주세요.', 400);
  try {
    const password = await readExportPassword(request, ['id']);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_read_settled_export', { p_export_id: id });
    if (error) return exportErrorResponse(settledExportErrorMessage(error.message), 400);
    let orderIds: string[] = [];
    const plain = await buildSettledWorkbook(data, snapshot => {
      orderIds = snapshot.orders.map(order => order.id);
      return loadSettledExportNumbers(supabase, orderIds);
    });
    let encrypted;
    try { encrypted = encryptAdminWorkbook(plain, password); }
    finally { plain.fill(0); }
    const { bytes, sha256 } = encrypted;
    const auditId = await recordEncryptedSettledExport(auth.user.id, id, sha256), stamp = kstFileStamp(new Date());
    // 개인정보 접속기록(내려받기): 주문번호·운송장이 담긴 파일이다. 주문 ID(최대 1,000개)와 건수, 영수증·감사 번호만 남긴다.
    await recordPiiAccess({ actorId: auth.user.id, action: 'export', surface: 'export.settled', path: '/api/admin/settled-workbook',
      subjectKind: 'order', subjectIds: orderIds, subjectCount: orderIds.length, detail: { receiptId: id, auditId } });
    return new Response(new Uint8Array(bytes), { headers: {
      ...EXPORT_NO_STORE,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': adminListExportContentDisposition(`xsquare-거래확정-${stamp}.xlsx`, `xsquare-settled-${stamp}.xlsx`),
      'X-ICONS-Export-Receipt': id, 'X-ICONS-Export-Audit': auditId, 'X-ICONS-Export-Encryption': 'ECMA-376-Agile',
    } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ExportRequestError) return exportErrorResponse(error.message, error.status);
    if (error instanceof AdminListExportAuditError || error instanceof PiiAccessLogError) return exportErrorResponse(error.message, 500);
    return exportErrorResponse('거래확정 엑셀을 암호화하지 못했습니다. 다시 시도해주세요.', 500);
  }
}
