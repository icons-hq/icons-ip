import Form from 'next/form';
import Link from 'next/link';
import { AdminHelpTip } from '@/components/admin/console/AdminHelpTip';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import type { ConsoleGridColumn } from '@/components/admin/console/ConsoleGrid';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { ErpCategoryMappingPanel } from '@/components/admin/ErpCategoryMappingPanel';
import { ErpItemImportPanel } from '@/components/admin/ErpItemImportPanel';
import { ErpItemListGrid } from '@/components/admin/ErpItemListGrid';
import { ErpItemsWorkspace } from '@/components/admin/ErpItemsWorkspace';
import { ErpLinkedGoodsPanel } from '@/components/admin/ErpLinkedGoodsPanel';
import { ErpItemsImportButton } from './ErpItemsImportButton';
import { CATEGORY_PATH, categoryPath } from '@/lib/admin/category';
import {
  ERP_ITEMS_PAGE_SIZE,
  ERP_ITEMS_PATH,
  ERP_ITEM_SEARCH_QUERY_MAX,
  erpItemsHref,
  formatErpSalePrice,
} from '@/lib/admin/erp-items';
import type { ErpItemsWorkspaceData } from '@/lib/admin/erp-items.server';
import { unlinkedErpCategories } from '@/lib/admin/erp-import-follow-up';
import { ERP_LINKED_GOODS_SECTION_ID } from '@/lib/admin/erp-linked-goods';
import { ERP_ITEMS_HELP } from '@/lib/admin/help/erp-items';
import { kstDay } from '@/lib/admin/kst';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'code', label: 'ERP 코드', width: '140px' },
  { key: 'name', label: 'ERP 품명' },
  { key: 'category', label: 'ERP 분류' },
  { key: 'mapped', label: '고객 카테고리', width: '180px' },
  /* 상품의 판매가와 헷갈리지 않게 ERP에서 온 금액임을 이름에 적는다. */
  { key: 'salePrice', label: 'ERP 판매가', align: 'end', width: '110px' },
  { key: 'barcode', label: '바코드', width: '150px' },
  { key: 'importedAt', label: '최근 올린 날', width: '110px' },
];

/**
 * ERP 품목(1027T-016·1027T-X04·SHEET-042). 상품 관리 권한(catalog.manage)이면 MD도 읽고 반입하고 분류를 연결한다.
 * 플랫폼 관리 권한(platform.manage, `canManagePlatform`)이 있을 때만 품목 삭제와 카테고리 관리의 '카테고리별 ERP 코드' 링크를 보인다
 * (삭제는 서버 액션·RPC도 같은 권한을 따로 확인하고, 그 카드는 카테고리 관리에서 같은 권한일 때만 그려진다).
 */
