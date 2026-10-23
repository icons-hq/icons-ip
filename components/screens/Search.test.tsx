import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, Ip } from '@/lib/data';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import type { SearchResult, SearchResultKind, SearchSnapshot } from '@/lib/search';
import { selectSearchGoods } from '@/lib/search-goods';
import { SUGGESTED_SEARCH_TERMS } from '@/lib/search-terms';
import { parseShopSearchParams } from '@/lib/shop-catalog';
import { Search } from './Search';

vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

/* 헤딩은 질의어·건수만 <strong> 으로 강조해서 태그가 문장 중간에 끼어든다.
   카피 전문을 단언하려면 태그를 걷고 React 가 이스케이프한 따옴표를 되돌려야 한다. */
const text = (html: string) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&');

const good = (id: string, overrides: Partial<Good> = {}): Good => ({
  id,
  name: `굿즈 ${id}`,
  ip: 'rilakkuma',
  type: '키링',
  price: 12000,
  badge: null,
  stock: 'ok',
  stockQty: 10,
  img: 'none',
  ...overrides,
});

const ip = (id: string, title: string): Ip => ({
  id, title, sub: '', v: { key: 'char', label: '캐릭터', color: '#111' }, glyph: 'R', bg: 'none',
  fans: 0, goods: 0, cards: 0, featured: false, tagline: '', synopsis: '',
});

const IPS = [ip('rilakkuma', '리락쿠마'), ip('maple', '메이플스토리')];

const result = (kind: SearchResultKind, id: string, label: string): SearchResult => ({
  kind,
  id,
  label,
  subtitle: '부제',
  ipId: kind === 'ip' ? id : 'rilakkuma',
  ipTitle: '리락쿠마',
  imagePath: null,
  bg: 'none',
  accent: null,
  score: 1,
});

const snapshotOf = (query: string, groups: SearchSnapshot['groups']): SearchSnapshot => ({
  source: 'mock',
  query,
  displayedTotal: groups.reduce((total, group) => total + group.results.length, 0),
  groups,
});

function render(
  query: string,
  goods: Good[],
  options: { params?: Record<string, string | string[]>; page?: number; groups?: SearchSnapshot['groups']; wishlist?: ListingWishlist | null } = {},
) {
  const listQuery = parseShopSearchParams(options.params ?? {}, { view: 'search', validIpIds: new Set(IPS.map((item) => item.id)) });
  const collection = selectSearchGoods({ ips: IPS, goods }, query, listQuery, options.page ?? 1);
  return renderToStaticMarkup(
    <Search goods={collection} listQuery={listQuery} query={query} snapshot={snapshotOf(query, options.groups ?? [])} wishlist={options.wishlist} />,
  );
}

describe('Search 헤딩과 굿즈 그리드', () => {
  const items = [good('g1', { name: '리락쿠마 키링' }), good('g2', { name: '리락쿠마 인형', type: '인형', price: 30000 })];
  const html = render('리락쿠마', items);

  it('질의어와 굿즈 건수를 헤딩에 쓴다', () => {
    expect(text(html)).toContain("'리락쿠마' 검색 결과 2개");
  });

  it('주 결과를 굿즈 그리드로 그린다', () => {
    expect(html).toContain('wc-product-grid');
    expect(html).toContain('리락쿠마 키링');
    expect(html).toContain('₩12,000');
  });

  it('카드에 브랜드(IP 제목) 줄을 유지한다 — 굿즈샵 그리드와 같은 anatomy', () => {
    expect(html).toContain('wc-product-card__brand');
    expect(html).toContain('리락쿠마</');
  });

  it('굿즈 결과는 목록이 아니라 상세로 보낸다', () => {
    expect(html).toContain('href="/shop/g1"');
    expect(html).toContain('href="/shop/g2"');
    expect(html).not.toContain('href="/shop"');
  });

  it('질의어를 검색 인풋에 유지한다', () => {
    expect(html).toContain('action="/search"');
    expect(html).toContain('value="리락쿠마"');
  });

  /* 제목·인풋은 한 밴드(데스크톱 한 줄)이고, 돋보기는 칸 안 왼쪽 제출 버튼이다(SR-02). */
  it('제목과 재검색 인풋을 한 밴드에 두고 돋보기를 제출 버튼으로 쓴다', () => {
    const head = html.match(/<div class="wc-search-results__head has-results">[\s\S]*?<\/form><\/div>/)?.[0] ?? '';

    expect(head).toContain('wc-search-results__heading');
    expect(head).toMatch(/<button aria-label="검색" class="wc-search-results__submit" type="submit">/);
    expect(head).toContain('class="wc-search-results__input"');
  });
});

