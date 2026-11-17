import { describe, expect, it } from 'vitest';
import { buildCategoryListingNav, CATEGORY_CHIP_FIRST_ROW_COUNT } from './category-chips';
import type { StorefrontCategoryNode } from './storefront-mega-menu';

/* 칩 1·2줄·하위 탭·선택 판정(스펙 C §2.4, D6~D8). 트리는 공개 전시 트리의 모양 — 트리 순서, 부모가 먼저. */

const id = (n: number) => `5a4c3000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const href = (n: number) => `/shop?displayCategory=${id(n)}`;

function node(n: number, name: string, parent: number | null, overrides: Partial<StorefrontCategoryNode> = {}): StorefrontCategoryNode {
  return { id: id(n), parentId: parent === null ? null : id(parent), name, depth: parent === null ? 1 : 2, imageUrl: null, navigable: true, ...overrides };
}

/* 1단계 6개: 문구용품(1)·인형(2)·아크릴(3)·피규어(4) / 디지털(5)·홈데코(6). 문구용품 아래 2단계 3개, 그중 '스티커'(12) 아래 3단계 1개. */
const tree: StorefrontCategoryNode[] = [
  node(1, '문구용품', null),
  node(11, '다이어리', 1),
  node(12, '스티커', 1),
  node(121, '반짝 스티커', 12, { depth: 3 }),
  node(13, '노트', 1),
  node(2, '인형', null),
  node(3, '아크릴', null),
  node(4, '피규어', null),
  node(5, '디지털', null),
  node(6, '홈데코', null),
];

describe('buildCategoryListingNav — 칩 영역', () => {
  it('전체 목록(currentId null)은 맨 앞 전체 칩이 선택이고 제목은 전체 굿즈다', () => {
    const nav = buildCategoryListingNav(tree, null);

    expect(nav.title).toBe('전체 굿즈');
    expect(nav.firstRow[0]).toEqual({ id: 'all', label: '전체', href: '/shop', selected: true });
    expect([...nav.firstRow, ...nav.secondRow].filter((chip) => chip.selected)).toHaveLength(1);
    expect(nav.tabs).toEqual([]);
    expect(nav.subtitle).toBeNull();
  });

  it('1단계 앞 4개가 전체 칩과 1줄, 나머지가 2줄이다', () => {
    const nav = buildCategoryListingNav(tree, null);

    expect(CATEGORY_CHIP_FIRST_ROW_COUNT).toBe(4);
    expect(nav.firstRow.map((chip) => chip.label)).toEqual(['전체', '문구용품', '인형', '아크릴', '피규어']);
    expect(nav.secondRow.map((chip) => chip.label)).toEqual(['디지털', '홈데코']);
    expect(nav.firstRow[1].href).toBe(href(1));
  });

  it('1단계가 4개 이하이면 한 줄뿐이다(2줄·구분선 없음)', () => {
    const nav = buildCategoryListingNav([node(1, '문구용품', null), node(11, '다이어리', 1), node(2, '인형', null), node(3, '아크릴', null)], null);

    expect(nav.firstRow.map((chip) => chip.label)).toEqual(['전체', '문구용품', '인형', '아크릴']);
    expect(nav.secondRow).toEqual([]);
  });

  it('공개 트리가 비면 칩이 없고 전체 목록 제목만 남는다', () => {
    expect(buildCategoryListingNav([], null)).toEqual({ firstRow: [], secondRow: [], title: '전체 굿즈', subtitle: null, tabs: [] });
    expect(buildCategoryListingNav([], id(1)).title).toBeNull();
  });

  it('전시가 없는 1단계(navigable 아님)는 트리 순서상 첫 navigable 자손으로 링크한다', () => {
    const grouped: StorefrontCategoryNode[] = [
      node(1, '묶음', null, { navigable: false }),
      node(11, '첫 자손', 1, { navigable: false }),
      node(111, '더 아래', 11, { depth: 3 }),
      node(12, '둘째 자손', 1),
      node(2, '인형', null),
    ];
    const nav = buildCategoryListingNav(grouped, null);

    expect(nav.firstRow.map((chip) => [chip.label, chip.href])).toEqual([['전체', '/shop'], ['묶음', href(111)], ['인형', href(2)]]);
  });

  it('어디로도 갈 수 없는 1단계 칩은 그리지 않고 줄 나눔은 그린 칩 기준이다', () => {
    const dead: StorefrontCategoryNode[] = [
      node(1, '갈 곳 없음', null, { navigable: false }),
      node(2, 'A', null), node(3, 'B', null), node(4, 'C', null), node(5, 'D', null), node(6, 'E', null),
    ];
    const nav = buildCategoryListingNav(dead, null);

    expect(nav.firstRow.map((chip) => chip.label)).toEqual(['전체', 'A', 'B', 'C', 'D']);
    expect(nav.secondRow.map((chip) => chip.label)).toEqual(['E']);
  });
});

describe('buildCategoryListingNav — 선택·제목·하위 탭', () => {
  it('1단계를 보면 그 칩이 선택이고 제목은 그 이름, 탭은 전체 + 2단계 자식이다', () => {
    const nav = buildCategoryListingNav(tree, id(1));

    expect(nav.title).toBe('문구용품');
    expect(nav.firstRow.find((chip) => chip.selected)?.label).toBe('문구용품');
    expect(nav.firstRow[0].selected).toBe(false);
    expect(nav.tabs.map((tab) => [tab.label, tab.href, tab.selected])).toEqual([
      ['전체', href(1), true],
      ['다이어리', href(11), false],
      ['스티커', href(12), false],
      ['노트', href(13), false],
    ]);
    expect(nav.subtitle).toBeNull();
  });

  it('2단계를 보면 제목은 1단계 이름으로 두고 그 탭이 선택이다', () => {
    const nav = buildCategoryListingNav(tree, id(11));

    expect(nav.title).toBe('문구용품');
    expect(nav.firstRow.find((chip) => chip.selected)?.label).toBe('문구용품');
    expect(nav.tabs.filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(['다이어리']);
    expect(nav.subtitle).toBeNull();
  });

  it('3단계를 보면 2단계 조상 탭이 선택이고 3단계 이름은 부제로 보인다', () => {
    const nav = buildCategoryListingNav(tree, id(121));

    expect(nav.title).toBe('문구용품');
    expect(nav.tabs.filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(['스티커']);
    expect(nav.subtitle).toBe('반짝 스티커');
  });

  it('2줄에 있는 1단계도 선택이 되고 자식이 없으면 탭 줄이 없다', () => {
    const nav = buildCategoryListingNav(tree, id(5));

    expect(nav.title).toBe('디지털');
    expect(nav.secondRow.find((chip) => chip.selected)?.label).toBe('디지털');
    expect(nav.tabs).toEqual([]);
  });

  it('1단계에 전시가 없으면 전체 탭을 빼고 자식 탭만 둔다 — 자식도 갈 곳이 없으면 탭 줄이 없다', () => {
    const titleOnly: StorefrontCategoryNode[] = [
      node(1, '묶음', null, { navigable: false }),
      node(11, '자식 하나', 1),
      node(12, '갈 곳 없는 자식', 1, { navigable: false }),
    ];
    const nav = buildCategoryListingNav(titleOnly, id(11));

    expect(nav.tabs.map((tab) => tab.label)).toEqual(['자식 하나']);
    expect(nav.tabs[0].selected).toBe(true);
    expect(buildCategoryListingNav([node(1, '묶음', null, { navigable: false }), node(11, '갈 곳 없음', 1, { navigable: false }), node(2, '인형', null)], id(2)).tabs).toEqual([]);
  });

  it('공개 트리에 없는 전시 id 는 칩을 그리되 아무것도 선택하지 않고 제목은 호출부 몫(null)이다', () => {
    const nav = buildCategoryListingNav(tree, id(999));

    expect(nav.title).toBeNull();
    expect([...nav.firstRow, ...nav.secondRow].some((chip) => chip.selected)).toBe(false);
    expect(nav.tabs).toEqual([]);
  });
});