export function ErpItemsScreen({ data, canManagePlatform = false }: { data: ErpItemsWorkspaceData; canManagePlatform?: boolean }) {
  const canDelete = canManagePlatform;
  const { filters, page, categories } = data;
  const categoryLabel = (id: string | null) => {
    if (!id) return <span className="text-muted-foreground">연결 없음</span>;
    /* 지워진 카테고리는 경로를 알 수 없다. 내부 번호 대신 그렇다고 말한다(화면 규칙 8). */
    const path = categories.some((category) => category.id === id) ? categoryPath(categories, id).join(' > ') : '삭제된 카테고리';
    /* 연결을 저장하면 이 칸이 `연결 없음`에서 긴 경로로 바뀐다. 두 줄이 되면 아래 연결 표가 통째로 밀리므로 한 줄로 자르고 전체 경로는 title로 보여 준다. */
    return <span className="block max-w-[9.5rem] truncate" title={path}>{path}</span>;
  };
  const importOpen = page.total === 0 && !filters.query;
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

  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="erp-items"><ErpItemsWorkspace>
    <AdminPageHeader
      title="ERP 품목"
      description="상품 옵션에서 고르는 ERP 품목을 여기에 올립니다. ERP 프로그램과 자동으로 이어져 있지 않으니 신제품이 생기면 ERP에서 받은 품목 표를 다시 올려주세요."
      actions={<ErpItemsImportButton defaultOpen={importOpen} />}
    />

    <ErpItemImportPanel defaultOpen={importOpen} unlinkedErpCategories={unlinkedErpCategories(data.erpCategories)} />

    {/* 1027T-X04: 붙여넣은 값이 연결 상품과 다르면 미리보기 뒤 고른 행만 판매가·바코드를 반영한다.
        '연결 상품'이라는 말과 판매가를 맞추는 기준은 화면만으로 알 수 없어 "?" 하나에 모은다(화면 규칙 3). */}
    <AdminSectionCard
      title="연결 상품 반영"
      id={ERP_LINKED_GOODS_SECTION_ID}
      summary={<span className="inline-flex flex-wrap items-center gap-1">올린 ERP 판매가·바코드가 상품과 다른 줄을 찾아, 고른 줄만 상품에 반영합니다.<AdminHelpTip help={ERP_ITEMS_HELP.linkedGoods} label="연결 상품 반영" /></span>}
    >
      <ErpLinkedGoodsPanel />
    </AdminSectionCard>

    {/* 반입 결과 목록을 먼저 보이고 분류 연결(설정)은 그 아래에 둔다. */}
    <AdminSectionCard
      title="올린 품목"
      id="erp-item-list"
      summary={`총 ${page.total.toLocaleString('ko-KR')}건 · ERP 코드 순${canDelete ? ' · 왼쪽 칸을 체크하면 삭제 버튼이 나타납니다.' : ''}`}
    >
      {/* next/form: 검색도 페이지 넘김처럼 화면을 다시 불러오지 않아, 아래 연결 표에서 고르던 값이 남는다. */}
      <Form action={ERP_ITEMS_PATH} className="flex flex-wrap items-center gap-2" prefetch={false} role="search">
        <label className="text-sm font-medium whitespace-nowrap" htmlFor="erp-item-query">ERP 코드·품명 검색</label>
        <Input className="w-full sm:w-80" id="erp-item-query" name="q" type="search" defaultValue={filters.query} maxLength={ERP_ITEM_SEARCH_QUERY_MAX} placeholder="예: 000123, 아크릴 키링" />
        <Button variant="soft" type="submit">검색</Button>
        {filters.query ? <Link className="text-sm underline underline-offset-4" href={ERP_ITEMS_PATH}>전체 품목 보기</Link> : null}
      </Form>
      <ErpItemListGrid
        canDelete={canDelete}
        columns={COLUMNS}
        rows={rows}
        emptyLabel={filters.query ? '조건에 맞는 ERP 품목이 없습니다.' : '아직 올린 ERP 품목이 없습니다. 위의 품목 올리기에서 ERP의 품목 생성 데이터를 붙여넣거나 파일로 올려주세요.'}
      />
      <ConsolePagination page={filters.page} pageSize={ERP_ITEMS_PAGE_SIZE} total={page.total} hrefForPage={(next) => erpItemsHref(filters, next)} label="ERP 품목 페이지" />
    </AdminSectionCard>

    <AdminSectionCard
      title="ERP 분류 ↔ 고객 카테고리 연결"
      id="erp-category-mapping"
      summary="상품 옵션에서 ERP 품목을 고르면 여기서 연결한 카테고리를 추천합니다. 이미 저장한 상품의 카테고리는 바뀌지 않습니다."
    >
      <ErpCategoryMappingPanel rows={data.erpCategories} categories={categories} categoryErpMappings={data.categoryErpMappings} />
      {/* 연결할 카테고리가 없을 때 갈 곳과, 자동 연결이 보는 값을 적는 곳. 그 카드는 플랫폼 관리 권한에만 보이므로 없는 사람은 그곳으로 보내지 않는다. */}
      <p className="text-sm text-muted-foreground">카테고리는 <Link className="text-foreground underline underline-offset-4" href={CATEGORY_PATH}>카테고리 관리</Link>에서 만듭니다. {canManagePlatform
        ? <>자동 연결에 쓰는 ERP 코드·품명은 카테고리 관리의 <Link className="text-foreground underline underline-offset-4" href={`${CATEGORY_PATH}#category-erp-mapping`}>카테고리별 ERP 코드</Link>에 적습니다.</>
        : '자동 연결에 쓰는 카테고리별 ERP 코드는 계정 주매니저·통합 매니저가 적습니다.'}</p>
    </AdminSectionCard>
  </ErpItemsWorkspace></section>;
}