describe('Search 컬렉션 본문 (SR-01)', () => {
  const items = [
    good('g1', { name: '리락쿠마 키링', price: 20000 }),
    good('g2', { name: '리락쿠마 인형', type: '인형', price: 10000 }),
    good('g3', { name: '리락쿠마 메이플 콜라보', ip: 'maple', price: 30000 }),
  ];

  it('굿즈샵 사이드바(IP·타입·가격)와 "전체 › N개 결과" 줄을 그린다', () => {
    const html = render('리락쿠마', items);

    expect(html).toContain('aria-label="굿즈 필터"');
    expect(html).toContain('IP (0)');
    expect(html).toContain('타입 (0)');
    expect(text(html)).toContain('리락쿠마 (2)');
    expect(text(html)).toContain('메이플스토리 (1)');
    expect(text(html)).toContain('전체 › 3개 결과');
    expect(html).toContain('wc-filter-trigger');
  });

  it('관련성순이 기본이고 검색 정렬은 관련성·가격 2종뿐이다', () => {
    const html = render('리락쿠마', items);
    const options = [...html.matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((match) => `${match[1]}:${match[2]}`);

    expect(options).toEqual(['relevance:관련성순', 'price_asc:낮은 가격순', 'price_desc:높은 가격순']);
    expect(html).toMatch(/<option[^>]*value="relevance"[^>]*selected/);
  });

  it('URL 의 필터·정렬을 반영하고 필터 뒤 개수를 선택/전체로 보인다', () => {
    const html = render('리락쿠마', items, { params: { ip: 'rilakkuma', sort: 'price_asc' } });

    expect(text(html)).toContain('전체 › 2/3개 결과');
    expect(html.indexOf('리락쿠마 인형')).toBeLessThan(html.indexOf('리락쿠마 키링'));
    expect(html).not.toContain('리락쿠마 메이플 콜라보');
    expect(text(html)).toContain("'리락쿠마' 검색 결과 3개");
  });

  it('필터 결과가 비면 컬렉션의 초기화 안내를 쓰고 검색 빈 상태 칩은 내지 않는다', () => {
    const html = render('리락쿠마', items, { params: { min: '90000' } });

    expect(html).toContain('조건에 맞는 굿즈가 없어요');
    expect(html).not.toContain('추천 검색어');
  });

  it('위시 상태를 받으면 결과 카드에도 하트를 둔다', () => {
    const html = render('리락쿠마', items, { wishlist: { viewerId: 'viewer-1', goodIds: ['g2'] } });

    expect((html.match(/<button[^>]*class="wc-list-heart[ "]/g) ?? []).length).toBe(3);
    expect(html).toContain('aria-label="리락쿠마 인형 위시리스트에서 빼기"');
  });
});

