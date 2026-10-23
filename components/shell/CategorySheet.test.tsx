import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NavItem } from '@/lib/routes';
import type { StorefrontCategoryNode, StorefrontMenuCampaign, StorefrontMenuIp } from '@/lib/storefront-mega-menu';
import { CategorySheet } from './CategorySheet';

/* MC-05 — 모바일 '카테고리' 탭 전용 시트. renderToStaticMarkup 이라 effect(배경 inert·포커스·Escape)는 돌지 않는다 —
 * 그 동작은 useOverlayA11y 계약이고 여기서는 시트의 세 단 구조·목적지·대체 표시를 잠근다. */

vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));

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
    expect(html.match(/class="wc-sheet__section wc-catsheet__section"/g)).toHaveLength(3);
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
    const categories = html.slice(html.indexOf('id="wc-catsheet-panel-categories"'), html.indexOf('id="wc-catsheet-panel-ips"'));
    expect(categories).not.toContain('>토이<');
    expect(categories).toContain(`class="wc-catsheet__tile" href="/shop?displayCategory=${nodeId(2)}"><span aria-hidden="true" class="wc-catsheet__tile-image wc-catsheet__tile-image--icon" style="background-image:url(&quot;https://cdn.example/public-media/catalog/curation/icon.png&quot;)"></span><span class="wc-catsheet__tile-label">피규어</span>`);
    expect(categories).toContain(`class="wc-catsheet__tile" href="/shop?displayCategory=${nodeId(3)}"><span aria-hidden="true" class="wc-catsheet__tile-image wc-catsheet__tile-image--text">키</span><span class="wc-catsheet__tile-label">키링</span>`);
  });

  it('온라인 팝업 탭은 피처드 IP 키아트 그리드이고, 피처드가 없으면 탭 없이 카테고리 그리드만 둔다', () => {
    const html = render();
    const ipPanel = html.slice(html.indexOf('id="wc-catsheet-panel-ips"'));
    expect(ipPanel).toContain('class="wc-catsheet__tile" href="/ip/maple"><span aria-hidden="true" class="wc-catsheet__tile-image wc-catsheet__tile-image--art" style="background:url(&quot;https://cdn.example/maple.webp&quot;) center / cover no-repeat"></span>');
    expect(ipPanel).toContain('class="wc-catsheet__tile-image wc-catsheet__tile-image--text">H</span><span class="wc-catsheet__tile-label">Hong Sil</span>');

    const noIps = render({ featuredIps: [] });
    expect(noIps).not.toContain('role="tablist"');
    expect(noIps).toContain('<h2 class="wc-sheet__title">카테고리</h2><ul class="wc-catsheet__grid">');
  });

  it('대화상자·탭 이름은 운영 메뉴 이름을 따른다', () => {
    const html = render({ categoryLabel: '상품 분류', onlinePopupLabel: 'IP관' });
    expect(html).toContain('aria-label="상품 분류" aria-modal="true"');
    expect(html).toContain('aria-label="상품 분류 닫기"');
    expect(html).toMatch(/id="wc-catsheet-tab-categories"[^>]*>상품 분류<\/button>/);
    expect(html).toMatch(/id="wc-catsheet-tab-ips"[^>]*>IP관<\/button>/);
  });
});
