import { describe, expect, it } from 'vitest';
import type { AdminCategoryNode } from './category';
import {
  ERP_ITEMS_PATH,
  conflictingCategoryErpMapping,
  erpCategoryFallbackBasis,
  erpItemRejectReasonLabel,
  erpItemsHref,
  formatErpSalePrice,
  normalizeErpItemFilters,
  parseErpCategoryMappingRow,
  parseErpItemListPage,
  parseErpItemMatch,
  suggestErpCategoryTarget,
} from './erp-items';

const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
  id, code: id, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null,
  updatedAt: '2026-10-07T00:00:00Z', childCount: 0, assignedGoodCount: 0, ...extra,
});

const categories = [
  node('stationery', '문구', null, { childCount: 2 }),
  node('keyring', '키링', 'stationery'),
  node('photo', '포토카드', 'stationery'),
  node('living', '리빙', null, { childCount: 2 }),
  node('living-keyring', '키링', 'living'),
  node('archived', '보관 분류', 'living', { archivedAt: '2026-10-01T00:00:00Z' }),
];

describe('ERP 품목 RPC 행 해석', () => {
  it('제안 행을 계약 타입으로 바꾸고 형식이 다른 행은 버린다', () => {
    expect(parseErpItemMatch({ code: '000123', name: '아크릴 키링', category: '문구 > 키링', sale_price: 12000, barcode: '0088', mapped_category_id: 'keyring' }))
      .toEqual({ code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0088', mappedCategoryId: 'keyring' });
    expect(parseErpItemMatch({ code: 'A', name: 'B', category: null, sale_price: null, barcode: null, mapped_category_id: null }))
      .toMatchObject({ category: null, salePrice: null });
    expect(parseErpItemMatch({ code: 'A', name: 'B', category: null, sale_price: -1, barcode: null, mapped_category_id: null })).toBeNull();
    expect(parseErpItemMatch({ code: '', name: 'B', category: null, sale_price: null, barcode: null, mapped_category_id: null })).toBeNull();
    expect(parseErpItemMatch(null)).toBeNull();
  });

  it('목록 페이지와 분류 연결 행을 검증한다', () => {
    const item = { code: 'A', name: 'B', category: null, sale_price: null, barcode: null, mapped_category_id: null, imported_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' };
    expect(parseErpItemListPage({ total: 3, items: [item] })).toMatchObject({ total: 3, items: [{ code: 'A', importedAt: '2026-10-07T00:00:00Z' }] });
    expect(parseErpItemListPage({ total: 0, items: [item] })).toBeNull();
    expect(parseErpItemListPage({ total: 1, items: [{ ...item, imported_at: null }] })).toBeNull();
    expect(parseErpCategoryMappingRow({ erp_category: '문구 > 키링', item_count: '2', category_id: null, updated_at: null, fallback_category_id: 'keyring' }))
      .toEqual({ erpCategory: '문구 > 키링', itemCount: 2, categoryId: null, updatedAt: null, fallbackCategoryId: 'keyring' });
    expect(parseErpCategoryMappingRow({ erp_category: '', item_count: 1, category_id: null, updated_at: null, fallback_category_id: null })).toBeNull();
    expect(parseErpCategoryMappingRow({ erp_category: '문구', item_count: 1, category_id: null, updated_at: null })).toBeNull();
  });

  it('거부 사유를 안내 문구로 바꾸고 모르는 사유도 빈칸으로 두지 않는다', () => {
    expect(erpItemRejectReasonLabel('missing_code')).toBe('ERP 코드(품번)가 비어 있습니다.');
    expect(erpItemRejectReasonLabel('weird')).toBe('반입하지 못한 행입니다. 값을 확인해주세요.');
    expect(formatErpSalePrice(12000)).toBe('12,000원');
    expect(formatErpSalePrice(null)).toBe('없음');
  });
});

describe('목록 주소', () => {
  it('검색어와 페이지를 정리해 주소를 만든다', () => {
    const filters = normalizeErpItemFilters({ q: '  키링 ', page: '3' });
    expect(filters).toEqual({ query: '키링', page: 3 });
    expect(erpItemsHref(filters)).toBe(`${ERP_ITEMS_PATH}?q=%ED%82%A4%EB%A7%81&page=3`);
    expect(erpItemsHref({ query: '', page: 1 })).toBe(ERP_ITEMS_PATH);
    expect(normalizeErpItemFilters({ page: '-5' }).page).toBe(1);
  });
});

describe('ERP 분류 → 고객 카테고리 제안', () => {
  it('경로가 같은 활성 말단을 제안한다', () => {
    expect(suggestErpCategoryTarget('문구 > 키링', categories)).toEqual({ categoryId: 'keyring', basis: 'same_path', label: '문구 > 키링' });
    expect(suggestErpCategoryTarget('문구>포토 카드', categories)).toMatchObject({ categoryId: 'photo', basis: 'same_path' });
  });

  /* R9(10/27 회의): ERP 분류는 전체 경로로만 맞춘다. 말단 이름만 같은 다른 대분류('쿠션')로 잘못 이어지면 안 되고,
     '메모/수첩'처럼 이름에 든 '/'는 구분자가 아니다. */
  it('말단 이름만 같으면 제안하지 않고, 이름의 /로 경로를 자르지 않는다', () => {
    const slashTree = [
      node('st', '문구', null, { childCount: 1 }),
      node('memo', '메모/수첩', 'st', { childCount: 1 }),
      node('sticky', '점착메모지', 'memo', { depth: 3 }),
      node('living', '리빙', null, { childCount: 1 }),
      node('cushion', '쿠션', 'living'),
    ];
    expect(suggestErpCategoryTarget('문구>메모/수첩>점착메모지', slashTree)).toMatchObject({ categoryId: 'sticky', basis: 'same_path' });
    expect(suggestErpCategoryTarget('문구 > 메모/수첩 > 점착 메모지', slashTree)).toMatchObject({ categoryId: 'sticky', basis: 'same_path' });
    expect(suggestErpCategoryTarget('문구/메모/수첩/점착메모지', slashTree)).toBeNull();
    expect(suggestErpCategoryTarget('쿠션', slashTree)).toBeNull();
    expect(suggestErpCategoryTarget('패션>쿠션', slashTree)).toBeNull();
    expect(suggestErpCategoryTarget('포토 카드', categories)).toBeNull();
    expect(suggestErpCategoryTarget('키링', categories)).toBeNull();
    expect(suggestErpCategoryTarget('보관 분류', categories)).toBeNull();
    expect(suggestErpCategoryTarget('  ', categories)).toBeNull();
  });

  it('DB가 제안한 말단이 같은 경로인지 정본 매핑인지 구분한다', () => {
    expect(erpCategoryFallbackBasis('문구 > 키링', 'keyring', categories)).toBe('same_path');
    expect(erpCategoryFallbackBasis('KR-01', 'keyring', categories)).toBe('erp_mapping');
  });

  it('고객 카테고리에 저장된 ERP 분류 매핑을 가장 먼저 본다', () => {
    expect(suggestErpCategoryTarget('KR-01', categories, [{ categoryId: 'living-keyring', erpCode: 'KR-01', erpName: '키링류' }]))
      .toEqual({ categoryId: 'living-keyring', basis: 'erp_mapping', label: '리빙 > 키링' });
    expect(suggestErpCategoryTarget('키링류', categories, [{ categoryId: 'archived', erpCode: 'X', erpName: '키링류' }])).toBeNull();
  });
});

describe('고른 고객 카테고리의 정본 ERP 분류 매핑과 비교', () => {
  const mappings = [{ categoryId: 'keyring', erpCode: 'KR-01', erpName: '문구  키링' }];

  it('정본 매핑의 이름이나 코드가 ERP 분류와 같으면 경고하지 않는다', () => {
    expect(conflictingCategoryErpMapping('문구 키링', 'keyring', mappings)).toBeNull();
    expect(conflictingCategoryErpMapping(' KR-01 ', 'keyring', mappings)).toBeNull();
    expect(conflictingCategoryErpMapping('키링', 'photo', mappings)).toBeNull();
  });

  it('정본 매핑이 다르면 그 매핑을 돌려준다(대소문자도 다르게 본다)', () => {
    expect(conflictingCategoryErpMapping('문구 > 포토카드', 'keyring', mappings)).toEqual(mappings[0]);
    expect(conflictingCategoryErpMapping('kr-01', 'keyring', mappings)).toEqual(mappings[0]);
  });
});
