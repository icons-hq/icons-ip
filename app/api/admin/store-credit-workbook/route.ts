import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { normalizeStoreCreditConsoleFilters, parseStoreCreditConsoleData, STORE_CREDIT_CONSOLE_PATH } from '@/lib/admin/store-credit-console';
import { buildStoreCreditWorkbook } from '@/lib/admin/store-credit-workbook.server';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  await requireAdminScreenAccess(STORE_CREDIT_CONSOLE_PATH,{adminOnly:true});
  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (params.privacyConfirmed !== 'yes') return Response.json({error:'개인정보 파일 취급 안내를 확인해주세요.'},{status:400});
  const filters = normalizeStoreCreditConsoleFilters(params);
  try {
    const client = await createClient(); const {data,error} = await client.rpc('admin_export_store_credit_console',{p_mode:filters.mode,p_query:filters.query,p_from:filters.from || null,p_to:filters.to || null,p_kind:filters.kind});
    if (error?.message === 'store_credit_export_limit') return Response.json({error:'최대 10,000행입니다. 검색 기간이나 조건을 좁혀주세요.'},{status:422});
    const parsed = error ? null : parseStoreCreditConsoleData(data,filters,10000);
    if (!parsed || parsed.rows.length !== parsed.total || typeof data.capturedAt !== 'string' || !Number.isFinite(Date.parse(data.capturedAt))) throw new Error('invalid_export_result');
    const bytes = await buildStoreCreditWorkbook(parsed,data.capturedAt);
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="icons-store-credits-${filters.mode}.xlsx"`,'Cache-Control':'private, no-store'}});
  } catch (error) { unstable_rethrow(error); return Response.json({error:'적립금 엑셀을 만들지 못했습니다. 검색 조건과 권한을 확인해주세요.'},{status:500}); }
}
