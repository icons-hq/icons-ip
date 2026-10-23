'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import { EmptyState } from '@/components/wc/EmptyState';
import { ProductCard } from '@/components/wc/ProductCard';
import { ViewMore } from '@/components/wc/ViewMore';
import { WcButton } from '@/components/wc/WcButton';
import { ListingWishHeart } from '@/components/shop/ListingWishHeart';
import {
  EMPTY_SHOP_FILTER_DRAFT,
  setDraftPriceRange,
  shopFilterDraftFromQuery,
  toggleDraftValue,
  type ShopFilterDraft,
} from '@/components/shop/collection-filters';
import { krw } from '@/lib/format';
import { goodDetailHref } from '@/lib/goods-display';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { listingWishSet, type ListingWishlist } from '@/lib/listing-wishlist';
import {
  SHOP_PAGE_SIZE,
  SHOP_SORT_LABELS,
  type ShopFacetOption,
  type ShopListQuery,
  type ShopListResult,
  type ShopSort,
} from '@/lib/shop-catalog';

/*
 * 컬렉션 본문 — 필터 사이드바 + 수량·정렬 줄 + 212 카드 그리드 + VIEW MORE/페이지 (R-03 §1·§2, L4).
 * 굿즈샵·NEW·BEST·카테고리 전시(Shop), 검색 결과(Search), 온라인 팝업 IP관(IpDetail)이 같은 본문을 쓴다.
 *
 * 상태는 전부 URL 에 있다. 서버 페이지가 searchParams 를 파싱해 목록까지 계산해 내려주고, 이 본문은
 * 컨트롤이 만들 "다음 URL"만 조립한다(hrefFor). 그래서 필터가 걸린 목록을 그대로 공유·복원할 수 있고
 * 뒤로가기가 필터 이력이 된다.
 *
 * 데스크톱 사이드바는 즉시 적용, 모바일 바텀시트는 draft 를 모아 [적용]에서 한 번에 반영한다
 * (R-03 §1.3·§1.8 의 갈린 패턴 — 모바일 지연 적용은 DESIGN §5 의 의도적 보정).
 * 스코프 자체가 빈 목록(result.total 0)의 안내는 화면마다 다르므로 부모가 맡는다.
 */

export interface CollectionBrowserProps {
  query: ShopListQuery;
  result: ShopListResult;
  /** 이 목록이 고르게 하는 정렬. 서버 페이지네이션 목록은 DB 가 받는 4종만 넘긴다. */
  sorts: readonly ShopSort[];
  /** 수량 줄의 명사 — 굿즈샵은 '굿즈', 검색은 '결과'(R-03 §2.2 '전체 › N개 결과'). */
  countNoun: string;
  /** 컨트롤이 만들 다음 URL. 지금 URL 과 같으면 이동하지 않는다. */
  hrefFor: (query: ShopListQuery) => string;
  onQueryChange?: (query: ShopListQuery) => void;
  /** 숫자 페이지네이션(검색). 있으면 VIEW MORE 대신 그리고, result.goods 를 자르지 않고 그대로 그린다. */
  pager?: ReactNode;
  /** 서버가 20개씩 이어 주는 목록(카테고리 전시). 없으면 받은 목록을 20개씩 펼친다. */
  paging?: { loading: boolean; error?: string; hasMore?: boolean; onLoadMore: () => void; onReload?: () => void };
  /** IP관은 스코프가 이미 IP 하나라 IP 그룹을 그리지 않는다. */
  showIpFacet?: boolean;
  /** 목록 하트의 초기 상태. null·생략이면(어드민 미리보기·mock) 하트를 그리지 않는다. */
  wishlist?: ListingWishlist | null;
  listSurface?: 'standard' | 'best';
  sheetDescription?: string;
  /** A same-origin embedded preview owns its overlay document. */
  overlayContainer?: HTMLElement;
}

const SHEET_TABS = [
  { id: 'categories', label: '카테고리' },
  { id: 'ips', label: 'IP' },
  { id: 'types', label: '타입' },
  { id: 'price', label: '가격' },
] as const;

