'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { CollectionBrowser } from '@/components/shop/CollectionBrowser';
import { shopQueryString } from '@/components/shop/collection-filters';
import { EmptyState } from '@/components/wc/EmptyState';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { publicIpHref } from '@/lib/ip-identity';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { SEARCH_PAGE_WINDOW, searchPageWindow, type SearchGoodsCollection } from '@/lib/search-goods';
import type { SearchResult, SearchResultGroup, SearchSnapshot } from '@/lib/search';
import { SUGGESTED_SEARCH_TERMS } from '@/lib/search-terms';
import { SHOP_VIEW_SORTS, type ShopListQuery } from '@/lib/shop-catalog';

export interface SearchProps {
  /** 통합 검색 스냅샷. 굿즈 그룹은 쓰지 않는다 — goods 가 대체한다. */
  snapshot: SearchSnapshot;
  /** 필터·정렬이 걸린 굿즈 결과 한 페이지(lib/search-goods selectSearchGoods). */
  goods: SearchGoodsCollection;
  /** 정규화된 검색어. */
  query: string;
  /** 사이드바·정렬 상태(view 'search'). */
  listQuery: ShopListQuery;
  /** 목록 하트의 초기 상태. 생략하면 하트를 그리지 않는다. */
  wishlist?: ListingWishlist | null;
  /**
   * 빈 검색·0건 화면의 추천 칩. 검색 오버레이와 같은 운영 추천 검색어(`resolveSuggestedSearchTerms` — 운영 목록이 없으면
   * 코드 상수)다 — 사이트에 서로 다른 두 '추천 검색어'가 보이지 않게 한다(11 CH-10, l8b-qa-2). 생략하면 코드 상수.
   */
  suggestedTerms?: readonly string[];
}

/** 검색어 → 필터·정렬 → 페이지 순서로 싣는다. 검색어는 칩 링크와 같은 인코딩(encodeURIComponent)을 쓴다. */
export function searchResultsHref(query: string, listQuery: ShopListQuery | null, page: number) {
  const filters = listQuery ? shopQueryString(listQuery) : '';
  return `/search?q=${encodeURIComponent(query)}${filters ? `&${filters}` : ''}${page > 1 ? `&page=${page}` : ''}`;
}

/** 결과 클릭은 목록이 아니라 실제 상세로 간다 — 구 화면의 '굿즈 → /shop' 은 버그였다. */
function resultHref(result: SearchResult) {
  if (result.kind === 'ip') return publicIpHref({ id: result.ipId ?? result.id, publicSlug: result.ipPublicSlug });
  if (result.kind === 'card') return '/binder';
  if (result.kind === 'post') return '/community';
  if (result.kind === 'tag') return `/search?q=${encodeURIComponent(result.id)}`;
  return `/shop/${result.id}`;
}

function SuggestedTerms({ terms }: { terms: readonly string[] }) {
  return (
    <div className="wc-search__chips">
      <p className="wc-search__chips-label">추천 검색어</p>
      {terms.map((term) => (
        <Link key={term} className="wc-search__chip" href={searchResultsHref(term, null, 1)}>{term}</Link>
      ))}
    </div>
  );
}

/*
 * 숫자 페이지네이션(R-03 §2.4 · 11 §6 B8 · SR-03) — 데스크톱 10칸·767px 이하 5칸의 고정 창이고,
 * 이전·다음은 창 단위로 건너뛴다. 셀은 넓은 창 하나만 그리고 좁은 창 밖의 셀은 모바일에서 감춘다.
 * 두 창의 화살표 목적지가 다를 때만 화살표를 둘 그려 폭마다 하나씩 보인다(감춘 쪽은 접근성 트리에서도 빠진다).
 *
 * 모바일은 한 줄이어야 한다 — 44px 화살표 넷(« ‹ › »)과 생략 부호 둘을 5칸에 더하면 468px 라 343 폭에서 두 줄로
 * 깨진다. 처음·마지막과 생략 부호는 넓은 창(768px 이상)에만 두고 모바일은 창 단위 ‹ › 만 남긴다. 첫 창의 ‹ 는
 * 1페이지로, 마지막 창의 › 는 마지막 페이지로 가므로(searchPageWindow) 모바일에서도 모든 페이지에 닿는다.
 */
