import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import type { ErpItemsWorkspaceData } from '@/lib/admin/erp-items.server';
import { ErpItemsScreen } from './ErpItemsScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({
  importErpItemsAction: vi.fn(), readErpItemFileAction: vi.fn(), setErpCategoryMappingAction: vi.fn(), searchErpItemsAction: vi.fn(),
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

  it('ERP 분류마다 활성 말단 경로를 고르고, 같은 이름 말단이 있으면 한 번에 연결하게 한다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(html).toContain('ERP 분류 3개 중 2개 연결됨');
    expect(html).toContain('aria-label="문구 &gt; 포토카드 고객 카테고리"');
    expect(html).toContain('같은 이름으로 연결 · 문구 &gt; 포토카드');
    expect(html).toContain(`<option value="${KEYRING}" selected="">문구 &gt; 키링</option>`);
    expect(html).toContain('문구 &gt; 단종 · 지금은 연결할 수 없음');
    expect(html).not.toContain(`<option value="${ARCHIVED}">문구 &gt; 단종</option>`);
  });

  it('목록은 선행 0을 그대로 보이고, 연결된 고객 카테고리 경로·판매가·KST 반입일을 보여 준다', () => {
    const html = renderToStaticMarkup(<ErpItemsScreen data={data()} />);
    expect(html).toContain('>000123<');
    expect(html).toContain('>0088012345678<');
    expect(html).toContain('12,000원');
    expect(html).toContain('연결 없음');
    expect(html).toContain('dateTime="2026-10-06T16:30:00Z">2026-10-07</time>');
    expect(html).toContain('총 51건');
    expect(html).toContain('action="/admin/catalog/erp-items"');
    expect(html).toContain('href="/admin/catalog/erp-items?page=2"');
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
