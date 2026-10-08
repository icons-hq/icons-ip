import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
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
    if (!id) return <span className="admin-erp-items__muted">연결 없음</span>;
    return categories.some((category) => category.id === id) ? categoryPath(categories, id).join(' > ') : id;
  };
  const rows = page.items.map((item) => ({
    id: item.code,
    selectLabel: `${item.code} ${item.name} 선택`,
    cells: [
      <span className="admin-erp-items__code" key="code">{item.code}</span>,
      item.name,
      item.category ?? <span className="admin-erp-items__muted">없음</span>,
      categoryLabel(item.mappedCategoryId),
      formatErpSalePrice(item.salePrice),
      item.barcode ? <span className="admin-erp-items__code" key="barcode">{item.barcode}</span> : <span className="admin-erp-items__muted">없음</span>,
      <time dateTime={item.importedAt} key="importedAt">{kstDay(new Date(item.importedAt))}</time>,
    ],
  }));

  return <section className="wc-admin-kit wc-admin-kit__screen admin-erp-items">
    <AdminPageHeader
      title="ERP 품목"
      description="ERP '품목 생성' 데이터(품번·품명·카테고리, 있으면 판매가·바코드)를 반입해 두면, 상품 옵션에 ERP 품명을 입력할 때 ERP 코드·바코드·고객 카테고리·판매가를 제안합니다. ERP와 자동으로 연동되지 않으니 신제품이 생기면 다시 반입해주세요."
    />

    <ErpItemImportPanel />

    <AdminSectionCard
      title="ERP 분류 ↔ 고객 카테고리 연결"
      id="erp-category-mapping"
      summary="ERP 분류마다 고객 카테고리 말단을 하나 연결합니다. 연결은 나중에 바꿀 수 있고, 상품 화면에서 제안된 카테고리도 MD가 바꿀 수 있습니다."
    >
      <ErpCategoryMappingPanel rows={data.erpCategories} categories={categories} categoryErpMappings={data.categoryErpMappings} />
      <p className="wc-admin-kit__hint"><Link href={CATEGORY_PATH}>고객 카테고리</Link>에서 말단을 만들거나 보관합니다.</p>
    </AdminSectionCard>

    <AdminSectionCard
      title="반입된 품목"
      id="erp-item-list"
      summary={`총 ${page.total.toLocaleString('ko-KR')}건 · ERP 코드 순. 잘못 반입했거나 단종된 품목은 골라서 지웁니다.`}
    >
      <form action={ERP_ITEMS_PATH} className="admin-erp-items__search" role="search">
        <label htmlFor="erp-item-query">ERP 코드·품명 검색</label>
        <div>
          <input id="erp-item-query" name="q" type="search" defaultValue={filters.query} maxLength={ERP_ITEM_SEARCH_QUERY_MAX} placeholder="예: 000123, 아크릴 키링" />
          <button className="wc-admin-kit__button" type="submit">검색</button>
          {filters.query ? <Link href={ERP_ITEMS_PATH}>전체 품목 보기</Link> : null}
        </div>
      </form>
      <ErpItemListGrid
        columns={COLUMNS}
        rows={rows}
        emptyLabel={filters.query ? '조건에 맞는 ERP 품목이 없습니다.' : '아직 반입한 ERP 품목이 없습니다. 위에서 품목 생성 데이터를 반입해주세요.'}
      />
      <ConsolePagination page={filters.page} pageSize={ERP_ITEMS_PAGE_SIZE} total={page.total} hrefForPage={(next) => erpItemsHref(filters, next)} label="ERP 품목 페이지" />
    </AdminSectionCard>
  </section>;
}
