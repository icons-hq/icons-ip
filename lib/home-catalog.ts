import type { CatalogPostPreview, CatalogSnapshot } from './catalog';
import type { FandomEvent, Good, Ip } from './data';
import type { GoodsReviewSummary } from './goods-review-summary';
import type { HomeBlockKey } from './home-layout';
import type { HomeMosaicBand } from './home-mosaic';
import type { HomeProductCollectionBand } from './home-product-collection';
import type { HomeReviewBestBand, HomeSalesBestBand } from './home-ranking';
import type { PublicShoppingStorySummary } from './shopping-stories';
import type { HomeHeroImageDim, HomeHeroTextColor } from './home-hero';
import { publicIpHref } from './ip-identity';
import { productCardChips, productCardUnavailableLabel, type ProductCardChip } from './product-card-chips';
import { goodDetailHref } from '@/lib/goods-display';

export const MAX_HOME_PICKER_IPS = 5;

/* 큐레이션 아트웍 경로와 내부 링크의 안전 규칙. 홈 로더(catalog.ts)와 셸의
   공지 스트립 로더(notice-strip.server.ts)가 같은 검증을 공유해야 해서 여기 둔다. */
export const HOME_CURATION_IMAGE_PATTERN =
  /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const AMBIGUOUS_LINK_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

/* 점 조각 경로는 파서가 접어 원문 검사를 통과한 값도 `//외부호스트`(스킴 상대 URL)로 바뀐다(`/..//evil.example`). 가짜 기준 주소로 정규화한 뒤의 경로를
   보고, 경로 안의 `.`·`..` 조각(`%2e` 포함)은 정규화 전에 거절한다 — `safeNextPath`(lib/auth/onboarding.ts)와 같은 규칙이다. */
const INTERNAL_LINK_BASE = 'https://icons.local';
const LINK_PATH_WHITESPACE_PATTERN = /\s/u;

export function isSafeInternalLink(value: string) {
  const characterLength = Array.from(value).length;
  if (
    characterLength < 1
    || characterLength > 2048
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || AMBIGUOUS_LINK_CHARACTER_PATTERN.test(value)
  ) {
    return false;
  }

  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded.startsWith('/')
      || decoded.startsWith('//')
      || decoded.includes('\\')
      || AMBIGUOUS_LINK_CHARACTER_PATTERN.test(decoded)
    ) {
      return false;
    }

    /* 공백·점 조각은 경로(쿼리·해시 앞)만 본다 — 쿼리의 공백은 브라우저가 인코딩해 열리고, 기존 운영 링크를 숨기지 않는다. */
    const pathEnd = value.search(/[?#]/);
    const rawPath = pathEnd === -1 ? value : value.slice(0, pathEnd);
    if (LINK_PATH_WHITESPACE_PATTERN.test(rawPath)) return false;
    if (decodeURIComponent(rawPath).split('/').some((segment) => segment === '.' || segment === '..')) return false;

    /* 원문과 한 번 푼 값 둘 다 정규화한다 — 두 번 인코딩한 점 조각(`%252e%252e//`)은 한 번 풀면 `%2e%2e//` 가 되어 다음 소비자가 접는다. */
    return [value, decoded].every((candidate) => {
      const url = new URL(candidate, INTERNAL_LINK_BASE);
      return url.origin === INTERNAL_LINK_BASE && !url.pathname.startsWith('//') && !url.pathname.includes('\\');
    });
  } catch {
    return false;
  }
}

export type HomePostPreviewByIpId = Record<string, CatalogPostPreview | null>;

export interface HomeBanner {
  id: string;
  title: string;
  imageBg: string | null;
  href: string;
}

/* 전역 셸이 그리는 공지 스트립 — 로더는 lib/notice-strip.server.ts 지만
   타입은 클라이언트 컴포넌트(Nav)도 참조하므로 서버 전용 모듈 밖에 둔다.
   PC 비율(≈47:1) 아트웍은 모바일 폭에서 수 px 로 붕괴하므로 히어로처럼
   payload 로 모바일 아트웍을 따로 나른다(R-01 §1 의 PC/MO 소스 분리). */
