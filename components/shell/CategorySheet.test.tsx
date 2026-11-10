import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/lib/routes';
import type { StorefrontCategoryNode, StorefrontMenuCampaign, StorefrontMenuIp } from '@/lib/storefront-mega-menu';
import { CategorySheet } from './CategorySheet';

/* MC-05 — 모바일 '카테고리' 탭 전용 시트. renderToStaticMarkup 이라 effect(배경 inert·포커스·Escape)는 돌지 않는다 —
 * 그 동작은 useOverlayA11y 계약이고 여기서는 시트의 세 단 구조·목적지·대체 표시를 잠근다. */

vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
/* 시트가 쓰는 탭 부품은 그대로 쓰되, 테스트가 처음 고를 탭만 바꿀 수 있게 감싼다(renderToStaticMarkup 이라 클릭이 없다). */
const tabProbe = vi.hoisted(() => ({ defaultTabId: undefined as 'categories' | 'ips' | undefined }));
vi.mock('./CategorySheetTabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./CategorySheetTabs')>();
  return {
    ...actual,
    CategorySheetTabs: (props: Parameters<typeof actual.CategorySheetTabs>[0]) => actual.CategorySheetTabs({ ...props, defaultTabId: tabProbe.defaultTabId ?? props.defaultTabId }),
  };
});

