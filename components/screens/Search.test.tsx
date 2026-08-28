import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Good } from '@/lib/data';
import type { GoodsSearchResult } from '@/lib/search-goods';
import type { SearchResult, SearchResultKind, SearchSnapshot } from '@/lib/search';
import { SUGGESTED_SEARCH_TERMS } from '@/lib/search-terms';
import { Search, type SearchProps } from './Search';

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

const IPS = [
  { id: 'rilakkuma', title: '리락쿠마' },
] as unknown as SearchProps['ips'];

const goodsResultOf = (overrides: Partial<GoodsSearchResult> = {}): GoodsSearchResult => ({
  items: [],
  total: 0,
  page: 1,
  pageCount: 1,
  ...overrides,
});

describe('Search 헤딩과 굿즈 그리드', () => {
  const items = [good('g1', { name: '리락쿠마 키링' }), good('g2', { name: '리락쿠마 인형' })];
  const html = renderToStaticMarkup(
    <Search
      ips={IPS}
      goodsResult={goodsResultOf({ items, total: 2 })}
      query="리락쿠마"
      snapshot={snapshotOf('리락쿠마', [])}
    />,
  );

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
});

describe('Search 페이지네이션', () => {
  const paged = (page: number) => renderToStaticMarkup(
    <Search
      ips={IPS}
      goodsResult={goodsResultOf({ items: [good('g1')], total: 85, page, pageCount: 3 })}
      query="keyring"
      snapshot={snapshotOf('keyring', [])}
    />,
  );

  it('숫자 셀에 현재 페이지를 표시하고 접근 이름을 붙인다', () => {
    const html = paged(2);

    expect(html).toContain('aria-label="검색 결과 페이지"');
    expect(html.match(/class="wc-pagination__cell"/g) ?? []).toHaveLength(3);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>2<\/a>/);
  });

  it('페이지 이동은 q 와 page 를 함께 실은 링크다', () => {
    const html = paged(2);

    expect(html).toMatch(/href="\/search\?q=keyring&(amp;)?page=3"/);
    expect(html).toContain('aria-label="이전 페이지"');
    expect(html).toContain('aria-label="마지막 페이지"');
  });

  it('1페이지에서는 이전 방향 화살표를 그리지 않는다', () => {
    const html = paged(1);

    expect(html).not.toContain('aria-label="이전 페이지"');
    expect(html).not.toContain('aria-label="첫 페이지"');
    expect(html).toContain('aria-label="다음 페이지"');
  });

  it('한 페이지뿐이면 페이저 자체가 없다', () => {
    const html = renderToStaticMarkup(
      <Search
        ips={IPS}
        goodsResult={goodsResultOf({ items: [good('g1')], total: 1 })}
        query="keyring"
        snapshot={snapshotOf('keyring', [])}
      />,
    );

    expect(html).not.toContain('wc-pagination');
  });
});

describe('Search 빈 상태', () => {
  const html = renderToStaticMarkup(
    <Search ips={IPS} goodsResult={goodsResultOf()} query="없는말" snapshot={snapshotOf('없는말', [])} />,
  );

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
});

describe('Search 비굿즈 그룹', () => {
  const html = renderToStaticMarkup(
    <Search
      ips={IPS}
      goodsResult={goodsResultOf({ items: [good('g1')], total: 1 })}
      query="리락쿠마"
      snapshot={snapshotOf('리락쿠마', [
        { kind: 'ip', label: 'IP', results: [result('ip', 'rilakkuma', '리락쿠마')] },
        { kind: 'good', label: '굿즈', results: [result('good', 'g9', '스냅샷 굿즈')] },
        { kind: 'card', label: '카드', results: [result('card', 'c1', '리락쿠마 카드')] },
        { kind: 'post', label: '포스트', results: [result('post', 'p1', '리락쿠마 포스트')] },
        { kind: 'tag', label: '태그', results: [result('tag', '리락쿠마덕질', '#리락쿠마덕질')] },
      ])}
    />,
  );

  it('각 결과를 실제 상세 경로로 보낸다', () => {
    expect(html).toContain('href="/ip/rilakkuma"');
    expect(html).toContain('href="/binder"');
    expect(html).toContain('href="/community"');
    expect(html).toContain(`href="/search?q=${encodeURIComponent('리락쿠마덕질')}"`);
  });

  it('스냅샷의 굿즈 그룹은 자체 결과가 대체한다', () => {
    expect(html).not.toContain('스냅샷 굿즈');
    expect(html).toContain('굿즈 g1');
  });
});