export interface NoticeStrip {
  id: string;
  title: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  href: string;
}

/* 2026-11-24 일반 쇼핑몰 전환으로 지운 화면(카드팩·게임·바인더·마켓·트레이드, ADR-0052)으로 가는 공개 링크를 숨기는 판정.
   어드민 타깃 목록에는 없지만 예전에 걸어 둔 큐레이션·공지의 사이트 안 주소가 남아 있으면 404 로 떨어지는 링크가 된다.
   `/games/hyosan-memories`(지우학 캠페인)도 예전 카드 리워드 게이트처럼 큐레이션·공지에서는 걸러 둔다 — 캠페인 화면 안에서만 연다.
   파싱이 불가능한 href 는 안전하게 숨김 대상으로 취급한다. */
const RETIRED_DESTINATION_ROOTS = ['/packs', '/games', '/binder', '/market', '/exchange', '/gacha'] as const;

export function isRetiredDestination(href: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(href, 'https://icons.local').pathname);
  } catch {
    return true;
  }
  return RETIRED_DESTINATION_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * 지운 화면으로 가는 큐레이션을 걸러낸다. 혜택 타일도 다른 큐레이션처럼 목적지 기준이다 — 지운 화면으로 가는 타일만 빠지고
 * 쿠폰·이벤트 같은 혜택 타일은 남는다(12 LD-15, 11 DT-11).
 */
export function withoutRetiredCurations(curation: HomeCurationSnapshot): HomeCurationSnapshot {
  return {
    ...curation,
    heroSlides: curation.heroSlides.filter((slide) => slide.href === null || !isRetiredDestination(slide.href)),
    editorPicks: curation.editorPicks.filter((pick) => !isRetiredDestination(pick.href)),
    goodsBands: curation.goodsBands.filter((band) => !isRetiredDestination(band.href)),
    benefitTiles: curation.benefitTiles.filter((tile) => !isRetiredDestination(tile.href)),
    ...(curation.stripBanner === undefined ? {} : {
      stripBanner: curation.stripBanner && !isRetiredDestination(curation.stripBanner.href) ? curation.stripBanner : null,
    }),
  };
}

/** 혜택 타일 아이콘(`components/ui/Icon` 이름). 레퍼런스 아이콘 대신 ICONS 아이콘 세트에서 목적지로 고른다(11 HM-07). */
export type HomeBenefitIcon = 'event' | 'shop' | 'ip' | 'star';

export function benefitTileIcon(href: string): HomeBenefitIcon {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(href, 'https://icons.local').pathname);
  } catch {
    return 'star';
  }
  const under = (root: string) => pathname === root || pathname.startsWith(`${root}/`);
  if (under('/events') || under('/review-events') || under('/offline-popups')) return 'event';
  if (under('/shop')) return 'shop';
  if (under('/ip')) return 'ip';
  return 'star';
}

/* 커뮤니티가 임시 비공개인 동안 커뮤니티로 가는 큐레이션 배너를 걸러낸다. 어드민 타깃 목록에서
   이미 걸어 둔 히어로·공지·노티스가 살아 있으면 공개 지면에 404로 떨어지는 링크가 남는다.
   파싱 불가 href 는 지운 화면 판정과 같은 이유로 안전하게 게이트 대상으로 본다. */
export function isCommunityDestination(href: string): boolean {
  try {
    const pathname = decodeURIComponent(new URL(href, 'https://icons.local').pathname);
    return pathname === '/community' || pathname.startsWith('/community/');
  } catch {
    return true;
  }
}

/**
 * 커뮤니티가 닫힌 화면이 커뮤니티 목적지 큐레이션을 통째로 걸러낼 때 쓴다.
 * 혜택 타일도 같다 — 목적지 기준 게이트(12 LD-15)라 커뮤니티로 가는 혜택 타일만 빠진다.
 */
