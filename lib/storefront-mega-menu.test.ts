import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISPLAY_MESSAGING_TOPIC } from './admin/guide/topics/display-messaging';
import {
  MEGA_MENU_CAMPAIGN_LIMIT,
  MEGA_MENU_IP_TILE_COUNT,
  MENU_CAMPAIGN_LIMIT,
  MENU_FEATURED_IP_LIMIT,
  categoryMenuGroups,
  categoryMenuTiles,
  chunkMenuItems,
  isCategoryMenuLive,
  menuMonogram,
  parseStorefrontCategoryMenu,
  toMenuCampaigns,
  toMenuIps,
} from './storefront-mega-menu';

/* LFS 패리티 2차 L5 — 메가메뉴·카테고리 시트 데이터 계약. 공개 메뉴 RPC(get_storefront_category_menu)가 트리 순서로
 * 공개 전시 노드와 그 조상만 내려 준다는 것을 전제로, 셸은 그 모양이 조금이라도 어긋나면 기존 메뉴로 돌아간다. */

const id = (n: number) => `94932000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = (path: string) => `https://cdn.example/${path}`;
const row = (n: number, parent: number | null, depth: number, navigable: boolean, imagePath: string | null = null, name = `전시 ${n}`) => ({
  id: id(n), parentId: parent === null ? null : id(parent), name, depth, imagePath, navigable,
});
const tree = [
  row(1, null, 1, false, null, '토이'),
  row(2, 1, 2, true, null, '피규어'),
  row(3, 1, 2, false, null, '라이프'),
  row(4, 3, 3, true, null, '머그'),
  row(5, null, 1, true, null, '시즌'),
];

