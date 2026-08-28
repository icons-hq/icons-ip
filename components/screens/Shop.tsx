'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useOverlayA11y } from '@/components/shell/useOverlayA11y';
import { EmptyState } from '@/components/wc/EmptyState';
import { ProductCard } from '@/components/wc/ProductCard';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { ViewMore } from '@/components/wc/ViewMore';
import { WcButton } from '@/components/wc/WcButton';
import { krw } from '@/lib/format';
import { goodDetailHref } from '@/lib/goods-display';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import {
  SHOP_DEFAULT_SORT,
  SHOP_PAGE_SIZE,
  SHOP_SORTS,
  SHOP_SORT_LABELS,
  type ShopFacetOption,
  type ShopListQuery,
  type ShopListResult,
  type ShopSort,
  type ShopView,
} from '@/lib/shop-catalog';

/*
 * 굿즈샵·NEW·BEST 컬렉션 화면 (#326, R-03 §1).
 *
 * 상태는 전부 URL 에 있다. 서버 페이지가 searchParams 를 파싱해 목록까지 계산해 내려주고,
 * 이 화면은 컨트롤이 만들 "다음 URL"만 조립한다. 그래서 필터가 걸린 목록을 그대로 공유·복원할 수
 * 있고, 뒤로가기가 필터 이력이 된다.
 *
 * 데스크톱 사이드바는 즉시 적용, 모바일 바텀시트는 draft 를 모아 [적용]에서 한 번에 반영한다
 * (R-03 §1.3·§1.8 의 갈린 패턴을 그대로 재현한다). 시트 draft 를 순수 함수로 뽑아둔 이유는
 * jsdom 없는 이 저장소에서 조합 규칙을 단언할 수 있는 지점이 그것뿐이기 때문이다.
 */

export interface ShopProps {
  view: ShopView;
  query: ShopListQuery;
  result: ShopListResult;
}

export interface ShopFilterDraft {
  ips: string[];
  types: string[];
  priceMin: number | null;
  priceMax: number | null;
}

export const EMPTY_SHOP_FILTER_DRAFT: ShopFilterDraft = {
  ips: [],
  types: [],
  priceMin: null,
  priceMax: null,
};

export function shopFilterDraftFromQuery(query: ShopListQuery): ShopFilterDraft {
  return {
    ips: [...query.ips],
    types: [...query.types],
    priceMin: query.priceMin,
    priceMax: query.priceMax,
  };
}

export function toggleDraftValue(
  draft: ShopFilterDraft,
  group: 'ips' | 'types',
  value: string,
): ShopFilterDraft {
  const current = draft[group];
  return {
    ...draft,
    [group]: current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value],
  };
}

/* 두 핸들이 서로를 넘어설 수 있으므로 낮은 쪽·높은 쪽을 값으로 다시 정한다.
   양 끝에 붙은 핸들은 "제한 없음"이라 null 로 접어 URL 에서 아예 뺀다. */
export function setDraftPriceRange(
  draft: ShopFilterDraft,
  bounds: { min: number; max: number },
  priceCeil: number,
): ShopFilterDraft {
  const ceil = Math.max(0, Math.round(priceCeil));
  const clamp = (value: number) => Math.min(Math.max(0, Math.round(value)), ceil);
  const low = Math.min(clamp(bounds.min), clamp(bounds.max));
  const high = Math.max(clamp(bounds.min), clamp(bounds.max));

  return {
    ...draft,
    priceMin: low <= 0 ? null : low,
    priceMax: high >= ceil ? null : high,
  };
}

/** 컨트롤이 만들 다음 URL 의 쿼리 문자열. 뷰 기본 정렬은 싣지 않아 기본 상태 URL 이 깨끗하다. */
export function shopQueryString(query: ShopListQuery): string {
  const params = new URLSearchParams();
  for (const id of query.ips) params.append('ip', id);
  for (const type of query.types) params.append('type', type);
  if (query.priceMin !== null) params.set('min', String(query.priceMin));
  if (query.priceMax !== null) params.set('max', String(query.priceMax));
  if (query.sort !== SHOP_DEFAULT_SORT[query.view]) params.set('sort', query.sort);
  return params.toString();
}

const VIEW_HEADINGS: Record<ShopView, { title: string; subcopy?: string }> = {
  all: { title: '굿즈샵' },
  new: { title: 'NEW', subcopy: '새로 나온 굿즈를 모아 봤어요.' },
  best: { title: 'BEST', subcopy: '지금 가장 사랑받는 굿즈예요.' },
};

