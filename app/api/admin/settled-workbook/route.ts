import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { isSettledExportId, settledExportErrorMessage } from '@/lib/admin/settled-export';
import { buildSettledWorkbook } from '@/lib/admin/settled-workbook.server';
import { encryptAdminWorkbook } from '@/lib/admin/encrypted-workbook.server';
import { recordEncryptedSettledExport } from '@/lib/admin/encrypted-export-audit.server';
import { EXPORT_NO_STORE, ExportRequestError, exportErrorResponse, readExportPassword } from '@/lib/admin/export-request.server';
import { AdminListExportAuditError } from '@/lib/admin/list-export-data.server';

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
    const plain = await buildSettledWorkbook(data);
    let encrypted;
    try { encrypted = encryptAdminWorkbook(plain, password); }
    finally { plain.fill(0); }
    const { bytes, sha256 } = encrypted;
    const auditId = await recordEncryptedSettledExport(auth.user.id, id, sha256);
    return new Response(new Uint8Array(bytes), { headers: {
      ...EXPORT_NO_STORE,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="icons-settled-${id}.xlsx"`,
      'X-ICONS-Export-Receipt': id, 'X-ICONS-Export-Audit': auditId, 'X-ICONS-Export-Encryption': 'ECMA-376-Agile',
    } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ExportRequestError) return exportErrorResponse(error.message, error.status);
    if (error instanceof AdminListExportAuditError) return exportErrorResponse(error.message, 500);
    return exportErrorResponse('거래확정 엑셀을 암호화하지 못했습니다. 다시 시도해주세요.', 500);
  }
}