describe('공개 메뉴 RPC 검증', () => {
  it('트리 순서·깊이·부모를 그대로 받고 이미지 경로는 공개 URL로 바꾼다', () => {
    const iconPath = 'public-media/catalog/curation/94932000-0000-4000-8000-000000000301.png';
    const nodes = parseStorefrontCategoryMenu([...tree.slice(0, 1), { ...tree[1], imagePath: iconPath }, ...tree.slice(2)], url);
    expect(nodes?.map((node) => [node.name, node.depth, node.navigable])).toEqual([
      ['토이', 1, false], ['피규어', 2, true], ['라이프', 2, false], ['머그', 3, true], ['시즌', 1, true],
    ]);
    expect(nodes?.[1].imageUrl).toBe(`https://cdn.example/${iconPath}`);
    expect(nodes?.[0].imageUrl).toBeNull();
    expect(isCategoryMenuLive({ categories: nodes! })).toBe(true);
  });

  it('부모보다 먼저 온 자식·깊이 불일치·중복·외부 이미지·제어문자 이름은 메뉴 전체를 거절한다', () => {
    expect(parseStorefrontCategoryMenu([tree[1], tree[0]], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([tree[0], { ...tree[1], depth: 3 }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([tree[0], { ...tree[0] }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([{ ...tree[4], parentId: id(1) }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([{ ...tree[4], imagePath: 'https://evil.example/icon.png' }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([{ ...tree[4], name: '줄\n바꿈' }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([{ ...tree[4], name: '   ' }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([{ ...tree[4], navigable: 'true' }], url)).toBeNull();
    expect(parseStorefrontCategoryMenu({ nodes: tree }, url)).toBeNull();
  });

  it('목적지 없는 제목만 남은 응답은 그리지 않고, 빈 응답은 꺼진 메뉴다', () => {
    expect(parseStorefrontCategoryMenu([tree[0]], url)).toBeNull();
    expect(parseStorefrontCategoryMenu([], url)).toEqual([]);
    expect(isCategoryMenuLive({ categories: [] })).toBe(false);
  });
});

describe('메가메뉴 그룹과 시트 타일', () => {
  const nodes = parseStorefrontCategoryMenu(tree, url)!;

  it('최상위 전시분류가 그룹 제목이고 하위 전시는 트리 순서의 항목이다 — 자기 전시가 없으면 링크 없는 이름표', () => {
    const groups = categoryMenuGroups(nodes);
    expect(groups.map((group) => [group.name, group.href])).toEqual([
      ['토이', null],
      ['시즌', `/shop?displayCategory=${id(5)}`],
    ]);
    expect(groups[0].items).toEqual([
      { id: id(2), name: '피규어', depth: 2, href: `/shop?displayCategory=${id(2)}` },
      { id: id(3), name: '라이프', depth: 2, href: null },
      { id: id(4), name: '머그', depth: 3, href: `/shop?displayCategory=${id(4)}` },
    ]);
  });

  it('시트 아이콘 그리드는 목적지가 있는 전시분류만 트리 순서로 싣는다', () => {
    expect(categoryMenuTiles(nodes).map((tile) => tile.name)).toEqual(['피규어', '머그', '시즌']);
    expect(categoryMenuTiles(nodes)[0]).toEqual({ id: id(2), name: '피규어', href: `/shop?displayCategory=${id(2)}`, imageUrl: null });
  });

  it('이미지 대체 첫 글자와 2×2 묶음', () => {
    expect(menuMonogram(' 피규어')).toBe('피');
    expect(menuMonogram('Maple')).toBe('M');
    expect(chunkMenuItems([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
    expect(chunkMenuItems([])).toEqual([]);
  });
});

describe('기획전·피처드 IP 원천', () => {
  it('진행 중 캠페인은 중복·빈 제목을 버리고 상한까지만 싣는다', () => {
    const rows = [
      { id: 'c1', title: '가을 기획전', card_image_path: 'catalog/event/a.webp' },
      { id: 'c1', title: '중복', card_image_path: null },
      { id: 'c2', title: '  ', card_image_path: null },
      { id: 'c3', title: '겨울 기획전', card_image_path: null },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `x${index}`, title: `추가 ${index}`, card_image_path: null })),
    ];
    const campaigns = toMenuCampaigns(rows, url);
    expect(campaigns).toHaveLength(MENU_CAMPAIGN_LIMIT);
    expect(campaigns.slice(0, 2)).toEqual([
      { id: 'c1', title: '가을 기획전', imageUrl: 'https://cdn.example/catalog/event/a.webp' },
      { id: 'c3', title: '겨울 기획전', imageUrl: null },
    ]);
    expect(toMenuCampaigns(null, url)).toEqual([]);
  });

  it('피처드 IP는 디렉토리와 같은 순서(운영 순번 → 영문 표시명)·상한, 공개 주소·키아트를 쓴다', () => {
    const rows = [
      { id: 'zeta', public_slug: null, title: 'Zeta', bg: null, image_path: null, sort_order: null },
      { id: 'beta', public_slug: 'beta-world', title: 'Beta', bg: 'linear-gradient(#fff, #000)', image_path: null, sort_order: 2 },
      { id: 'alpha', public_slug: null, title: 'Alpha', bg: null, image_path: 'catalog/ip/alpha.webp', sort_order: 1 },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `ip${index}`, public_slug: null, title: `IP ${index}`, bg: null, image_path: null, sort_order: 10 + index })),
    ];
    const ips = toMenuIps(rows, url);
    expect(ips).toHaveLength(MENU_FEATURED_IP_LIMIT);
    expect(ips.slice(0, 2)).toEqual([
      { id: 'alpha', name: 'Alpha', href: '/ip/alpha', imageBg: 'url("https://cdn.example/catalog/ip/alpha.webp") center / cover no-repeat' },
      { id: 'beta', name: 'Beta', href: '/ip/beta-world', imageBg: 'linear-gradient(#fff, #000)' },
    ]);
    expect(ips.map((ip) => ip.id)).not.toContain('zeta');
    expect(toMenuIps([{ id: 'none', title: '', bg: null }], url)).toEqual([]);
  });
});

describe('어드민 가이드 수치 결속', () => {
  /* 판매자 가이드(전시·알림 › 독립 전시분류)가 프로즈로 옮겨 적은 메뉴 수치 — 소스가 바뀌면 여기가 깨지고 가이드도 함께 고친다. */
  it('기획전·추천 IP·이미지 타일 개수와 반영 지연(캐시 300초)이 소스와 같다', () => {
    const text = DISPLAY_MESSAGING_TOPIC.sections.find((section) => section.id === 'category-display')!.paragraphs!.join('\n');
    expect(text).toContain(`PC ${MEGA_MENU_CAMPAIGN_LIMIT}개·모바일 ${MENU_CAMPAIGN_LIMIT}개`);
    expect(text).toContain(`최대 ${MENU_FEATURED_IP_LIMIT}개`);
    expect(text).toContain(`상위 ${MEGA_MENU_IP_TILE_COUNT}개`);
    expect(text).toContain('최대 5분');
    expect(readFileSync(join(process.cwd(), 'lib/storefront-mega-menu.server.ts'), 'utf8')).toContain('revalidate: 300');
  });
});
