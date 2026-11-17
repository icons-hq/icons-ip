import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LISTING_SORTS } from '@/lib/listing-sorts';
import { ListingHeader, type ListingHeaderTab } from './ListingHeader';

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/new',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const tabs: ListingHeaderTab[] = [
  { key: 'popular', label: '인기도순', href: '/shop/new?sort=popular', selected: false },
  { key: 'newest', label: '최신 등록순', href: '/shop/new', selected: true },
  { key: 'sales', label: '판매량순', href: '/shop/new?sort=sales', selected: false },
];

describe('ListingHeader', () => {
  it('제목은 보이는 h1 이고 탭 줄은 이름 있는 링크 묶음이며 현재 탭만 aria-current 다', () => {
    const html = renderToStaticMarkup(<ListingHeader tabs={tabs} tabsLabel="정렬" title="NEW" />);

    expect(html).toContain('<h1 class="wc-listing-head__title">NEW</h1>');
    expect(html).toContain('<nav aria-label="정렬" class="wc-listing-tabs">');
    /* ARIA tablist 가 아니다 — URL 을 바꾸는 링크 묶음이다. */
    expect(html).not.toContain('role="tab');
    const links = [...html.matchAll(/<a\b[^>]*>[^<]*<\/a>/g)].map((match) => match[0]);
    expect(links).toHaveLength(3);
    expect(links.filter((link) => link.includes('aria-current="page"'))).toHaveLength(1);
    expect(links.find((link) => link.includes('aria-current="page"'))).toContain('href="/shop/new"');
    expect(html).toContain('href="/shop/new?sort=popular"');
  });

  it('셀렉트가 없으면(NEW) 그리지 않고, 정렬 기준이라는 숨은 라벨이 달린 네이티브 select 가 있으면 현재 값이 선택이다', () => {
    expect(renderToStaticMarkup(<ListingHeader tabs={tabs} title="NEW" />)).not.toContain('<select');
    expect(renderToStaticMarkup(<ListingHeader sort={null} tabs={tabs} title="NEW" />)).not.toContain('<select');

    const html = renderToStaticMarkup(<ListingHeader sort={{ value: 'sales', options: LISTING_SORTS, onChange: () => undefined }} title="BEST" />);
    const labels = [...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((match) => match[1]);

    expect(html).toMatch(/<label class="wc-sr-only" for="[^"]+">정렬 기준<\/label>/);
    expect(labels).toEqual(['추천순', '인기도순', '최신 등록순', '판매량순', '낮은 가격순', '높은 가격순', '리뷰 많은순']);
    expect(html).toMatch(/<option[^>]*value="sales"[^>]*selected[^>]*>판매량순<\/option>/);
    /* 라벨의 for 가 select 의 id 를 가리킨다. */
    const labelFor = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${labelFor}"`);
  });

  it('탭이 비었으면 탭 줄을 그리지 않고, 부제는 › 로 시작하는 작은 줄이다', () => {
    const none = renderToStaticMarkup(<ListingHeader tabs={[]} title="전체 굿즈" />);
    expect(none).not.toContain('wc-listing-tabs');
    expect(none).not.toContain('wc-listing-head__sub');

    const html = renderToStaticMarkup(<ListingHeader subtitle="반짝 스티커" title="문구용품" />);
    expect(html).toContain('<p class="wc-listing-head__sub">› 반짝 스티커</p>');
  });
});