export function withoutCommunityCurations(curation: HomeCurationSnapshot): HomeCurationSnapshot {
  return {
    ...curation,
    heroSlides: curation.heroSlides.filter((slide) => slide.href === null || !isCommunityDestination(slide.href)),
    editorPicks: curation.editorPicks.filter((pick) => !isCommunityDestination(pick.href)),
    goodsBands: curation.goodsBands.filter((band) => !isCommunityDestination(band.href)),
    benefitTiles: curation.benefitTiles.filter((tile) => !isCommunityDestination(tile.href)),
    ...(curation.stripBanner === undefined ? {} : {
      stripBanner: curation.stripBanner && !isCommunityDestination(curation.stripBanner.href) ? curation.stripBanner : null,
    }),
  };
}

export interface HomeHeroSlide {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  href: string | null;
  imageAlt?: string;
  imageDim?: HomeHeroImageDim;
  textColor?: HomeHeroTextColor;
}

export interface HomeEditorPick {
  id: string;
  title: string;
  badge: string | null;
  description: string | null;
  imageBg: string;
  href: string;
}

/* 홈 밴드가 그리는 상품 카드 뷰모델 — 서버에서 카탈로그와 조인을 끝내 내려보낸다.
   존재하지 않는 굿즈 id 는 서버 resolve 단계에서 걸러지므로 화면은 목록만 그린다. */
export interface HomeGoodsCard {
  salePeriod?: Good['salePeriod'];
  priceMax?: number;
  id: string;
  name: string;
  brand: string | null;
  price: number;
  /** 취소선 정가(`Good.compareAtPrice`)와 할인율 표시 여부 — 카드 가격 줄의 할인율을 목록 화면과 같은 규칙(`PriceBlock`)으로 그린다. 옛 투영은 없다. */
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
  /** 상품 표시문구 첫 값(`Good.badge`). */
  badge: string | null;
  /** 상품 표시문구 전부(고른 순서). 칩이 없는 카드(`chips` 없음)가 운영 배지 칩으로 그린다. 옛 투영은 없고 `badge` 하나로 읽는다. */
  badges?: string[];
  imageBg: string;
  href: string;
  soldOut: boolean;
  /**
   * 판매기간·예약 상태 문구(`productCardUnavailableLabel`) — 카드 뷰모델은 옵션 예약 상태를 싣지 않으므로 서버가 채운다.
   * 지금 주문할 수 있으면 없다. 옛 투영도 없고, 그때 화면은 `homeCardUnavailableLabel`로 판매기간만 본다.
   */
  unavailableLabel?: string;
  /** 목록 카드 별점(CL-02) — 공개 리뷰가 있을 때만. */
  reviewSummary?: GoodsReviewSummary;
  /** 카드 칩(예약판매·무료배송·캡슐토이·운영 배지). `productCardChips`가 서버에서 채운다(공용 부품 계약 §3). 옛 투영은 비어 있다. */
  chips?: ProductCardChip[];
  /** 상품이 속한 IP의 공개 주소(`/ip/<slug>`). 상품 모음 '전체보기'를 한 IP관으로 잇는 근거다. IP가 카탈로그에 없으면 null. */
  ipHref?: string | null;
}

/**
 * 홈 카드(`HomeGoodsCard`)의 판매 불가 문구. 서버가 채운 `unavailableLabel`(예약 상태 포함)이 먼저고, 없으면 같은 함수로
 * 판매기간만 본다 — 서버 판정이 판매기간을 먼저 보므로 둘은 어긋나지 않는다. null 이면서 `soldOut`이면 품절이다.
 */
export function homeCardUnavailableLabel(good: Pick<HomeGoodsCard, 'unavailableLabel' | 'salePeriod' | 'soldOut'>): string | null {
  return good.unavailableLabel ?? productCardUnavailableLabel(good, good.soldOut);
}

/** 홈 스트립 배너(X SQUARE 홈) — 옛 종류 `announcement`를 되살려 이미지가 있는 첫 노출 행을 쓴다. 링크는 필수다(DB 규칙). */
export interface HomeStripBanner {
  id: string;
  title: string;
  imageUrl: string;
  href: string;
}

export interface HomeGoodsBand {
  id: string;
  title: string;
  subcopy: string | null;
  imageUrl: string;
  href: string;
  goods: HomeGoodsCard[];
}

export interface HomeBestTab {
  id: string;
  label: string;
  goods: HomeGoodsCard[];
}

