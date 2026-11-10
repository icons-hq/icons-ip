import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { GOODS_RELATIONS_PATH, normalizeGoodsRelationFilters } from '@/lib/admin/goods-relations';
import { buildGoodsRelationsWorkbook, GoodsRelationsExportError, loadGoodsRelationsExport } from '@/lib/admin/goods-relations-export.server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  await requireAdminScreenAccess(GOODS_RELATIONS_PATH);
  const filters = normalizeGoodsRelationFilters(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const snapshot = await loadGoodsRelationsExport(filters);
    const bytes = await buildGoodsRelationsWorkbook(snapshot);
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="icons-goods-relations.xlsx"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-ICONS-Export-Rows': String(snapshot.rows.length),
    } });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof GoodsRelationsExportError) return Response.json({ error: error.message }, { status: error.code === 'limit' ? 400 : 409, headers: { 'Cache-Control': 'private, no-store' } });
    return Response.json({ error: '연관상품 파일을 만들지 못했습니다. 다시 조회한 뒤 내려받아 주세요.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
