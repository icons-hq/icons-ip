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
import { goodsExportFilterText } from '@/lib/admin/goods-export-summary';
import { loadGoodsExportNames } from '@/lib/admin/goods-export-names.server';
import { loadGoodsExportParts } from '@/lib/admin/goods-import.server';
import { GOODS_WORKBOOK_ROW_LIMIT } from '@/lib/admin/goods-workbook';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/goods/export');
  const filters = normalizeGoodsListFilters(await searchParams);
  const [exported, names] = await Promise.all([loadGoodsExportParts(filters), loadGoodsExportNames(filters)]);
  const query = goodsListHref(filters).split('?')[1];
  const single = exported.parts.length === 1;
  return (
    <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-export">
      <AdminPageHeader
        title="상품 엑셀 내보내기"
        description="목록의 검색 조건에 맞는 상품을 상품 일괄등록과 같은 양식으로 내려받습니다."
        actions={
          <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={goodsListHref(filters)}>
            상품 목록
          </Link>
        }
      />
      <AdminSectionCard title="내려받을 파일">
        {/* 어떤 조건으로 걸렀는지 — 조건이 하나라도 보이지 않으면 파일에 뭐가 들었는지 알 수 없다. */}
        <p className="text-sm" data-goods-export="conditions">
          <span className="text-muted-foreground">검색 조건</span> {goodsExportFilterText(filters, names)}
        </p>
        {exported.parts.length ? (
          <>
            <p className="text-sm tabular-nums">{`${exported.totalGoods}개 상품 · 옵션 ${exported.totalRows}줄`}</p>
            {single ? null : (
              <p className="text-sm text-muted-foreground">
                {`한 파일에 ${GOODS_WORKBOOK_ROW_LIMIT}줄까지만 담을 수 있어 나누었습니다. 같은 상품의 옵션은 한 파일에 함께 들어갑니다.`}
              </p>
            )}
            <ul className="flex flex-col items-start gap-2">
              {exported.parts.map((ids, index) => (
                <li key={index}>
                  <a
                    className={buttonVariants({ variant: single ? 'default' : 'soft' })}
                    data-slot="button"
                    href={`/api/admin/goods-workbook?mode=export&part=${index + 1}&${query}`}
                  >
                    <Download aria-hidden="true" />
                    {single ? '엑셀 파일 내려받기' : `${index + 1}번 파일 내려받기 · ${ids.length}개 상품`}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">검색 조건에 맞는 상품이 없습니다. [상품 목록]에서 조건을 바꿔주세요.</p>
        )}
      </AdminSectionCard>
    </section>
  );
}