const SHEET_TABS = [
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
        <label key={option.value} className="wc-filter-group__option">
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

export function Shop({ query, result, view }: ShopProps) {
  const pathname = usePathname();
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  /* 질의가 바뀌면 표시 개수·슬라이더 위치는 처음으로 돌아가야 한다. effect 로 되돌리면
     한 프레임 동안 옛 상태가 그려지므로, 질의 문자열을 키로 들고 렌더 중에 판별한다. */
  const queryKey = shopQueryString(query);
  const [shown, setShown] = useState({ key: queryKey, count: SHOP_PAGE_SIZE });
  const [price, setPrice] = useState({ key: queryKey, min: query.priceMin, max: query.priceMax });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTabId>('ips');
  const [draft, setDraft] = useState<ShopFilterDraft>(() => shopFilterDraftFromQuery(query));

  const closeSheet = () => setSheetOpen(false);
  useOverlayA11y({ open: sheetOpen, onClose: closeSheet, panelRef });

  const visibleCount = shown.key === queryKey ? shown.count : SHOP_PAGE_SIZE;
  const priceValue = price.key === queryKey
    ? { min: price.min, max: price.max }
    : { min: query.priceMin, max: query.priceMax };

  const heading = VIEW_HEADINGS[view];
  const headingNode = view === 'all'
    ? <h1 className="wc-sr-only">{heading.title}</h1>
    : <SectionHeading as="h1" subcopy={heading.subcopy} title={heading.title} />;

  const navigate = (next: ShopListQuery) => {
    const qs = shopQueryString(next);
    /* 같은 URL 로의 재진입은 서버 왕복만 만들고 목록은 그대로다 — 슬라이더를 만졌다 제자리에
       놓는 흔한 조작에서 특히 잘 발생한다. */
    if (qs === queryKey) return;
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const applyFilters = (next: ShopFilterDraft) => navigate({ ...query, ...next });
  const currentDraft = shopFilterDraftFromQuery(query);

  /* 스코프가 통째로 비면 필터·정렬을 그릴 이유가 없다. 가짜 목록 대신 안내만 남긴다. */
  if (result.total === 0) {
    return (
      <div className="wc-root wc-collection">
        <div className="wc-container">
          {headingNode}
          <div className="wc-collection__empty">
            <EmptyState
              action={view === 'all' ? undefined : (
                <WcButton href="/shop" variant="primary">굿즈샵 둘러보기</WcButton>
              )}
              title="아직 준비 중이에요"
            />
          </div>
        </div>
      </div>
    );
  }

  const brandByIpId = new Map(result.ipFacets.map((facet) => [facet.value, facet.label]));
  const visibleGoods = result.goods.slice(0, visibleCount);
  const hasFilters = query.ips.length > 0
    || query.types.length > 0
    || query.priceMin !== null
    || query.priceMax !== null;

  return (
    <div className="wc-root wc-collection">
      <div className="wc-container">
        {headingNode}
        <div className="wc-collection__layout">
          {/* 데스크톱 사이드바는 체크 즉시 URL 을 갱신한다 — 적용 버튼이 없는 쪽 패턴(R-03 §1.3). */}
          <aside aria-label="굿즈 필터" className="wc-collection__sidebar">
            <details className="wc-filter-group" open>
              <summary className="wc-filter-group__summary">{`IP (${query.ips.length})`}</summary>
              <FilterCheckList
                name="wc-shop-ip"
                onToggle={(value) => applyFilters(toggleDraftValue(currentDraft, 'ips', value))}
                options={result.ipFacets}
                selected={query.ips}
              />
            </details>
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
              {/* 적용 필터 칩이 없는 대신 이 카운트가 필터 피드백의 본체다(R-03 §1.3). */}
              <p aria-live="polite" className="wc-collection__count">
                전체{' '}
                <strong>
                  {hasFilters ? `${result.filteredTotal}/${result.total}` : result.total}
                </strong>
                개 굿즈
              </p>
              <button
                aria-expanded={sheetOpen}
                aria-haspopup="dialog"
                className="wc-filter-trigger"
                onClick={() => {
                  setDraft(shopFilterDraftFromQuery(query));
                  setSheetTab('ips');
                  setSheetOpen(true);
                }}
                type="button"
              >
                필터 및 정렬
              </button>
              {result.filteredTotal > 0 ? (
                <>
                  <label className="wc-sr-only" htmlFor="wc-shop-sort">정렬 기준</label>
                  <select
                    className="wc-collection__sort"
                    id="wc-shop-sort"
                    onChange={(event) => navigate({ ...query, sort: event.target.value as ShopSort })}
                    value={query.sort}
                  >
                    {SHOP_SORTS.map((sort) => (
                      <option key={sort} value={sort}>{SHOP_SORT_LABELS[sort]}</option>
                    ))}
                  </select>
                </>
              ) : null}
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
                      badges={goodDisplayBadges(good)}
                      brand={brandByIpId.get(good.ip)}
                      compareAtPrice={good.compareAtPrice}
                      href={goodDetailHref(good.id)}
                      imageBackground={good.img}
                      name={good.name}
                      price={good.price}
                      soldOut={good.stock === 'soldout'}
                    />
                  ))}
                </div>
                {visibleCount < result.filteredTotal ? (
                  <ViewMore
                    onClick={() => setShown({ key: queryKey, count: visibleCount + SHOP_PAGE_SIZE })}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {sheetOpen ? (
        <>
          <div aria-hidden className="wc-filter-sheet__dim" onClick={closeSheet} />
          <div
            ref={panelRef}
            aria-label="굿즈 필터"
            aria-modal="true"
            className="wc-filter-sheet"
            role="dialog"
          >
            <div className="wc-filter-sheet__tabs" role="tablist">
              {SHEET_TABS.map((tab) => (
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
        </>
      ) : null}
    </div>
  );
}
