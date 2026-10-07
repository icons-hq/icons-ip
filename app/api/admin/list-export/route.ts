import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import {
  ADMIN_LIST_EXPORT_SCREENS,
  AdminListExportLimitError,
  adminListExportContentDisposition,
  adminListExportFileNames,
  isAdminListExportScreenId,
} from '@/lib/admin/list-export';
import { buildAdminListExportWorkbook } from '@/lib/admin/list-export.server';
import {
  AdminListExportAuditError,
  loadAdminListExportSheet,
  recordAdminListExport,
} from '@/lib/admin/list-export-data.server';
import { SHIPMENT_CONSOLE_TABS } from '@/lib/admin/shipment-dispatch';

export const runtime = 'nodejs';
/* 상한(10,000행)까지 여러 페이지를 읽는다. 플랫폼 기본 시한에 맡기지 않는다. */
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * 주문·배송 화면의 목록 엑셀 다운로드.
 *
 * `?screen=<화면 id>&<화면 검색 파라미터>`를 받아 화면과 같은 조건의 전체 결과를 .xlsx로
 * 돌려준다. 권한은 해당 화면 경로로 확인하고, 다운로드 감사 기록이 남아야 파일을 응답한다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const screen = params.get('screen');
  const definition = isAdminListExportScreenId(screen) ? ADMIN_LIST_EXPORT_SCREENS[screen] : null;
  await requireAdminScreenAccess(definition?.href ?? '/admin');
  if (!definition) return errorResponse('내려받을 화면을 확인해주세요.', 400);

  try {
    const now = new Date();
    const sheet = await loadAdminListExportSheet(definition.id, Object.fromEntries(params), now);
    const bytes = await buildAdminListExportWorkbook(sheet, now);
    const auditId = await recordAdminListExport(sheet);
    const tab = definition.id === 'dispatch' || definition.id === 'shipping'
      ? SHIPMENT_CONSOLE_TABS[definition.id].find((item) => item.id === sheet.filters.tab)?.label
      : undefined;
    const { fileName, asciiFileName } = adminListExportFileNames(definition.id, now, tab);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': adminListExportContentDisposition(fileName, asciiFileName),
        'X-ICONS-Export-Audit': auditId,
        'X-ICONS-Export-Rows': String(sheet.rows.length),
        'X-ICONS-Export-Records': String(sheet.recordCount),
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AdminListExportLimitError) return errorResponse(error.message, 400);
    if (error instanceof AdminListExportAuditError) return errorResponse(error.message, 500);
    return errorResponse(
      error instanceof Error && /[가-힣]/.test(error.message)
        ? error.message
        : '목록을 불러오지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.',
      500,
    );
  }
}
