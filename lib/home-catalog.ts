import type { CatalogPostPreview, CatalogSnapshot } from './catalog';
import type { Card, FandomEvent, Good, Ip } from './data';

export const MAX_HOME_PICKER_IPS = 5;

/* 큐레이션 아트웍 경로와 내부 링크의 안전 규칙. 홈 로더(catalog.ts)와 셸의
   공지 스트립 로더(notice-strip.server.ts)가 같은 검증을 공유해야 해서 여기 둔다. */
export const HOME_CURATION_IMAGE_PATTERN =
  /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const AMBIGUOUS_LINK_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

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
    return (
      decoded.startsWith('/')
      && !decoded.startsWith('//')
      && !decoded.includes('\\')
      && !AMBIGUOUS_LINK_CHARACTER_PATTERN.test(decoded)
    );
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
   타입은 클라이언트 컴포넌트(Nav)도 참조하므로 서버 전용 모듈 밖에 둔다. */
export interface NoticeStrip {
  id: string;
  title: string;
  imageUrl: string;
  href: string;
}

export interface HomeHeroSlide {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  href: string;
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
  id: string;
  name: string;
  brand: string | null;
  price: number;
  badge: string | null;
  imageBg: string;
  href: string;
  soldOut: boolean;
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

/** 큐레이션이 참조한 굿즈 id 목록을 카드 뷰모델로 바꾼다 — 없는 id·중복은 버리고 순서를 지킨다. */
export function resolveHomeGoodsCards(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>,
  goodIds: readonly string[],
  limit: number,
): HomeGoodsCard[] {
  const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
  const brandByIpId = new Map(catalog.ips.map((ip) => [ip.id, ip.title]));
  const seen = new Set<string>();
  const cards: HomeGoodsCard[] = [];

  for (const id of goodIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const good = goodsById.get(id);
    if (!good) continue;
    cards.push({
      id: good.id,
      name: good.name,
      brand: brandByIpId.get(good.ip) ?? null,
      price: good.price,
      badge: good.badge ?? null,
      imageBg: good.img,
      href: `/shop/${good.id}`,
      soldOut: good.stock === 'soldout',
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
  representativeCard: Card | null;
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
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods' | 'cards' | 'events'>,
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
      representativeCard: null,
      representativeEvent: null,
      representativePost: null,
    };
  }

  return {
    selectableIps,
    selectedIp,
    representativeGood: catalog.goods.find((good) => good.ip === selectedIp.id) ?? null,
    representativeCard: catalog.cards.find((card) => card.ip === selectedIp.id) ?? null,
    representativeEvent: catalog.events.find((event) => event.ip === selectedIp.id) ?? null,
    representativePost: postPreviewByIpId[selectedIp.id] ?? null,
  };
}
