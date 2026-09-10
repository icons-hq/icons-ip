import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { categoryExportCsv } from '@/lib/admin/category-export';
import { loadAdminCategoryExportRows } from '@/lib/admin/category.server';

export const runtime = 'nodejs';

export async function GET() {
  await requireAdminScreenAccess('/admin/catalog/categories');
  try {
    const rows = await loadAdminCategoryExportRows();
    return new Response(categoryExportCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="icons-category-erp.csv"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: '카테고리 파일을 만들지 못했습니다. 다시 시도해주세요.' }, { status: 400 });
  }
}