describe('Search 페이지네이션 (SR-03)', () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => good(`g${index}`, { name: `keyring ${index}` }));

  it('숫자 셀에 현재 페이지를 표시하고 접근 이름을 붙인다', () => {
    const html = render('keyring', many(85), { page: 2 });

    expect(html).toContain('aria-label="검색 결과 페이지"');
    expect(html.match(/class="wc-pagination__cell"/g) ?? []).toHaveLength(3);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>2<\/a>/);
  });

  it('페이지 이동은 q 와 page 를 함께 실은 링크다', () => {
    const html = render('keyring', many(85), { page: 2 });

    expect(html).toMatch(/href="\/search\?q=keyring&(amp;)?page=3"/);
    expect(html).toContain('aria-label="이전 페이지"');
    expect(html).toContain('aria-label="마지막 페이지"');
  });

  it('1페이지에서는 이전 방향 화살표를 그리지 않는다', () => {
    const html = render('keyring', many(85), { page: 1 });

    expect(html).not.toContain('aria-label="이전 페이지"');
    expect(html).not.toContain('aria-label="첫 페이지"');
    expect(html).toContain('aria-label="다음 페이지"');
  });

  it('한 페이지뿐이면 페이저 자체가 없다', () => {
    expect(render('keyring', many(1))).not.toContain('wc-pagination');
  });

  it('필터·정렬을 페이지 링크에 그대로 싣고 1페이지 링크에는 page 를 빼 둔다', () => {
    const html = render('keyring', many(85), { page: 2, params: { type: '키링', sort: 'price_desc' } });

    expect(html).toMatch(/href="\/search\?q=keyring&(amp;)?type=%ED%82%A4%EB%A7%81&(amp;)?sort=price_desc&(amp;)?page=3"/);
    expect(html).toMatch(/href="\/search\?q=keyring&(amp;)?type=%ED%82%A4%EB%A7%81&(amp;)?sort=price_desc"/);
  });

  /* 데스크톱 10칸·모바일 5칸 고정 창 — 좁은 창 밖 셀은 모바일에서만 감춘다(11 §6 B8). */
  it('넓은 창 셀을 그리고 좁은 창 밖 셀에 모바일 숨김 표식을 단다', () => {
    const html = render('keyring', many(40 * 30), { page: 7 });
    const cells = [...html.matchAll(/<a[^>]*class="(wc-pagination__cell[^"]*)"[^>]*>(\d+)<\/a>/g)].map((match) => [match[2], match[1]]);

    expect(cells.map(([page]) => page)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(cells.filter(([, cls]) => cls === 'wc-pagination__cell').map(([page]) => page)).toEqual(['6', '7', '8', '9', '10']);
  });

  it('이전·다음은 창 단위로 건너뛰고 폭마다 목적지가 다르면 화살표를 나눠 그린다', () => {
    const html = render('keyring', many(40 * 30), { page: 7 });

    /* 데스크톱 창 1–10: 다음 = 11, 이전 = 첫 창이라 1. 모바일 창 6–10: 다음 = 11, 이전 = 5. */
    expect(html).toMatch(/<a aria-label="다음 페이지" class="wc-pagination__arrow" href="\/search\?q=keyring&(amp;)?page=11">/);
    expect(html).toMatch(/<a aria-label="이전 페이지" class="wc-pagination__arrow is-wide" href="\/search\?q=keyring">/);
    expect(html).toMatch(/<a aria-label="이전 페이지" class="wc-pagination__arrow is-narrow" href="\/search\?q=keyring&(amp;)?page=5">/);
  });

  /* 모바일(767px 이하는 is-wide 를 감춘다)은 한 줄이어야 한다 — 중간 창에서 « ‹ … 5칸 … › » 를 다 그리면
     468px 라 343 폭에서 두 줄로 깨졌다(l4-ui-3). 모바일에 남는 항목은 창 단위 ‹ › 와 5칸뿐이고, 처음·마지막과
     생략 부호는 데스크톱 전용이다. 폭 예산은 CSS 계약(화살표 44·셀 36·모바일 간격 2)으로 센다. */
  it('모바일 중간 창은 ‹ + 5칸 + › 한 줄이고 처음·마지막·생략 부호는 데스크톱에만 있다', () => {
    const items = (page: number) => {
      const html = render('keyring', many(40 * 12), { page });
      const nav = html.slice(html.indexOf('<nav aria-label="검색 결과 페이지"'), html.indexOf('</nav>'));
      return [...nav.matchAll(/<(a|span)([^>]*)>([^<]*)<\/\1>/g)].map(([, , attrs, body]) => ({
        cls: /class="([^"]*)"/.exec(attrs)?.[1] ?? '',
        label: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? body,
        page: /page=(\d+)/.exec(attrs)?.[1] ?? (/href=/.test(attrs) ? '1' : ''),
      }));
    };
    const mobile = (page: number) => items(page).filter((item) => !item.cls.split(' ').includes('is-wide'));
    const width = (list: { cls: string }[]) => list.reduce((sum, item) => sum + (item.cls.includes('__arrow') ? 44 : 36), 0) + 2 * (list.length - 1);

    for (const page of [6, 7, 10]) {
      const visible = mobile(page);
      expect(visible.map((item) => `${item.label}→${item.page}`)).toEqual([
        '이전 페이지→5', '6페이지→6', '7페이지→7', '8페이지→8', '9페이지→9', '10페이지→10', '다음 페이지→11',
      ]);
      expect(width(visible)).toBeLessThanOrEqual(288);
    }
    expect(mobile(1).map((item) => item.label)).toEqual(['1페이지', '2페이지', '3페이지', '4페이지', '5페이지', '다음 페이지']);
    expect(mobile(12).map((item) => `${item.label}→${item.page}`)).toEqual(['이전 페이지→10', '11페이지→11', '12페이지→12']);

    const all = items(7);
    expect(all.filter((item) => item.label === '첫 페이지' || item.label === '마지막 페이지').map((item) => item.cls))
      .toEqual(['wc-pagination__arrow is-wide', 'wc-pagination__arrow is-wide']);
    expect(all.filter((item) => item.cls.includes('__ellipsis')).map((item) => item.cls)).toEqual(['wc-pagination__ellipsis is-wide']);
  });
});

