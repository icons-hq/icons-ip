import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/wc/EmptyState';
import { ProductCard } from '@/components/wc/ProductCard';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import type { Ip } from '@/lib/data';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { GoodsSearchResult } from '@/lib/search-goods';
import type { SearchResult, SearchResultGroup, SearchSnapshot } from '@/lib/search';
import { SUGGESTED_SEARCH_TERMS } from '@/lib/search-terms';

export interface SearchProps {
  /** 통합 검색 스냅샷. 굿즈 그룹은 쓰지 않는다 — goodsResult 가 대체한다. */
  snapshot: SearchSnapshot;
  goodsResult: GoodsSearchResult;
  query: string;
  /** 카드 브랜드 줄(IP 제목) 룩업용 — 굿즈샵 그리드와 같은 카드 anatomy 를 지킨다. */
  ips: Ip[];
}

/* 데스크톱 페이저에 한 번에 노출할 숫자 셀 수 (R-03 §2.4 — 최대 10개 + 말줄임). */
const PAGE_WINDOW = 10;

function searchHref(query: string, page: number) {
  const base = `/search?q=${encodeURIComponent(query)}`;
  return page <= 1 ? base : `${base}&page=${page}`;
}

/** 결과 클릭은 목록이 아니라 실제 상세로 간다 — 구 화면의 '굿즈 → /shop' 은 버그였다. */
function resultHref(result: SearchResult) {
  if (result.kind === 'ip') return `/ip/${result.ipId ?? result.id}`;
  if (result.kind === 'card') return '/binder';
  if (result.kind === 'post') return '/community';
  if (result.kind === 'tag') return `/search?q=${encodeURIComponent(result.id)}`;
  return `/shop/${result.id}`;
}

/* 현재 페이지를 가운데 두고 최대 PAGE_WINDOW 개를 자른다. 양 끝에서는 창이 안쪽으로
   밀려 항상 같은 개수를 유지한다 — 마지막 페이지에서 셀이 하나만 남는 일이 없다. */
function pageWindow(page: number, pageCount: number) {
  const size = Math.min(PAGE_WINDOW, pageCount);
  const start = Math.min(Math.max(page - Math.floor(size / 2), 1), pageCount - size + 1);
  return Array.from({ length: size }, (_, index) => start + index);
}

function SuggestedTerms() {
  return (
    <div className="wc-search__chips">
      <p className="wc-search__chips-label">추천 검색어</p>
      {SUGGESTED_SEARCH_TERMS.map((term) => (
        <Link key={term} className="wc-search__chip" href={searchHref(term, 1)}>{term}</Link>
      ))}
    </div>
  );
}

function Pagination({ page, pageCount, query }: { page: number; pageCount: number; query: string }) {
  if (pageCount <= 1) return null;

  const cells = pageWindow(page, pageCount);
  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  return (
    <nav aria-label="검색 결과 페이지" className="wc-pagination">
      {/* 첫/마지막 페이지에서 제자리로 돌아오는 화살표는 죽은 링크라 아예 그리지 않는다. */}
      {hasPrev ? (
        <>
          <Link aria-label="첫 페이지" className="wc-pagination__arrow" href={searchHref(query, 1)}>«</Link>
          <Link aria-label="이전 페이지" className="wc-pagination__arrow" href={searchHref(query, page - 1)}>‹</Link>
        </>
      ) : null}
      {cells[0] > 1 ? <span aria-hidden className="wc-pagination__ellipsis">…</span> : null}
      {cells.map((cell) => (
        <Link
          key={cell}
          aria-current={cell === page ? 'page' : undefined}
          aria-label={`${cell}페이지`}
          className="wc-pagination__cell"
          href={searchHref(query, cell)}
        >
          {cell}
        </Link>
      ))}
      {cells[cells.length - 1] < pageCount ? (
        <span aria-hidden className="wc-pagination__ellipsis">…</span>
      ) : null}
      {hasNext ? (
        <>
          <Link aria-label="다음 페이지" className="wc-pagination__arrow" href={searchHref(query, page + 1)}>›</Link>
          <Link aria-label="마지막 페이지" className="wc-pagination__arrow" href={searchHref(query, pageCount)}>»</Link>
        </>
      ) : null}
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

export function Search({ goodsResult, ips, query, snapshot }: SearchProps) {
  const ipTitleById = new Map(ips.map((ip) => [ip.id, ip.title]));
  /* 굿즈 그룹만 자체 결과로 대체하고 나머지 그룹은 보조 섹션으로 남긴다. */
  const asideGroups = snapshot.groups.filter((group) => group.kind !== 'good');
  const hasQuery = query.length > 0;

  return (
    <div className="wc-root wc-search-results">
      <div className="wc-container">
        <h1 className="wc-search-results__heading">
          {hasQuery ? (
            <>
              <strong>{`'${query}'`}</strong>
              {` 검색 결과 `}
              <strong>{`${goodsResult.total}개`}</strong>
            </>
          ) : (
            '무엇을 찾고 있나요?'
          )}
        </h1>
        {/* JS 없이도 성립해야 하는 화면이라 폼 제출로만 질의를 바꾼다. 인풋 지면은 오버레이와 공유한다. */}
        <form
          action="/search"
          className="wc-search-results__form wc-search__form"
          method="get"
          role="search"
        >
          <input
            aria-label="검색어"
            className="wc-search__input"
            defaultValue={query}
            name="q"
            placeholder={COMMUNITY_ENABLED ? 'IP · 굿즈 · 카드 · 포스트 통합 검색' : 'IP · 굿즈 · 카드 통합 검색'}
            type="search"
          />
          <button aria-label="검색" className="wc-icon-btn" type="submit">
            <Icon name="search" size={24} />
          </button>
        </form>

        {goodsResult.total > 0 ? (
          <>
            <div className="wc-product-grid wc-search-results__grid">
              {goodsResult.items.map((good) => (
                <ProductCard
                  key={good.id}
                  badges={goodDisplayBadges(good)}
                  brand={ipTitleById.get(good.ip) ?? null}
                  compareAtPrice={good.compareAtPrice}
                  href={`/shop/${good.id}`}
                  imageBackground={good.img}
                  name={good.name}
                  price={good.price}
                  soldOut={good.stock === 'soldout' || good.stockQty <= 0}
                />
              ))}
            </div>
            <Pagination page={goodsResult.page} pageCount={goodsResult.pageCount} query={query} />
          </>
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
            <SuggestedTerms />
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
