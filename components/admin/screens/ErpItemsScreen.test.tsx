import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { ErpItemsWorkspaceData } from '@/lib/admin/erp-items.server';
import { ErpItemsScreen } from './ErpItemsScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({
  importErpItemsAction: vi.fn(), readErpItemFileAction: vi.fn(), setErpCategoryMappingAction: vi.fn(), searchErpItemsAction: vi.fn(), deleteErpItemsAction: vi.fn(),
  previewErpLinkedGoodsAction: vi.fn(), commitErpLinkedGoodsAction: vi.fn(),
}));

const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
  id, code: id, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null,
  updatedAt: '2026-10-07T00:00:00Z', childCount: 0, assignedGoodCount: 0, ...extra,
});
const KEYRING = '00000000-0000-4000-8000-000000071111';
const PHOTO = '00000000-0000-4000-8000-000000071112';
const ARCHIVED = '00000000-0000-4000-8000-000000071113';

function data(overrides: Partial<ErpItemsWorkspaceData> = {}): ErpItemsWorkspaceData {
  return {
    filters: { query: '', page: 1 },
    page: { total: 51, items: [
      { code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0088012345678', mappedCategoryId: KEYRING, importedAt: '2026-10-07T03:00:00Z', updatedAt: '2026-10-07T03:00:00Z' },
      { code: 'K-2', name: '키링 거치대', category: null, salePrice: null, barcode: null, mappedCategoryId: null, importedAt: '2026-10-06T16:30:00Z', updatedAt: '2026-10-06T16:30:00Z' },
    ] },
    erpCategories: [
      { erpCategory: '문구 > 키링', itemCount: 1, categoryId: KEYRING, updatedAt: '2026-10-07T03:00:00Z', fallbackCategoryId: null },
      { erpCategory: '문구 > 포토카드', itemCount: 3, categoryId: null, updatedAt: null, fallbackCategoryId: null },
      { erpCategory: '단종 분류', itemCount: 0, categoryId: ARCHIVED, updatedAt: '2026-10-01T00:00:00Z', fallbackCategoryId: null },
    ],
    categories: [
      node('00000000-0000-4000-8000-000000071110', '문구', null, { childCount: 2 }),
      node(KEYRING, '키링', '00000000-0000-4000-8000-000000071110'),
      node(PHOTO, '포토카드', '00000000-0000-4000-8000-000000071110'),
      node(ARCHIVED, '단종', '00000000-0000-4000-8000-000000071110', { archivedAt: '2026-10-01T00:00:00Z' }),
    ],
    categoryErpMappings: [],
    ...overrides,
  };
}

describe('ERP 품목 화면', () => {
  it('반입·분류 연결·목록을 한 화면에 두고 MD가 쓰는 용어로 안내한다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(html).toContain('ERP 품목');
    expect(html).toContain('ERP와 자동으로 연동되지 않으니 신제품이 생기면 다시 반입해주세요.');
    expect(html).toContain('id="erp-item-paste"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".xlsx,.csv');
    expect(html).toContain('붙여넣은 표 확인');
    expect(html).toContain('ERP 분류 ↔ 고객 카테고리 연결');
    expect(html).toContain('반입된 품목');
    expect(html).not.toMatch(/슬롯|가챠|충전/);
  });

  /* 2026-11-10 사람 눈 시험: 두 화면의 ERP 연결 이름이 비슷해 어디서 해야 하는지 헷갈렸다. */
  it('이 연결이 쓰이는 곳과 카테고리 관리에서 하는 일을 구분해 알려 준다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(html).toContain('상품 옵션에서 ERP 품목을 고를 때 연결된 카테고리를 제안하는 데만 씁니다.');
    expect(html).toContain('href="/admin/catalog/categories#category-erp-mapping"');
    expect(html).toContain('카테고리마다 ERP 코드·품명을 적어 CSV로 내보내는 일도');
  });

  it('품목 반입이 접혀 있으면 화면 머리의 주 행동 버튼이 펼치는 길이고, 펼쳐 있으면 외곽선으로 물러난다', () => {
    const closed = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(closed).toMatch(/data-admin-kit="page-header"[\s\S]*?<button[^>]*bg-primary[^>]*>(?:<svg[\s\S]*?<\/svg>)?품목 반입<\/button>/);
    expect(closed).toMatch(/<details(?![^>]*open)[^>]*id="erp-item-import"/);
    const empty = renderToStaticMarkup(<ErpItemsScreen data={data({ page: { total: 0, items: [] } })} />);
    expect(empty).toMatch(/<details[^>]*id="erp-item-import"[^>]*open=""/);
    expect(empty).not.toMatch(/<button[^>]*bg-primary[^>]*>(?:<svg[\s\S]*?<\/svg>)?품목 반입<\/button>/);
  });

  it('ERP 분류마다 활성 말단 경로를 고르고, 같은 경로 말단이 있으면 한 번에 연결하게 한다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(html).toContain('ERP 분류 3개 중 2개 연결됨');
    expect(html).toContain('aria-label="문구 &gt; 포토카드 고객 카테고리"');
    expect(html).toContain('같은 경로로 연결 · 문구 &gt; 포토카드');
    expect(html).toMatch(/aria-label="문구 &gt; 키링 고객 카테고리"[^>]*><span[^>]*>문구 &gt; 키링<\/span>/);
    expect(html).toContain('문구 &gt; 단종 · 지금은 연결할 수 없음');
    expect(html).toMatch(/aria-label="문구 &gt; 포토카드 고객 카테고리"[^>]*><span[^>]*>연결 안 함<\/span>/);
  });

  /* 2026-11-10 운영 실측: 고객 카테고리 말단 약 300개 × ERP 분류 200행이 select마다 그려져 option 59,800개·문서 6.97MB·첫 화면 최대 4.1초였다. */
  describe('말단 300개·ERP 분류 257행의 첫 화면', () => {
    const PARENT_ID = '00000000-0000-4000-8000-000000071110';
    const leafId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const leaves = (count: number) => [
      node(PARENT_ID, '문구', null, { childCount: count }),
      ...Array.from({ length: count }, (_, index) => node(leafId(index), `말단 ${index}`, PARENT_ID)),
    ];
    const rows = Array.from({ length: 257 }, (_, index) => ({
      erpCategory: index % 2 ? `문구 > 말단 ${index % 300}` : `ERP 분류 ${index}`,
      itemCount: index + 1,
      categoryId: index % 3 === 0 ? leafId(index % 3) : null,
      updatedAt: null,
      fallbackCategoryId: index % 3 === 1 ? leafId(index) : null,
    }));
    const elements = (html: string) => html.match(/<[a-z][^>]*>/g)?.length ?? 0;
    const render = (leafCount: number, erpCategories = rows) => renderToStaticMarkup(<ErpItemsScreen data={data({ erpCategories, categories: leaves(leafCount) })} />);

    it('DOM은 6,000개 아래이고 닫힌 칸에는 선택지가 없다', () => {
      const html = render(300);
      expect(elements(html)).toBeLessThan(6_000);
      expect(html).not.toContain('<option value="00000000-0000-4000-8000-0000000');
      expect(html.split('말단 299').length - 1).toBeLessThanOrEqual(2);
    });

    it('카테고리가 늘어도 칸의 DOM은 늘지 않는다(행×카테고리가 아니다)', () => {
      /* 제안 버튼이 말단 수에 따라 달라지지 않게 어떤 말단과도 맞지 않는 분류로 잰다. */
      const unmatched = rows.map((row, index) => ({ ...row, erpCategory: `ERP 분류 ${index}`, categoryId: null, fallbackCategoryId: null }));
      expect(elements(render(300, unmatched))).toBe(elements(render(3, unmatched)));
    });
  });

  it('목록은 선행 0을 그대로 보이고, 연결된 고객 카테고리 경로·판매가·KST 반입일을 보여 준다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} canDelete />);
    expect(html).toContain('>000123<');
    expect(html).toContain('>0088012345678<');
    expect(html).toContain('12,000원');
    expect(html).toContain('연결 없음');
    // 저장하면 이 칸이 긴 경로로 바뀐다. 한 줄로 잘라 표 높이가 그대로이고, 전체 경로는 title로 본다(사람 눈 시험 2026-11-10: 아래 표가 176px 밀렸다).
    expect(html).toMatch(/<span class="block max-w-\[9\.5rem\] truncate" title="문구 &gt; 키링">문구 &gt; 키링<\/span>/);
    expect(html).toContain('<col style="width:180px"/>');
    expect(html).toContain('dateTime="2026-10-06T16:30:00Z">2026-10-07</time>');
    expect(html).toContain('총 51건');
    expect(html).toContain('aria-label="000123 아크릴 키링 선택"');
    expect(html).toContain('aria-label="전체 선택"');
    // 체크박스 label은 칸을 덮는 절대 배치라 내용 폭이 없다 — 좁은 화면에서 칸이 0px로 접히지 않게 머리칸 최소 폭을 준다.
    expect(html).toMatch(/<div class="[^"]*\[&amp;_thead_th:first-child\]:min-w-10[^"]*" data-console-grid="">/);
    expect(html).toContain('action="/admin/catalog/erp-items"');
    // 품목 검색은 GET 폼 제출이다(kit 버튼의 기본 type은 button). next/form이라 화면을 다시 불러오지 않아 연결 표의 입력이 남는다.
    expect(html).toMatch(/<button(?=[^>]*type="submit")[^>]*>검색<\/button>/);
    expect(html).toContain('href="/admin/catalog/erp-items?page=2"');
  });

  it('품목 반입은 접어 두어 매일 보는 표가 첫 화면에 들어오고, 반입한 품목이 없을 때만 펼친다', () => {
    const fold = /<details[^>]*id="erp-item-import"[^>]*>/;
    expect(fold.exec(renderToStaticMarkup(<ErpItemsScreen data={data()} />))?.[0]).not.toContain('open=');
    expect(fold.exec(renderToStaticMarkup(<ErpItemsScreen data={data({ page: { total: 0, items: [] } })} />))?.[0]).toContain('open=');
    // 찾는 품목이 없다고 반입 칸을 열지는 않는다.
    expect(fold.exec(renderToStaticMarkup(<ErpItemsScreen data={data({ filters: { query: '없는 품목', page: 1 }, page: { total: 0, items: [] } })} />))?.[0]).not.toContain('open=');
    // 삭제 버튼은 고른 뒤에 나타나므로 그 방법을 말한다.
    expect(renderToStaticMarkup(<ErpItemsScreen data={data()} canDelete />)).toContain('체크하면 삭제 버튼이 나타납니다');
  });

  /* 1027T-016: MD(catalog.manage)는 읽기·반입·분류 연결을 하고, 품목 삭제(platform.manage)는 보지 않는다. */
  it('삭제 권한이 없으면 목록의 선택 칸과 삭제 안내를 그리지 않고, 반입·분류 연결은 그대로 둔다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(html).not.toContain('체크하면 삭제 버튼이 나타납니다');
    expect(html).not.toContain('aria-label="000123 아크릴 키링 선택"');
    expect(html).not.toContain('선택 삭제');
    expect(html).toContain('id="erp-item-paste"');
    expect(html).toContain('aria-label="문구 &gt; 포토카드 고객 카테고리"');
  });

  /* 1027T-X04: 반입한 ERP 판매가·바코드를 연결 상품과 비교해 확인한 행만 반영하는 구역을 반입 아래에 둔다. */
  it('연결 상품 반영 구역은 반입 다음, 품목 목록 앞에 있고 무엇을 바꾸는지 먼저 알린다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    const order = ['id="erp-item-import"', 'id="erp-linked-goods"', 'id="erp-item-list"', 'id="erp-category-mapping"'].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(html).toContain('연결 상품 반영');
    expect(html).toContain('할인 중인 상품(기간 할인 진행·예정, 즉시할인)은 건너뜁니다.');
    expect(html).toContain('ERP에 바코드가 없으면 상품 바코드를 지우지 않습니다.');
    expect(html).toMatch(/<button[^>]*>전체 품목과 비교<\/button>/);
  });

  it('빈 목록과 분류 없음 상태를 안내한다', () => {
    const empty = renderToStaticMarkup(<ErpItemsScreen data={data({ page: { total: 0, items: [] }, erpCategories: [] })} />);
    expect(empty).toContain('아직 반입한 ERP 품목이 없습니다. 위에서 품목 생성 데이터를 반입해주세요.');
    expect(empty).toContain('반입한 품목에 ERP 분류가 없습니다. 반입할 때 ERP 분류 열을 골라주세요.');
    const searched = renderToStaticMarkup(<ErpItemsScreen data={data({ filters: { query: '없는 품목', page: 1 }, page: { total: 0, items: [] } })} />);
    expect(searched).toContain('조건에 맞는 ERP 품목이 없습니다.');
    expect(searched).toContain('전체 품목 보기');
  });
});
