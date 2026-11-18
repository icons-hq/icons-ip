import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { normalizeStoreCreditConsoleFilters, parseStoreCreditConsoleData, STORE_CREDIT_CONSOLE_PATH } from '@/lib/admin/store-credit-console';
import { buildStoreCreditWorkbook } from '@/lib/admin/store-credit-workbook.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';
import { recordPiiAccess } from '@/lib/admin/pii-access-log.server';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const auth = await requireAdminScreenAccess(STORE_CREDIT_CONSOLE_PATH,{adminOnly:true});
  const params = Object.fromEntries(new URL(request.url).searchParams);
  if (params.privacyConfirmed !== 'yes') return Response.json({error:'개인정보 파일 취급 안내를 확인해주세요.'},{status:400});
  const filters = normalizeStoreCreditConsoleFilters(params);
  try {
    const client = await createClient(); const {data,error} = await client.rpc('admin_export_store_credit_console',{p_mode:filters.mode,p_query:filters.query,p_from:filters.from || null,p_to:filters.to || null,p_kind:filters.kind});
    if (error?.message === 'store_credit_export_limit') return Response.json({error:'최대 10,000행입니다. 검색 기간이나 조건을 좁혀주세요.'},{status:422});
    const parsed = error ? null : parseStoreCreditConsoleData(data,filters,10000);
    if (!parsed || parsed.rows.length !== parsed.total || typeof data.capturedAt !== 'string' || !Number.isFinite(Date.parse(data.capturedAt))) throw new Error('invalid_export_result');
    const bytes = await buildStoreCreditWorkbook(parsed,data.capturedAt), stamp = kstFileStamp(new Date(data.capturedAt));
    // 개인정보 접속기록(내려받기). 원장은 고객 ID·이름·가린 이메일이 담겨 회원 ID(최대 1,000명)·인원을, 지급 작업 목록은 고객 정보가 없어 건수만 남긴다.
    const members = filters.mode === 'ledger' ? [...new Set(parsed.rows.map(row => row.userId).filter((id): id is string => Boolean(id)))] : [];
    await recordPiiAccess({ actorId: auth.user.id, action: 'export', surface: 'export.store_credits', path: '/api/admin/store-credit-workbook',
      subjectKind: filters.mode === 'ledger' ? 'member' : 'none', subjectIds: members, subjectCount: members.length,
      detail: { mode: filters.mode, records: parsed.rows.length } });
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':adminListExportContentDisposition(`icons-${filters.mode === 'ledger' ? '적립금원장' : '적립금지급관리'}-${stamp}.xlsx`,`icons-store-credits-${filters.mode}-${stamp}.xlsx`),'Cache-Control':'private, no-store'}});
  } catch (error) { unstable_rethrow(error); return Response.json({error:'적립금 엑셀을 만들지 못했습니다. 검색 조건과 권한을 확인해주세요.'},{status:500}); }
}
