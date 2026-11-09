import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import type { ConsoleGridColumn } from '@/components/admin/console/ConsoleGrid';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { ErpCategoryMappingPanel } from '@/components/admin/ErpCategoryMappingPanel';
import { ErpItemImportPanel } from '@/components/admin/ErpItemImportPanel';
import { ErpItemListGrid } from '@/components/admin/ErpItemListGrid';
import { CATEGORY_PATH, categoryPath } from '@/lib/admin/category';
import {
  ERP_ITEMS_PAGE_SIZE,
  ERP_ITEMS_PATH,
  ERP_ITEM_SEARCH_QUERY_MAX,
  erpItemsHref,
  formatErpSalePrice,
} from '@/lib/admin/erp-items';
import type { ErpItemsWorkspaceData } from '@/lib/admin/erp-items.server';
import { kstDay } from '@/lib/admin/kst';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'code', label: 'ERP 코드', width: '140px' },
  { key: 'name', label: 'ERP 품명' },
  { key: 'category', label: 'ERP 분류' },
  { key: 'mapped', label: '고객 카테고리' },
  { key: 'salePrice', label: '판매가', align: 'end', width: '110px' },
  { key: 'barcode', label: '바코드', width: '150px' },
  { key: 'importedAt', label: '최근 반입', width: '110px' },
];

export function ErpItemsScreen({ data }: { data: ErpItemsWorkspaceData }) {
  const { filters, page, categories } = data;
  const categoryLabel = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground">연결 없음</span>;
    return categories.some((category) => category.id === id) ? categoryPath(categories, id).join(' > ') : id;
  };
  const rows = page.items.map((item) => ({
    id: item.code,
    selectLabel: `${item.code} ${item.name} 선택`,
    cells: [
      <span className="font-mono text-xs tabular-nums" key="code">{item.code}</span>,
      item.name,
      item.category ?? <span className="text-muted-foreground">없음</span>,
      categoryLabel(item.mappedCategoryId),
      formatErpSalePrice(item.salePrice),
      /* 바코드가 없으면 물류에서 막히는 품목이다 — 값이 비어 있는 것이 아니라 처리할 일로 보인다. */
      item.barcode ? <span className="font-mono text-xs tabular-nums" key="barcode">{item.barcode}</span> : <AdminStatusBadge key="barcode" tone="warning">없음</AdminStatusBadge>,
      <time className="tabular-nums" dateTime={item.importedAt} key="importedAt">{kstDay(new Date(item.importedAt))}</time>,
    ],
  }));

  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="erp-items">
    <AdminPageHeader
      title="ERP 품목"
      description="반입해 둔 품목은 상품 옵션에 ERP 품명을 입력할 때 코드·바코드·카테고리·판매가로 제안됩니다. ERP와 자동으로 연동되지 않으니 신제품이 생기면 다시 반입해주세요."
    />

    <ErpItemImportPanel defaultOpen={page.total === 0 && !filters.query} />

    {/* 반입 결과 목록을 먼저 보이고 분류 연결(설정)은 그 아래에 둔다. */}
    <AdminSectionCard
      title="반입된 품목"
      id="erp-item-list"
      summary={`총 ${page.total.toLocaleString('ko-KR')}건 · ERP 코드 순. 지울 품목은 줄 왼쪽 칸을 체크하면 삭제 버튼이 나타납니다.`}
    >
      <form action={ERP_ITEMS_PATH} className="flex flex-wrap items-center gap-2" role="search">
        <label className="text-sm font-medium whitespace-nowrap" htmlFor="erp-item-query">ERP 코드·품명 검색</label>
        <Input className="w-full sm:w-80" id="erp-item-query" name="q" type="search" defaultValue={filters.query} maxLength={ERP_ITEM_SEARCH_QUERY_MAX} placeholder="예: 000123, 아크릴 키링" />
        <Button variant="soft" type="submit">검색</Button>
        {filters.query ? <Link className="text-sm underline underline-offset-4" href={ERP_ITEMS_PATH}>전체 품목 보기</Link> : null}
      </form>
      <ErpItemListGrid
        columns={COLUMNS}
        rows={rows}
        emptyLabel={filters.query ? '조건에 맞는 ERP 품목이 없습니다.' : '아직 반입한 ERP 품목이 없습니다. 위에서 품목 생성 데이터를 반입해주세요.'}
      />
      <ConsolePagination page={filters.page} pageSize={ERP_ITEMS_PAGE_SIZE} total={page.total} hrefForPage={(next) => erpItemsHref(filters, next)} label="ERP 품목 페이지" />
    </AdminSectionCard>

    <AdminSectionCard
      title="ERP 분류 ↔ 고객 카테고리 연결"
      id="erp-category-mapping"
      summary="ERP 분류마다 고객 카테고리 말단을 하나 연결합니다. 연결은 나중에 바꿀 수 있고, 상품 화면에서 제안된 카테고리도 MD가 바꿀 수 있습니다."
    >
      <ErpCategoryMappingPanel rows={data.erpCategories} categories={categories} categoryErpMappings={data.categoryErpMappings} />
      <p className="text-sm text-muted-foreground"><Link className="text-foreground underline underline-offset-4" href={CATEGORY_PATH}>고객 카테고리</Link>에서 말단을 만들거나 보관합니다.</p>
    </AdminSectionCard>
  </section>;
}