const nodeId = (n: number) => `94932000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nodes: StorefrontCategoryNode[] = [
  { id: nodeId(1), parentId: null, name: '토이', depth: 1, imageUrl: null, navigable: false },
  { id: nodeId(2), parentId: nodeId(1), name: '피규어', depth: 2, imageUrl: 'https://cdn.example/public-media/catalog/curation/icon.png', navigable: true },
  { id: nodeId(3), parentId: nodeId(1), name: '키링', depth: 2, imageUrl: null, navigable: true },
];
const shortcuts: NavItem[] = [
  { id: 'new', label: 'NEW' }, { id: 'best', label: 'BEST' }, { id: 'shop', label: '전체 굿즈' }, { id: 'events', label: '이벤트' }, { id: 'stories', label: '쇼핑스토리' },
];
const campaigns: StorefrontMenuCampaign[] = Array.from({ length: 6 }, (_, index) => ({
  id: `c${index + 1}`, title: `기획전 ${index + 1}`, imageUrl: index === 0 ? 'https://cdn.example/card.webp' : null,
}));
const ips: StorefrontMenuIp[] = [
  { id: 'maple', name: 'MapleStory', href: '/ip/maple', imageBg: 'url("https://cdn.example/maple.webp") center / cover no-repeat' },
  { id: 'hongsil', name: 'Hong Sil', href: '/ip/hongsil', imageBg: null },
];

function render(overrides: Partial<Parameters<typeof CategorySheet>[0]> = {}) {
  return renderToStaticMarkup(<CategorySheet campaigns={campaigns} featuredIps={ips} nodes={nodes} onClose={vi.fn()} shortcuts={shortcuts} {...overrides} />);
}

describe('모바일 카테고리 시트 (MC-05)', () => {
  beforeEach(() => {
    tabProbe.defaultTabId = undefined;
  });

  it('모달 대화상자이고 닫기 버튼이 첫 포커스 대상이다 — 딤은 장식이다', () => {
    const html = render();
    expect(html).toMatch(/^<div aria-hidden="true" class="wc-sheet-dim wc-catsheet-dim"><\/div>/);
    expect(html).toContain('aria-label="카테고리" aria-modal="true" class="wc-sheet wc-catsheet" role="dialog"');
    const dialog = html.slice(html.indexOf('role="dialog"'));
    expect(dialog.indexOf('aria-label="카테고리 닫기"')).toBeLessThan(dialog.indexOf('<a '));
  });

  it('① 바로가기 → ② 기획전 → ③ 탭 순서이고 섹션 사이 띠는 전체 메뉴 시트와 같은 문법이다', () => {
    const html = render();
    expect(html.indexOf('>바로가기</h2>')).toBeGreaterThan(-1);
    expect(html.indexOf('>바로가기</h2>')).toBeLessThan(html.indexOf('>기획전</h2>'));
    expect(html.indexOf('>기획전</h2>')).toBeLessThan(html.indexOf('role="tablist"'));
    /* ①·② 는 제목이 있고, ③ 탭 구역은 탭이 제목을 대신한다(제목 없는 구역 표시 — 맨 위에 올 때만 닫기 버튼 줄만큼 내린다). */
    expect(html.match(/class="wc-sheet__section wc-catsheet__section"/g)).toHaveLength(2);
    expect(html.match(/class="wc-sheet__section wc-catsheet__section wc-catsheet__section--untitled"><div class="wc-tabs wc-catsheet__tabs">/g)).toHaveLength(1);
  });

  /* QA l5-qa-5 — 닫기 버튼은 시트 기준으로 떠 있고 스크롤은 안쪽이 해서, 내리면 기획전 이미지·제목이 X 아래로 지나갔다.
   * 머리줄 배경은 스크롤 위치로 켜지므로(data-scrolled) 처음 그릴 때는 꺼져 있고, 스크롤을 받는 것은 안쪽 상자다. */
  it('처음 열 때 머리줄 배경은 꺼져 있고(스크롤 전), 바로가기·기획전이 없으면 제목 없는 탭 구역이 맨 위에 온다', () => {
    const html = render();
    expect(html).toContain('class="wc-sheet wc-catsheet" role="dialog"');
    expect(html).not.toContain('data-scrolled');
    expect(html).toContain('</button><div class="wc-sheet__inner">');

    const tabsFirst = render({ shortcuts: [], campaigns: [] });
    expect(tabsFirst).toContain('<div class="wc-sheet__inner"><section class="wc-sheet__section wc-catsheet__section wc-catsheet__section--untitled">');
  });

  it('바로가기는 운영 메뉴 설정 순서의 스토어 목적지와 ICONS 아이콘 칸이다', () => {
    const html = render();
    const links = [...html.matchAll(/class="wc-catsheet__shortcut" href="([^"]+)"><span aria-hidden="true" class="wc-catsheet__icon"><span data-icon="([^"]+)"><\/span><\/span><span class="wc-catsheet__label">([^<]+)</g)]
      .map((match) => [match[1], match[2], match[3]]);
    expect(links).toEqual([
      ['/shop/new', 'spark', 'NEW'], ['/shop/best', 'star', 'BEST'], ['/shop', 'shop', '전체 굿즈'], ['/events', 'event', '이벤트'], ['/stories', 'image', '쇼핑스토리'],
    ]);
  });

  it('기획전은 진행 중 캠페인 카드 2×2 장으로 묶이고 이미지가 없으면 회색 칸만 둔다', () => {
    const html = render();
    expect(html).toContain('aria-label="기획전" aria-roledescription="carousel" class="wc-slider wc-catsheet__collections"');
    expect(html.match(/class="wc-catsheet__collection-page"/g)).toHaveLength(2);
    expect(html.match(/class="wc-catsheet__collection" href="\/events\/c\d"/g)).toHaveLength(6);
    expect(html).toContain('class="wc-catsheet__collection-image" style="background-image:url(&quot;https://cdn.example/card.webp&quot;)"');
    expect(html).toContain('<span aria-hidden="true" class="wc-catsheet__collection-image"></span><span class="wc-catsheet__collection-title">기획전 2</span>');

    const none = render({ campaigns: [] });
    expect(none).not.toContain('>기획전</h2>');
    expect(none).not.toContain('wc-catsheet__collections');
  });

  it('카테고리 탭은 목적지가 있는 전시분류 아이콘 그리드이고 아이콘이 없으면 이름 첫 글자로 선다', () => {
    const html = render();
    expect(html).toContain('id="wc-catsheet-tab-categories"');
    expect(html).toContain('id="wc-catsheet-tab-ips"');
    const categories = html.slice(html.indexOf('id="wc-catsheet-panel-categories"'));
    expect(categories).not.toContain('>토이<');
    expect(categories).toContain(`class="wc-catsheet__tile" href="/shop?displayCategory=${nodeId(2)}"><span aria-hidden="true" class="wc-catsheet__tile-image wc-catsheet__tile-image--icon" style="background-image:url(&quot;https://cdn.example/public-media/catalog/curation/icon.png&quot;)"></span><span class="wc-catsheet__tile-label">피규어</span>`);
    expect(categories).toContain(`class="wc-catsheet__tile" href="/shop?displayCategory=${nodeId(3)}"><span aria-hidden="true" class="wc-catsheet__tile-image wc-catsheet__tile-image--text">키</span><span class="wc-catsheet__tile-label">키링</span>`);
  });

  it('온라인 팝업 탭은 피처드 IP 키아트 그리드이고, 피처드가 없으면 탭 없이 카테고리 그리드만 둔다', () => {
    /* 기본은 카테고리 탭이고, 고르지 않은 패널은 DOM 에 없다(리뷰 l5-ui-1). 온라인 팝업 탭을 고른 상태로 그려 IP 타일을 확인한다. */
    expect(render()).not.toContain('href="/ip/maple"');
    tabProbe.defaultTabId = 'ips';
    const html = render();
    expect(html).not.toContain('id="wc-catsheet-panel-categories"');
    const ipPanel = html.slice(html.indexOf('id="wc-catsheet-panel-ips"'));
    expect(ipPanel).toContain('class="wc-catsheet__tile" href="/ip/maple"><span aria-hidden="true" class="wc-catsheet__tile-image wc-catsheet__tile-image--art" style="background:url(&quot;https://cdn.example/maple.webp&quot;) center / cover no-repeat"></span>');
    expect(ipPanel).toContain('class="wc-catsheet__tile-image wc-catsheet__tile-image--text">H</span><span class="wc-catsheet__tile-label">Hong Sil</span>');

    const noIps = render({ featuredIps: [] });
    expect(noIps).not.toContain('role="tablist"');
    expect(noIps).toContain('<h2 class="wc-sheet__title">카테고리</h2><ul class="wc-catsheet__grid">');
  });

  /* 리뷰 l5-ui-1 — 공유 포커스 트랩(useOverlayA11y)은 대화상자 안 포커스 후보(a[href]·button·[tabindex] …)의 처음과 끝을
   * DOM 순서로 고르고, 그때는 보이는지 따지지 않았다. 숨긴 패널이 DOM 에 남으면 끝 후보가 보이지 않는 링크가 돼 마지막 타일에서 Tab 이
   * 대화상자 밖(셸 스킵 링크)으로 새고, 닫기 버튼에서 Shift+Tab 이 멈췄다. 이제 트랩이 숨은 후보를 거르지만(overlay-focus.ts),
   * 시트에는 여전히 숨긴 요소가 없어야 하고 끝 후보는 보이는 마지막 타일이어야 한다. */
  it('포커스 트랩의 처음·끝 후보가 보이는 요소다 — 숨긴 패널·링크를 DOM 에 남기지 않는다', () => {
    for (const tab of ['categories', 'ips'] as const) {
      tabProbe.defaultTabId = tab;
      const dialog = render().slice(render().indexOf('role="dialog"'));
      expect(dialog).not.toMatch(/\shidden(=|\s|>)/);
      expect(dialog.match(/role="tabpanel"/g)).toHaveLength(1);
      const focusable = [...dialog.matchAll(/<(a|button)\b[^>]*>|<[a-z]+\b[^>]*\btabindex="(?!-1")[^"]*"[^>]*>/g)].map((match) => match[0]);
      expect(focusable[0]).toContain('aria-label="카테고리 닫기"');
      expect(focusable.at(-1)).toContain(tab === 'categories' ? `href="/shop?displayCategory=${nodeId(3)}"` : 'href="/ip/hongsil"');
    }
  });

  it('대화상자·탭 이름은 운영 메뉴 이름을 따른다', () => {
    const html = render({ categoryLabel: '상품 분류', onlinePopupLabel: 'IP관' });
    expect(html).toContain('aria-label="상품 분류" aria-modal="true"');
    expect(html).toContain('aria-label="상품 분류 닫기"');
    expect(html).toMatch(/id="wc-catsheet-tab-categories"[^>]*>상품 분류<\/button>/);
    expect(html).toMatch(/id="wc-catsheet-tab-ips"[^>]*>IP관<\/button>/);
  });
});
