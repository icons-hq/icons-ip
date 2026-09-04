import { describe, expect, it } from 'vitest';
import {
  adminCategoryHref,
  buildCategoryTree,
  categoryParentOptions,
  flattenCategoryTree,
  isPurchasableSaleState,
  normalizeAdminCategoryFilters,
  normalizeAdminCategoryForm,
  normalizeGoodPricingForm,
  normalizeGoodSaleWindowForm,
  normalizeGoodSearchSeoForm,
  type AdminCategory,
} from './categories';

function category(overrides: Partial<AdminCategory> & Pick<AdminCategory, 'id' | 'path' | 'depth'>): AdminCategory {
  return {
    kind: 'catalog',
    parentId: null,
    name: overrides.id,
    description: null,
    position: 0,
    status: 'active',
    isInternal: false,
    displayMode: 'manual',
    autoSortKey: 'newest',
    soldoutLast: true,
    includeDescendants: true,
    heroImagePath: null,
    seoTitle: null,
    seoDescription: null,
    archivedAt: null,
    goodsCount: 0,
    descendantGoodsCount: 0,
    ...overrides,
  };
}

const tree: AdminCategory[] = [
  category({ id: 'goods', path: '/goods/', depth: 1, position: 1 }),
  category({ id: 'acrylic', path: '/goods/acrylic/', depth: 2, parentId: 'goods', position: 0 }),
  category({ id: 'stand', path: '/goods/acrylic/stand/', depth: 3, parentId: 'acrylic' }),
  category({ id: 'plush', path: '/plush/', depth: 1, position: 0 }),
  category({ id: 'gift', path: '/gift/', depth: 1, position: 2, kind: 'collection' }),
];

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('분류 트리', () => {
  it('평면 목록을 순서대로 접고 편다', () => {
    const roots = buildCategoryTree(tree);
    expect(roots.map((node) => node.id)).toEqual(['plush', 'goods', 'gift']);
    expect(flattenCategoryTree(roots).map((node) => node.id)).toEqual(['plush', 'goods', 'acrylic', 'stand', 'gift']);
    expect(roots[1].children[0].children[0].id).toBe('stand');
  });

  it('상위 분류 선택지에서 자기 자신·자손·기획전·4단 항목을 뺀다', () => {
    const deep = [...tree, category({ id: 'mini', path: '/goods/acrylic/stand/mini/', depth: 4, parentId: 'stand' })];
    expect(categoryParentOptions(deep, 'acrylic').map((entry) => entry.id)).toEqual(['goods', 'plush']);
    /* 새 분류(selfId 없음)는 자기 자손 제한이 없고 깊이만 본다. */
    expect(categoryParentOptions(deep, null).map((entry) => entry.id)).toEqual(['goods', 'acrylic', 'stand', 'plush']);
  });
});

describe('URL 계약', () => {
  it('선택·부모·보관 플래그를 좁히고 기본값은 URL에서 뺀다', () => {
    const filters = normalizeAdminCategoryFilters({ selected: 'acrylic', parent: 'BAD ID', archived: '1' });
    expect(filters).toEqual({ selected: 'acrylic', parent: null, archived: true });
    expect(adminCategoryHref(filters)).toBe('/admin/catalog/categories?selected=acrylic&archived=1');
    expect(adminCategoryHref(filters, { selected: null, archived: false })).toBe('/admin/catalog/categories');
    expect(normalizeAdminCategoryFilters({ selected: 'new' }).selected).toBe('new');
  });
});