export interface HomeBenefitTile {
  id: string;
  title: string;
  description: string | null;
  href: string;
}

export interface HomeCurationSnapshot {
  /** NEW ARRIVAL 블록(`new_arrivals`) — 공개 카탈로그 최신 등록 순 자동 선정. 카드가 없으면 비어 있다. */
  newArrivals?: HomeGoodsCard[];
  /** 홈 스트립 배너(`strip_banner`) — 이미지가 있는 첫 `announcement` 행. 없으면 null 또는 생략. */
  stripBanner?: HomeStripBanner | null;
  shoppingStories?: PublicShoppingStorySummary[];
  storiesNextChangeAt?: string | null;
  shoppingStoriesUnavailable?: boolean;
  mosaicBands?: HomeMosaicBand[];
  productCollections?: HomeProductCollectionBand[];
  layoutOrder?: HomeBlockKey[] | null;
  salesBestBands?: HomeSalesBestBand[];
  reviewBestBands?: HomeReviewBestBand[];
  hero: HomeBanner | null;
  announcement: HomeBanner | null;
  featuredIpIds: string[];
  heroSlides: HomeHeroSlide[];
  editorPicks: HomeEditorPick[];
  goodsBands: HomeGoodsBand[];
  categoryBestTabs: HomeBestTab[];
  popularTabs: HomeBestTab[];
  benefitTiles: HomeBenefitTile[];
}

export const HOME_GOODS_BAND_LIMIT = 4;
export const HOME_BEST_TAB_GOODS_LIMIT = 12;
export const HOME_LATEST_GOODS_MIN = 3;
export const HOME_LATEST_GOODS_MAX = 10;
/** 홈 NEW ARRIVAL(5열 × 2줄)이 보여 주는 최신 상품 수. */
export const HOME_NEW_ARRIVALS_COUNT = 10;

export type HomeGoodsSelection =
  | { mode: 'manual'; goodIds: string[] }
  | { mode: 'latest'; count: number };

/** Old good_ids records stay manual; malformed automatic rules are never guessed. */
export function readHomeGoodsSelection(payload: Record<string, unknown> | null): HomeGoodsSelection | null {
  if (payload?.selection_mode === 'latest') {
    const count = payload.item_count;
    if (typeof count !== 'number' || !Number.isInteger(count)
      || count < HOME_LATEST_GOODS_MIN || count > HOME_LATEST_GOODS_MAX
      || 'good_ids' in payload) return null;
    return { mode: 'latest', count };
  }
  if (payload && ('selection_mode' in payload || 'item_count' in payload)) return null;
  const ids = payload?.good_ids;
  return { mode: 'manual', goodIds: Array.isArray(ids) ? ids.filter(
    (id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id),
  ) : [] };
}

/** Only the public catalog is eligible. Undated mock/legacy rows cannot claim to be newest. */
export function resolveHomeLatestGoodsCards(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods' | 'reviewSummaries'>,
  count: number,
): HomeGoodsCard[] {
  if (!Number.isInteger(count) || count < HOME_LATEST_GOODS_MIN || count > HOME_LATEST_GOODS_MAX) return [];
  const latest = catalog.goods.flatMap((good) => {
    const createdAt = Date.parse(good.createdAt ?? '');
    return Number.isFinite(createdAt) ? [{ id: good.id, createdAt }] : [];
  }).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id, 'en'));
  return resolveHomeGoodsCards(catalog, latest.map((good) => good.id), count);
}

