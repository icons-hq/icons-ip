import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { isSettledExportId, settledExportErrorMessage } from '@/lib/admin/settled-export';
import { buildSettledWorkbook } from '@/lib/admin/settled-workbook.server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  await requireAdminScreenAccess('/admin/sales/settled');
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!isSettledExportId(id)) return Response.json({ error: '엑셀 기록 번호를 확인해주세요.' }, { status: 400 });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_read_settled_export', { p_export_id: id });
    if (error) return Response.json({ error: settledExportErrorMessage(error.message) }, { status: 400 });
    const bytes = await buildSettledWorkbook(data);
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="icons-settled-${id}.xlsx"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-ICONS-Export-Receipt': id,
    } });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: error instanceof Error && /[가-힣]/.test(error.message) ? error.message : settledExportErrorMessage() }, { status: 400 });
  }
}
