import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildAdminGoodList,
  normalizeAdminGoodListFilters,
  type AdminGoodListFilters,
} from '@/lib/admin/catalog-list';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { GoodConsole } from './GoodConsole';

const notice = {
  maker: '주식회사 아이콘스',
  origin: '대한민국',
  material: '아크릴',
  size: '80 x 60 x 20mm',
  madeOn: '2026-07',
  asManager: '아이콘스 고객센터',
  asContact: '02-000-0000',
};

function good(overrides: Partial<AdminGoodRecord> & Pick<AdminGoodRecord, 'id' | 'name'>): AdminGoodRecord {
  return {
    discountKind: 'none',
    discountValue: 0,
    discountStartsAt: null,
    discountEndsAt: null,
    discountShowsRate: true,
    kcStatus: 'unknown',
    kcType: null,
    kcNumber: null,
    kcCompany: null,
    minOrderQty: 1,
    maxOrderQty: null,
    maxQtyPerAccount: null,
    adultOnly: false,
    barcode: null,
    archivedAt: null,
    ipId: 'hwasan',
    type: '아크릴',
    price: 22000,
    compareAtPrice: null,
    badge: null,
    stock: 'ok',
    stockQty: 12,
    allowBankTransfer: true,
    bg: null,
    imagePath: null,
    imageUrl: null,
    notice,
    description: null,
    galleryPaths: [],
    galleryUrls: [],
    detailImagePath: null,
    detailImageUrl: null,
    saleState: 'on_sale',
    hiddenAt: null,
    stoppedAt: null,
    saleStartsAt: null,
    saleEndsAt: null,
    saleMode: 'regular',
    preorderShipsAt: null,
    summary: null,
    searchKeywords: [],
    seoTitle: null,
    seoDescription: null,
    imageAlt: null,
    galleryAlts: null,
    supplyPrice: null,
    taxType: 'taxable',
    ...overrides,
  };
}

const ips = [{ id: 'hwasan', title: '화산강림', archivedAt: null }];
const goods = [
  good({ id: 'g100', name: '화산강림 아크릴 스탠드', imageUrl: 'https://cdn.example/g100.webp', compareAtPrice: 26000, badge: 'NEW' }),
  good({ id: 'g101', name: '화산강림 엽서', stock: 'soldout', stockQty: 0, allowBankTransfer: false }),
];

function render(filters: AdminGoodListFilters, missingSelection: string | null = null) {
  return renderToStaticMarkup(
    <GoodConsole
      filters={filters}
      ipOptions={ips}
      list={buildAdminGoodList(goods, ips, filters)}
      missingSelection={missingSelection}
    />,
  );
}

describe('GoodConsole', () => {
  it('renders status chips, the filter panel, rows that link to the editor, and pagination', () => {
    const html = render(normalizeAdminGoodListFilters({}));

    /* 상태 칩 — 0건도 그린다. */
    expect(html).toContain('aria-label="전체 2건"');
    expect(html).toContain('aria-label="품절 1건"');
    expect(html).toContain('aria-label="재고 부족 0건"');
    expect(html).toContain('href="/admin/catalog/goods?tab=soldout"');
    /* 행 → 편집(딥링크). 첫 칸과 이름 둘 다 같은 곳으로 간다. */
    expect(html.match(/href="\/admin\/catalog\/goods\?selected=g100"/g)).toHaveLength(2);
    expect(html).toContain('src="https://cdn.example/g100.webp"');
    expect(html).toContain('₩22,000');
    expect(html).toContain('₩26,000');
    expect(html).toContain('data-good-status="soldout"');
    expect(html).toContain('차단');
    /* 필터 패널은 GET 폼이고 정렬은 링크다. */
    expect(html).toContain('action="/admin/catalog/goods"');
    expect(html).toContain('name="query"');
    expect(html).toContain('name="ip"');
    expect(html).toContain('name="type"');
    expect(html).toContain('name="size"');
    expect(html).toContain('href="/admin/catalog/goods?sort=price&amp;dir=desc"');
    expect(html).toContain('1–2 / 전체 2건');
    expect(html).toContain('href="/admin/catalog/goods?selected=new"');
    expect(html).toContain('표시 열');
    /* 일괄 처리는 다음 슬라이스 — 준비 전에는 체크박스를 그리지 않는다. */
    expect(html).not.toContain('type="checkbox" aria-label="전체 선택"');
  });

  it('keeps the current tab and sort as hidden fields so a search stays inside them', () => {
    const html = render(normalizeAdminGoodListFilters({ tab: 'soldout', sort: 'price', dir: 'desc', query: '엽서' }));

    expect(html).toContain('<input type="hidden" name="tab" value="soldout"/>');
    expect(html).toContain('<input type="hidden" name="sort" value="price"/>');
    expect(html).toContain('<input type="hidden" name="dir" value="desc"/>');
    expect(html).toContain('value="엽서"');
    expect(html).toContain('aria-current="true"');
    /* 현재 정렬 열은 반대 방향 링크를 낸다. */
    expect(html).toContain('href="/admin/catalog/goods?tab=soldout&amp;query=%EC%97%BD%EC%84%9C&amp;sort=price"');
  });

  it('says when nothing matches or when the selected good is gone', () => {
    const empty = render(normalizeAdminGoodListFilters({ query: '없는 굿즈' }));
    const missing = render(normalizeAdminGoodListFilters({}), 'g999');

    expect(empty).toContain('조건에 맞는 굿즈가 없습니다.');
    expect(empty).toContain('0–0 / 전체 0건');
    expect(missing).toContain('g999');
    expect(missing).toContain('찾지 못했습니다');
  });
});
