import { hasAdminCapability } from '@/lib/admin/access';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { categoryExportCsv } from '@/lib/admin/category-export';
import { loadAdminCategoryExportRows } from '@/lib/admin/category.server';
import { adminListExportContentDisposition, kstFileStamp } from '@/lib/admin/list-export';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdminScreenAccess('/admin/catalog/categories');
  const includeErp = hasAdminCapability(auth, 'platform.manage');
  try {
    const rows = await loadAdminCategoryExportRows(includeErp), stamp = kstFileStamp(new Date());
    return new Response(categoryExportCsv(rows, includeErp), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': adminListExportContentDisposition(`icons-카테고리관리${includeErp ? '-ERP' : ''}-${stamp}.csv`, `icons-category${includeErp ? '-erp' : ''}-${stamp}.csv`),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: '카테고리 파일을 만들지 못했습니다. 다시 시도해주세요.' }, { status: 400 });
  }
}
