import Link from 'next/link';
import { Download } from 'lucide-react';
import {
  AdminPageHeader,
  AdminSectionCard,
} from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import {
  goodsListHref,
  normalizeGoodsListFilters,
} from '@/lib/admin/goods-list';
import { loadGoodsExportParts } from '@/lib/admin/goods-import.server';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/goods/export');
  const filters = normalizeGoodsListFilters(await searchParams);
  const exported = await loadGoodsExportParts(filters);
  const query = goodsListHref(filters).split('?')[1];
  return (
    <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-export">
      <AdminPageHeader
        title="상품 엑셀 내보내기"
        description="목록의 검색·IP·게시·재고 필터를 적용한 상품을 같은 등록 양식으로 내려받습니다."
        actions={
          <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={goodsListHref(filters)}>
            상품 목록
          </Link>
        }
      />
      <AdminSectionCard title="내려받을 파일">
        <p className="text-sm tabular-nums">
          {exported.totalGoods}개 상품 · 옵션 {exported.totalRows}행
        </p>
        <p className="text-sm text-muted-foreground">
          파일당 최대 500행입니다. 같은 상품의 옵션은 하나의 파일에 함께
          담습니다. 내려받은 파일을 그대로 다시 올리면 변경 없이 완료됩니다.
        </p>
        {exported.parts.length ? (
          <ul className="flex flex-col items-start gap-2">
            {exported.parts.map((ids, index) => (
              <li key={index}>
                <a
                  className={buttonVariants({ variant: 'outline' })}
                  data-slot="button"
                  href={`/api/admin/goods-workbook?mode=export&part=${index + 1}&${query}`}
                >
                  <Download aria-hidden="true" />
                  {index + 1}번 파일 내려받기 · {ids.length}개 상품
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">현재 필터에 해당하는 상품이 없습니다.</p>
        )}
      </AdminSectionCard>
    </section>
  );
}