describe('Search 빈 상태', () => {
  const html = render('없는말', []);

  it('결과가 없으면 회복 카피와 추천 칩을 함께 낸다', () => {
    expect(text(html)).toContain("'없는말'에 맞는 결과가 없어요");
    expect(html).toContain('다른 검색어로 시도해 보세요.');
    expect(html).toContain('추천 검색어');
    for (const term of SUGGESTED_SEARCH_TERMS) {
      expect(html).toContain(`>${term}</a>`);
    }
  });

  it('추천 칩은 실제 검색 결과로 이어진다', () => {
    expect(html).toContain(`href="/search?q=${encodeURIComponent(SUGGESTED_SEARCH_TERMS[0])}"`);
  });

  /* 결과가 없으면 레퍼런스처럼 사이드바를 그리지 않고, 모바일에서도 재검색 인풋을 남긴다. */
  it('사이드바 없이 제목·인풋을 남긴다', () => {
    expect(html).not.toContain('aria-label="굿즈 필터"');
    expect(html).toContain('<div class="wc-search-results__head">');
  });
});

describe('Search 비굿즈 그룹', () => {
  it('IP 검색 결과는 현재 공개 슬러그로 연결한다', () => {
    const html = render('리락쿠마', [], {
      groups: [{ kind: 'ip', label: 'IP', results: [{ ...result('ip', 'rilakkuma', '리락쿠마'), ipPublicSlug: 'relax-world' }] }],
    });
    expect(html).toContain('href="/ip/relax-world"');
    expect(html).not.toContain('href="/ip/rilakkuma"');
  });
  const html = render('리락쿠마', [good('g1', { name: '리락쿠마 g1' })], {
    groups: [
      { kind: 'ip', label: 'IP', results: [result('ip', 'rilakkuma', '리락쿠마')] },
      { kind: 'good', label: '굿즈', results: [result('good', 'g9', '스냅샷 굿즈')] },
      { kind: 'card', label: '카드', results: [result('card', 'c1', '리락쿠마 카드')] },
      { kind: 'post', label: '포스트', results: [result('post', 'p1', '리락쿠마 포스트')] },
      { kind: 'tag', label: '태그', results: [result('tag', '리락쿠마덕질', '#리락쿠마덕질')] },
    ],
  });

  it('각 결과를 실제 상세 경로로 보낸다', () => {
    expect(html).toContain('href="/ip/rilakkuma"');
    expect(html).toContain('href="/binder"');
    expect(html).toContain('href="/community"');
    expect(html).toContain(`href="/search?q=${encodeURIComponent('리락쿠마덕질')}"`);
  });

  it('스냅샷의 굿즈 그룹은 자체 결과가 대체한다', () => {
    expect(html).not.toContain('스냅샷 굿즈');
    expect(html).toContain('리락쿠마 g1');
  });
});