type SheetTabId = (typeof SHEET_TABS)[number]['id'];

function FilterCheckList({
  name,
  onToggle,
  options,
  selected,
}: {
  name: string;
  onToggle: (value: string) => void;
  options: ShopFacetOption[];
  selected: readonly string[];
}) {
  return (
    <div className="wc-filter-group__options">
      {/* 네이티브 input 은 지우지 않고 커스텀 마크 위에 겹쳐 둔다 — 체크 상태·포커스·키보드가
          그대로 살아 있어야 한다(계약 §5). 시각 처리는 wc-catalog.css 몫이다. */}
      {options.map((option) => (
        <label key={option.value} className="wc-filter-group__option" style={option.depth ? { paddingInlineStart: (option.depth - 1) * 12 } : undefined}>
          <input
            checked={selected.includes(option.value)}
            name={name}
            onChange={() => onToggle(option.value)}
            type="checkbox"
            value={option.value}
          />
          <span aria-hidden className="wc-filter-group__checkbox" />
          <span>
            {option.label}
            {' '}
            <span className="wc-filter-group__option-count">{`(${option.count})`}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function PriceSlider({
  idPrefix,
  onCommit,
  onDraft,
  priceCeil,
  value,
}: {
  idPrefix: string;
  onCommit: () => void;
  onDraft: (bounds: { min: number; max: number }) => void;
  priceCeil: number;
  value: { min: number | null; max: number | null };
}) {
  const low = value.min ?? 0;
  const high = value.max ?? priceCeil;
  /* 상한이 0 이면(스코프 최고가 0) 트랙이 성립하지 않으니 스텝만 1 로 두고 그린다. */
  const step = Math.max(1, Math.round(priceCeil / 100));

  return (
    <div className="wc-price-slider">
      <div className="wc-price-slider__track">
        <input
          aria-label="최소 가격"
          className="wc-price-slider__range"
          id={`${idPrefix}-price-min`}
          max={priceCeil}
          min={0}
          onBlur={onCommit}
          onChange={(event) => onDraft({ min: Number(event.target.value), max: high })}
          onKeyUp={onCommit}
          onPointerUp={onCommit}
          step={step}
          type="range"
          value={low}
        />
        <input
          aria-label="최대 가격"
          className="wc-price-slider__range"
          id={`${idPrefix}-price-max`}
          max={priceCeil}
          min={0}
          onBlur={onCommit}
          onChange={(event) => onDraft({ min: low, max: Number(event.target.value) })}
          onKeyUp={onCommit}
          onPointerUp={onCommit}
          step={step}
          type="range"
          value={high}
        />
      </div>
      <p className="wc-price-slider__label">{`${krw(low)} ~ ${krw(high)}`}</p>
    </div>
  );
}

export function CollectionBrowser({
  countNoun,
  hrefFor,
  listSurface = 'standard',
  onQueryChange,
  overlayContainer,
  pager,
  paging,
  query,
  result,
  sheetDescription = '원하는 IP와 가격을 골라보세요.',
  showIpFacet = true,
  sorts,
  wishlist,
}: CollectionBrowserProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  /* 질의가 바뀌면 표시 개수·슬라이더 위치는 처음으로 돌아가야 한다. effect 로 되돌리면
     한 프레임 동안 옛 상태가 그려지므로, 질의 URL 을 키로 들고 렌더 중에 판별한다. */
  const queryKey = hrefFor(query);
  const [shown, setShown] = useState({ key: queryKey, count: SHOP_PAGE_SIZE });
  const [price, setPrice] = useState({ key: queryKey, min: query.priceMin, max: query.priceMax });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTabId>(showIpFacet ? 'ips' : 'types');
  const [draft, setDraft] = useState<ShopFilterDraft>(() => shopFilterDraftFromQuery(query));

  const closeSheet = () => setSheetOpen(false);
  useOverlayA11y({ open: sheetOpen, onClose: closeSheet, panelRef });

  const visibleCount = shown.key === queryKey ? shown.count : SHOP_PAGE_SIZE;
  const priceValue = price.key === queryKey
    ? { min: price.min, max: price.max }
    : { min: query.priceMin, max: query.priceMax };

  const navigate = (next: ShopListQuery) => {
    /* 같은 URL 로의 재진입은 서버 왕복만 만들고 목록은 그대로다 — 슬라이더를 만졌다 제자리에
       놓는 흔한 조작에서 특히 잘 발생한다. */
    if (hrefFor(next) === queryKey) return;
    if (onQueryChange) { onQueryChange(next); return; }
    router.push(hrefFor(next), { scroll: false });
  };
  const applyFilters = (next: ShopFilterDraft) => navigate({ ...query, ...next, categories: next.categories ?? [] });
  const currentDraft = shopFilterDraftFromQuery(query);

  /* 카드 브랜드 줄은 IP 제목이다. IP facet 은 스코프의 모든 IP 를 담으므로 그 라벨을 쓴다. */
  const brandByIpId = new Map(result.ipFacets.map((facet) => [facet.value, facet.label]));
  const wished = listingWishSet(wishlist);
  /* 검색처럼 서버가 이미 한 페이지만 잘라 준 목록과 서버가 이어 주는 목록은 그대로, 나머지는 20개씩 편다. */
  const visibleGoods = pager || paging ? result.goods : result.goods.slice(0, visibleCount);
  const hasFilters = Boolean(query.categories?.length) || (showIpFacet && query.ips.length > 0)
    || query.types.length > 0
    || query.priceMin !== null
    || query.priceMax !== null;
  const filterCount = (query.categories?.length ?? 0) + (showIpFacet ? query.ips.length : 0) + query.types.length
    + Number(query.priceMin !== null || query.priceMax !== null);
  const sheetTabs = SHEET_TABS.filter((tab) => (tab.id !== 'categories' || result.categoryFacets?.length) && (tab.id !== 'ips' || showIpFacet));
  const hasMore = paging ? paging.hasMore ?? result.goods.length < result.filteredTotal : !pager && visibleCount < result.filteredTotal;

  return (
    <>
      <div className="wc-collection__layout">
        {/* 데스크톱 사이드바는 체크 즉시 URL 을 갱신한다 — 적용 버튼이 없는 쪽 패턴(R-03 §1.3). */}
        <aside aria-label="굿즈 필터" className="wc-collection__sidebar">
          {Boolean(result.categoryFacets?.length) && <details className="wc-filter-group" open>
            <summary className="wc-filter-group__summary">{`카테고리 (${query.categories?.length ?? 0})`}</summary>
            <FilterCheckList name="wc-shop-category" onToggle={(value) => applyFilters(toggleDraftValue(currentDraft, 'categories', value))} options={result.categoryFacets!} selected={query.categories ?? []} />
          </details>}
          {showIpFacet ? (
            <details className="wc-filter-group" open>
              <summary className="wc-filter-group__summary">{`IP (${query.ips.length})`}</summary>
              <FilterCheckList
                name="wc-shop-ip"
                onToggle={(value) => applyFilters(toggleDraftValue(currentDraft, 'ips', value))}
                options={result.ipFacets}
                selected={query.ips}
              />
            </details>
          ) : null}
          <details className="wc-filter-group" open>
            <summary className="wc-filter-group__summary">{`타입 (${query.types.length})`}</summary>
            <FilterCheckList
              name="wc-shop-type"
              onToggle={(value) => applyFilters(toggleDraftValue(currentDraft, 'types', value))}
              options={result.typeFacets}
              selected={query.types}
            />
          </details>
          <details className="wc-filter-group" open>
            <summary className="wc-filter-group__summary">가격</summary>
            {/* 슬라이더는 드래그 한 눈금마다 라우팅하면 서버 왕복이 폭주한다. 눈금은 로컬에
                두고 놓거나(pointerup) 키를 뗄 때·초점을 잃을 때만 URL 로 커밋한다. */}
            <PriceSlider
              idPrefix="wc-shop"
              onCommit={() => applyFilters({
                ...currentDraft,
                priceMin: priceValue.min,
                priceMax: priceValue.max,
              })}
              onDraft={(bounds) => {
                const next = setDraftPriceRange(currentDraft, bounds, result.priceCeil);
                setPrice({ key: queryKey, min: next.priceMin, max: next.priceMax });
              }}
              priceCeil={result.priceCeil}
              value={priceValue}
            />
          </details>
          <button
            className="wc-filter-group__reset"
            onClick={() => applyFilters(EMPTY_SHOP_FILTER_DRAFT)}
            type="button"
          >
            전체 초기화
          </button>
        </aside>

        <div className="wc-collection__main">
          <div className="wc-collection__toolbar">
            {/* 적용 필터 칩이 없는 대신 이 카운트가 필터 피드백의 본체다(R-03 §1.3).
                '전체 ›' 머리는 데스크톱에서만 보인다(R-03 §1.8 — 모바일은 'N개 굿즈'). */}
            <p aria-live="polite" className="wc-collection__count">
              <span className="wc-collection__count-scope">전체<span aria-hidden className="wc-collection__count-sep"> › </span></span>
              <strong>{`${hasFilters ? `${result.filteredTotal}/${result.total}` : result.total}개 ${countNoun}`}</strong>
            </p>
            {result.filteredTotal > 0 ? (
              <>
                <label className="wc-sr-only" htmlFor="wc-shop-sort">정렬 기준</label>
                <select
                  className="wc-collection__sort"
                  id="wc-shop-sort"
                  onChange={(event) => navigate({ ...query, sort: event.target.value as ShopSort })}
                  value={query.sort}
                >
                  {sorts.map((sort) => (
                    <option key={sort} value={sort}>{SHOP_SORT_LABELS[sort]}</option>
                  ))}
                </select>
              </>
            ) : null}
            <button
              aria-label={filterCount ? `필터, ${filterCount}개 적용됨` : '필터'}
              aria-expanded={sheetOpen}
              aria-haspopup="dialog"
              className="wc-filter-trigger"
              data-active={hasFilters || undefined}
              onClick={() => {
                setDraft(shopFilterDraftFromQuery(query));
                setSheetTab(showIpFacet ? 'ips' : 'types');
                setSheetOpen(true);
              }}
              type="button"
            >
              <span aria-hidden><Icon name="filter" size={17} /></span>
              필터
              {filterCount > 0 ? <span aria-hidden className="wc-filter-trigger__count">{filterCount}</span> : null}
            </button>
          </div>

          {result.filteredTotal === 0 ? (
            <div className="wc-collection__empty">
              <EmptyState
                action={(
                  <WcButton onClick={() => applyFilters(EMPTY_SHOP_FILTER_DRAFT)}>전체 초기화</WcButton>
                )}
                description="필터를 줄이거나 초기화해 보세요."
                title="조건에 맞는 굿즈가 없어요"
              />
            </div>
          ) : (
            <>
              <div className="wc-product-grid">
                {visibleGoods.map((good) => (
                  <ProductCard
                    key={good.id}
                    action={wishlist ? (
                      <ListingWishHeart goodId={good.id} initialWished={wished.has(good.id)} label={good.name} viewerId={wishlist.viewerId} />
                    ) : undefined}
                    listSurface={listSurface} listingAppearance={good.listingAppearance} cartGood={good}
                    badges={goodDisplayBadges(good)}
                    brand={brandByIpId.get(good.ip)}
                    showDiscountRate={good.showDiscountRate} compareAtPrice={good.compareAtPrice}
                    href={goodDetailHref(good.id)}
                    imageBackground={good.img}
                    name={good.name}
                    price={good.price} priceMax={good.priceMax}
                    reviewSummary={result.reviewSummaries?.[good.id]}
                    salePeriod={good.salePeriod} soldOut={good.stock === 'soldout' || good.stockQty <= 0}
                  />
                ))}
              </div>
              {paging?.error ? <p role="alert">{paging.error}{paging.onReload ? <button type="button" onClick={paging.onReload}>목록 새로 불러오기</button> : null}</p> : null}
              {hasMore ? (
                <ViewMore
                  label="VIEW MORE"
                  loading={paging?.loading}
                  onClick={paging?.onLoadMore ?? (() => setShown({ key: queryKey, count: visibleCount + SHOP_PAGE_SIZE }))}
                />
              ) : null}
              {pager}
            </>
          )}
        </div>
      </div>

      {/* 시트·딤은 #root 밖으로 포털한다 — 안에 두면 useOverlayA11y의 #root inert가 시트
          자신까지 얼리고, #root 스태킹 컨텍스트(z2)가 셸 헤더·탭바(z3) 아래로 딤을 깔아버린다. */}
      {sheetOpen ? (
        <OverlayPortal container={overlayContainer}>
          <div aria-hidden className="wc-filter-sheet__dim" onClick={closeSheet} />
          <div
            ref={panelRef}
            aria-label="굿즈 필터"
            aria-modal="true"
            className="wc-filter-sheet"
            role="dialog"
          >
            <div className="wc-filter-sheet__heading">
              <div>
                <h2>굿즈 필터</h2>
                <p>{sheetDescription}</p>
              </div>
              <button aria-label="필터 닫기" className="wc-filter-sheet__close" onClick={closeSheet} type="button">
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="wc-filter-sheet__tabs" role="tablist">
              {sheetTabs.map((tab) => (
                <button
                  key={tab.id}
                  aria-controls={`wc-shop-sheet-${tab.id}`}
                  aria-selected={sheetTab === tab.id}
                  className={`wc-filter-sheet__tab${sheetTab === tab.id ? ' is-active' : ''}`}
                  id={`wc-shop-sheet-tab-${tab.id}`}
                  onClick={() => setSheetTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              aria-labelledby={`wc-shop-sheet-tab-${sheetTab}`}
              className="wc-filter-sheet__body"
              id={`wc-shop-sheet-${sheetTab}`}
              role="tabpanel"
            >
              {/* 시트 안에서는 탭이 그룹 제목 역할을 하므로 details 없이 그룹 본문만 둔다. */}
              {sheetTab === 'categories' && <div className="wc-filter-group">
                <FilterCheckList name="wc-shop-sheet-category" onToggle={(value) => setDraft(toggleDraftValue(draft, 'categories', value))} options={result.categoryFacets ?? []} selected={draft.categories ?? []} />
              </div>}
              {sheetTab === 'ips' ? (
                <div className="wc-filter-group">
                  <FilterCheckList
                    name="wc-shop-sheet-ip"
                    onToggle={(value) => setDraft(toggleDraftValue(draft, 'ips', value))}
                    options={result.ipFacets}
                    selected={draft.ips}
                  />
                </div>
              ) : null}
              {sheetTab === 'types' ? (
                <div className="wc-filter-group">
                  <FilterCheckList
                    name="wc-shop-sheet-type"
                    onToggle={(value) => setDraft(toggleDraftValue(draft, 'types', value))}
                    options={result.typeFacets}
                    selected={draft.types}
                  />
                </div>
              ) : null}
              {sheetTab === 'price' ? (
                <div className="wc-filter-group">
                  <PriceSlider
                    idPrefix="wc-shop-sheet"
                    onCommit={() => undefined}
                    onDraft={(bounds) => setDraft(setDraftPriceRange(draft, bounds, result.priceCeil))}
                    priceCeil={result.priceCeil}
                    value={{ min: draft.priceMin, max: draft.priceMax }}
                  />
                </div>
              ) : null}
            </div>
            <div className="wc-filter-sheet__footer">
              <button
                className="wc-filter-group__reset"
                onClick={() => setDraft(EMPTY_SHOP_FILTER_DRAFT)}
                type="button"
              >
                전체 초기화
              </button>
              <button
                className="wc-filter-sheet__apply"
                onClick={() => {
                  applyFilters(draft);
                  closeSheet();
                }}
                type="button"
              >
                적용
              </button>
            </div>
          </div>
        </OverlayPortal>
      ) : null}
    </>
  );
}