describe('폼 정규화', () => {
  it('분류 폼 — 코드 규칙·기획전 평면·길이 상한을 본다', () => {
    const ok = normalizeAdminCategoryForm(form({
      id: 'Acrylic-Stand', name: '아크릴 스탠드', kind: 'catalog', parentId: 'goods',
      status: 'active', displayMode: 'manual', autoSortKey: 'newest', soldoutLast: 'on', includeDescendants: 'on',
    }));
    expect(ok).toMatchObject({ ok: true, value: { id: 'acrylic-stand', parentId: 'goods', soldoutLast: true, includeDescendants: true, isInternal: false } });

    const flat = normalizeAdminCategoryForm(form({ id: 'gift', name: '기획전', kind: 'collection', parentId: 'goods' }));
    expect(flat.ok).toBe(false);
    if (!flat.ok) expect(flat.errors.parentId).toBeTruthy();

    const bad = normalizeAdminCategoryForm(form({ id: 'A', name: '', kind: 'catalog' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['id', 'name']);
  });

  it('판매 기간 폼 — 창 순서·선주문 출고일을 본다', () => {
    const ok = normalizeGoodSaleWindowForm(form({
      goodId: 'g9', startsAt: '2026-10-01T09:00', endsAt: '2026-10-31T23:59', saleMode: 'preorder', preorderShipsAt: '2026-11-05',
    }));
    expect(ok).toEqual({ ok: true, value: { goodId: 'g9', startsAt: '2026-10-01T09:00', endsAt: '2026-10-31T23:59', saleMode: 'preorder', preorderShipsAt: '2026-11-05' } });

    const inverted = normalizeGoodSaleWindowForm(form({ goodId: 'g9', startsAt: '2026-10-31T00:00', endsAt: '2026-10-01T00:00' }));
    expect(inverted.ok).toBe(false);
    const missingShip = normalizeGoodSaleWindowForm(form({ goodId: 'g9', saleMode: 'preorder' }));
    expect(missingShip.ok).toBe(false);
    /* 일반 판매로 되돌리면 출고 예정일은 버린다. */
    const regular = normalizeGoodSaleWindowForm(form({ goodId: 'g9', saleMode: 'regular', preorderShipsAt: '2026-11-05' }));
    expect(regular).toMatchObject({ ok: true, value: { preorderShipsAt: null, startsAt: null, endsAt: null } });
  });

  it('검색·SEO 폼 — 검색어를 정리하고 상한을 본다', () => {
    const ok = normalizeGoodSearchSeoForm(form({
      goodId: 'g9', summary: '한 줄', keywords: ' Ryan , ryan\n키링 ,, ', seoTitle: '제목', imageAlt: '설명',
    }));
    expect(ok).toMatchObject({ ok: true, value: { keywords: ['ryan', '키링'], summary: '한 줄', imageAlt: '설명' } });

    const tooMany = normalizeGoodSearchSeoForm(form({
      goodId: 'g9', keywords: Array.from({ length: 51 }, (_, index) => `k${index}`).join(','),
    }));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.keywords).toBeTruthy();
  });

  it('공급가 폼 — 정수와 과세 구분을 본다', () => {
    expect(normalizeGoodPricingForm(form({ goodId: 'g9', supplyPrice: '8000', taxType: 'exempt' })))
      .toEqual({ ok: true, value: { goodId: 'g9', supplyPrice: 8000, taxType: 'exempt' } });
    expect(normalizeGoodPricingForm(form({ goodId: 'g9', supplyPrice: '' })))
      .toEqual({ ok: true, value: { goodId: 'g9', supplyPrice: null, taxType: 'taxable' } });
    expect(normalizeGoodPricingForm(form({ goodId: 'g9', supplyPrice: '-1' })).ok).toBe(false);
    expect(normalizeGoodPricingForm(form({ goodId: 'g9', taxType: 'nope' })).ok).toBe(false);
  });
});

describe('판매 상태', () => {
  it('구매 가능한 상태는 판매중과 선주문뿐이다', () => {
    expect(isPurchasableSaleState('on_sale')).toBe(true);
    expect(isPurchasableSaleState('preorder')).toBe(true);
    for (const state of ['soldout', 'scheduled', 'ended', 'stopped', 'hidden', 'archived']) {
      expect(isPurchasableSaleState(state)).toBe(false);
    }
  });
});