/** 큐레이션이 참조한 굿즈 id 목록을 카드 뷰모델로 바꾼다 — 없는 id·중복은 버리고 순서를 지킨다. */
export function resolveHomeGoodsCards(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods' | 'reviewSummaries'>,
  goodIds: readonly string[],
  limit: number,
): HomeGoodsCard[] {
  const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
  const ipById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
  const seen = new Set<string>();
  const cards: HomeGoodsCard[] = [];

  for (const id of goodIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const good = goodsById.get(id);
    if (!good) continue;
    const ip = ipById.get(good.ip);
    const soldOut = good.stock === 'soldout';
    const unavailableLabel = productCardUnavailableLabel(good, soldOut);
    cards.push({
      id: good.id,
      name: good.name,
      brand: ip?.title ?? null,
      price: good.price,
      priceMax: good.priceMax,
      compareAtPrice: good.compareAtPrice ?? null,
      showDiscountRate: good.showDiscountRate,
      badge: good.badge ?? null,
      imageBg: good.img,
      href: goodDetailHref(good),
      soldOut,
      ...(unavailableLabel ? { unavailableLabel } : {}),
      chips: productCardChips(good),
      ipHref: ip ? publicIpHref({ id: ip.id, publicSlug: ip.publicSlug }) : null,
      ...(good.salePeriod ? { salePeriod: good.salePeriod } : {}),
      ...(catalog.reviewSummaries?.[good.id] ? { reviewSummary: catalog.reviewSummaries[good.id] } : {}),
    });
    if (cards.length === limit) break;
  }

  return cards;
}

export function prioritizeHomePostPreviews(
  previewsByIpId: HomePostPreviewByIpId,
  followedIpIds: ReadonlySet<string>,
  orderedIpIds?: readonly string[],
): [string, CatalogPostPreview][] {
  const entries = orderedIpIds === undefined
    ? Object.entries(previewsByIpId).filter(
        (entry): entry is [string, CatalogPostPreview] => entry[1] !== null,
      )
    : orderedIpIds
        .map((ipId) => [ipId, previewsByIpId[ipId]] as const)
        .filter((entry): entry is [string, CatalogPostPreview] => entry[1] != null);

  return [
    ...entries.filter(([ipId]) => followedIpIds.has(ipId)),
    ...entries.filter(([ipId]) => !followedIpIds.has(ipId)),
  ];
}

export interface HomeIpWorld {
  selectableIps: Ip[];
  selectedIp: Ip | null;
  representativeGood: Good | null;
  representativeEvent: FandomEvent | null;
  representativePost: CatalogPostPreview | null;
}

export function getHomeCuratedIpIds(
  catalog: Pick<CatalogSnapshot, 'ips'>,
  curatedIpIds: readonly string[],
): string[] {
  const catalogIpIds = new Set(catalog.ips.map((ip) => ip.id));
  const seen = new Set<string>();
  const validIds: string[] = [];

  for (const id of curatedIpIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!catalogIpIds.has(id)) continue;
    validIds.push(id);
    if (validIds.length === MAX_HOME_PICKER_IPS) break;
  }

  return validIds;
}

export function getHomeSelectableIps(
  catalog: Pick<CatalogSnapshot, 'ips'>,
  curatedIpIds?: readonly string[],
): Ip[] {
  if (curatedIpIds !== undefined) {
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
    const curatedIps = getHomeCuratedIpIds(catalog, curatedIpIds)
      .map((id) => ipsById.get(id))
      .filter((ip): ip is Ip => Boolean(ip));

    return curatedIps.length > 0 ? curatedIps : catalog.ips.slice(0, MAX_HOME_PICKER_IPS);
  }

  const featuredIps = catalog.ips.filter((ip) => ip.featured);
  return (featuredIps.length > 0 ? featuredIps : catalog.ips).slice(0, MAX_HOME_PICKER_IPS);
}

export function buildHomeIpWorld(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods' | 'events'>,
  selectedIpId?: string | null,
  postPreviewByIpId: HomePostPreviewByIpId = {},
): HomeIpWorld {
  const selectableIps = getHomeSelectableIps(catalog);
  const selectedIp = selectableIps.find((ip) => ip.id === selectedIpId) ?? selectableIps[0] ?? null;

  if (!selectedIp) {
    return {
      selectableIps,
      selectedIp: null,
      representativeGood: null,
      representativeEvent: null,
      representativePost: null,
    };
  }

  return {
    selectableIps,
    selectedIp,
    representativeGood: catalog.goods.find((good) => good.ip === selectedIp.id) ?? null,
    representativeEvent: catalog.events.find((event) => event.ip === selectedIp.id) ?? null,
    representativePost: postPreviewByIpId[selectedIp.id] ?? null,
  };
}