function Pagination({ hrefFor, page, pageCount }: { hrefFor: (page: number) => string; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;

  const wide = searchPageWindow(page, pageCount, SEARCH_PAGE_WINDOW.wide);
  const narrow = searchPageWindow(page, pageCount, SEARCH_PAGE_WINDOW.narrow);
  const cells = Array.from({ length: wide.end - wide.start + 1 }, (_, index) => wide.start + index);
  const arrow = (target: number | null, label: string, glyph: string, scope?: 'wide' | 'narrow') => (
    target === null ? null : (
      <Link
        key={`${label}-${scope ?? 'all'}`}
        aria-label={label}
        className={`wc-pagination__arrow${scope ? ` is-${scope}` : ''}`}
        href={hrefFor(target)}
      >
        {glyph}
      </Link>
    )
  );
  const windowArrow = (wideTarget: number | null, narrowTarget: number | null, label: string, glyph: string) => (
    wideTarget === narrowTarget
      ? arrow(wideTarget, label, glyph)
      : [arrow(wideTarget, label, glyph, 'wide'), arrow(narrowTarget, label, glyph, 'narrow')]
  );
  const ellipsis = (shown: boolean, key: string) => (
    shown ? <span key={key} aria-hidden className="wc-pagination__ellipsis is-wide">…</span> : null
  );

  return (
    <nav aria-label="검색 결과 페이지" className="wc-pagination">
      {page > 1 ? arrow(1, '첫 페이지', '«', 'wide') : null}
      {windowArrow(wide.prev, narrow.prev, '이전 페이지', '‹')}
      {ellipsis(wide.start > 1, 'before')}
      {cells.map((cell) => (
        <Link
          key={cell}
          aria-current={cell === page ? 'page' : undefined}
          aria-label={`${cell}페이지`}
          className={`wc-pagination__cell${cell < narrow.start || cell > narrow.end ? ' is-wide' : ''}`}
          href={hrefFor(cell)}
        >
          {cell}
        </Link>
      ))}
      {ellipsis(wide.end < pageCount, 'after')}
      {windowArrow(wide.next, narrow.next, '다음 페이지', '›')}
      {page < pageCount ? arrow(pageCount, '마지막 페이지', '»', 'wide') : null}
    </nav>
  );
}

function AsideGroup({ group }: { group: SearchResultGroup }) {
  const headingId = `search-group-${group.kind}`;

  return (
    <section aria-labelledby={headingId} className="wc-search-results__group">
      <SectionHeading as="h3" id={headingId} title={`${group.label} ${group.results.length}개`} />
      <ul className="wc-search-results__group-list">
        {group.results.map((result) => (
          <li key={`${group.kind}-${result.id}`}>
            <Link className="wc-search-results__row" href={resultHref(result)}>
              {result.label}
              {result.subtitle ? (
                <span className="wc-search-results__row-sub">{result.subtitle}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/*
 * 검색 결과 (R-03 §2, LFS 패리티 2차 L4 · SR-01~03).
 * 굿즈는 굿즈샵과 같은 컬렉션 본문(사이드바·'전체 › N개 결과'·관련성 정렬·모바일 필터)으로 그리고,
 * IP·카드·포스트 같은 통합 검색 결과는 그 아래 보조 섹션으로 유지한다(커뮤니티 노출 게이트 그대로).
 * 제목과 재검색 인풋은 데스크톱 한 줄이다. 결과 그리드가 있는 모바일에서는 레퍼런스처럼 둘을 걷어
 * 내고(제목은 읽기 전용으로 남긴다) 필터·정렬 줄로 바로 시작한다.
 */
export function Search({ goods, listQuery, query, snapshot, wishlist, suggestedTerms = SUGGESTED_SEARCH_TERMS }: SearchProps) {
  /* 굿즈 그룹만 자체 결과로 대체하고 나머지 그룹은 보조 섹션으로 남긴다. */
  const asideGroups = snapshot.groups.filter((group) => group.kind !== 'good');
  const hasQuery = query.length > 0;
  const total = goods.result.total;

  return (
    <div className="wc-root wc-search-results">
      <GoodsSalePeriodRefresh goods={goods.result.goods} />
      <div className="wc-container">
        <div className={`wc-search-results__head${total > 0 ? ' has-results' : ''}`}>
          <h1 className="wc-search-results__heading">
            {hasQuery ? (
              <>
                <strong>{`'${query}'`}</strong>
                {` 검색 결과 `}
                <strong>{`${total}개`}</strong>
              </>
            ) : (
              '무엇을 찾고 있나요?'
            )}
          </h1>
          {/* JS 없이도 성립해야 하는 화면이라 폼 제출로만 질의를 바꾼다. 새 검색어는 필터를 비우고 1페이지부터다. */}
          <form action="/search" className="wc-search-results__form" method="get" role="search">
            <button aria-label="검색" className="wc-search-results__submit" type="submit">
              <Icon name="search" size={20} />
            </button>
            <input
              aria-label="검색어"
              className="wc-search-results__input"
              defaultValue={query}
              name="q"
              placeholder={COMMUNITY_ENABLED ? 'IP · 굿즈 · 카드 · 포스트 통합 검색' : 'IP · 굿즈 · 카드 통합 검색'}
              type="search"
            />
          </form>
        </div>

        {total > 0 ? (
          <CollectionBrowser
            countNoun="결과"
            hrefFor={(next) => searchResultsHref(query, next, 1)}
            pager={(
              <Pagination
                hrefFor={(page) => searchResultsHref(query, listQuery, page)}
                page={goods.page}
                pageCount={goods.pageCount}
              />
            )}
            query={listQuery}
            result={goods.result}
            sorts={SHOP_VIEW_SORTS.search}
            wishlist={wishlist}
          />
        ) : (
          /* 레퍼런스는 빈 결과에서 회복 동선을 전부 걷어냈다(R-03 §4-7). 추천 칩을 다시 붙인다. */
          <div className="wc-search-results__empty">
            <EmptyState
              description={hasQuery
                ? '다른 검색어로 시도해 보세요.'
                /* 포스트는 커뮤니티 임시 비공개 동안 결과에서 빠지므로 안내에서도 뺀다. */
                : COMMUNITY_ENABLED ? '굿즈·IP·카드·포스트를 한 번에 찾아드려요.' : '굿즈·IP·카드를 한 번에 찾아드려요.'}
              title={hasQuery ? `'${query}'에 맞는 결과가 없어요` : '검색어를 입력해 주세요'}
              titleAs="h2"
            />
            <SuggestedTerms terms={suggestedTerms} />
          </div>
        )}

        {asideGroups.length > 0 ? (
          <div className="wc-search-results__aside-groups">
            <SectionHeading title="굿즈 외 결과" />
            {asideGroups.map((group) => <AsideGroup group={group} key={group.kind} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
