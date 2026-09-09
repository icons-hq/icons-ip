import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { buildGoodsWorkbook } from '@/lib/admin/goods-workbook-file';
import {
  goodsImportErrorMessage,
  loadGoodsExportRows,
  loadGoodsImportBatch,
} from '@/lib/admin/goods-import.server';
import { normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import type { GoodsWorkbookRow } from '@/lib/admin/goods-workbook';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const auth = await requireAdminScreenAccess('/admin/catalog/goods/import');
  try {
    const params = new URL(request.url).searchParams;
    const mode = params.get('mode') ?? 'template';
    let rows: GoodsWorkbookRow[] = [];
    let errors: string[] | undefined;
    if (mode === 'export')
      rows = await loadGoodsExportRows(
        normalizeGoodsListFilters(Object.fromEntries(params)),
        Number(params.get('part') ?? 1),
      );
    else if (mode === 'failures') {
      const batch = await loadGoodsImportBatch(
        params.get('batch') ?? '',
        auth.user.id,
      );
      errors = [];
      batch.plan.forEach((group, index) => {
        if (group.kind !== 'error' && batch.results[index]?.status !== 'failed')
          return;
        const message = group.errors.length
          ? group.errors.join(' / ')
          : goodsImportErrorMessage(batch.results[index]?.error);
        for (const row of group.source) {
          rows.push(row.values);
          errors!.push(message);
        }
      });
      if (!rows.length)
        return Response.json(
          { error: '실패한 행이 없습니다.' },
          { status: 400 },
        );
    } else if (mode !== 'template')
      return Response.json(
        { error: '잘못된 다운로드 요청입니다.' },
        { status: 400 },
      );
    const bytes = await buildGoodsWorkbook(rows, errors);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="icons-goods-${mode}${mode === 'export' ? `-${params.get('part') ?? 1}` : ''}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json(
      {
        error:
          error instanceof Error && /[가-힣]/.test(error.message)
            ? error.message
            : '파일을 만들지 못했습니다. 다시 시도해주세요.',
      },
      { status: 400 },
    );
  }
}
