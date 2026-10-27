import { HOME_CURATION_IMAGE_PATTERN, isCardRewardDestination, isSafeInternalLink } from './home-catalog';
import { isHomeHeroImageDim, isHomeHeroTextColor, type HomeHeroImageDim, type HomeHeroTextColor } from './home-hero';
import { shellNoticeDestinationAllowed, type ShellNoticeGates } from './shell-notices';

/*
 * 컬렉션 배너(11 CL-09, LFS 패리티 2차 L8b).
 *
 * 홈 전시관리 큐레이션 `collection_banner` 한 행이 컬렉션 한 페이지의 머리 배너 한 장이다. slot 이 페이지를 고른다:
 * 굿즈샵 전체(`all` — 1440×580 전폭 수동 슬라이더), BEST·NEW(`best`·`new` — 1180×260 칸 배너, 모바일 전폭 375×175).
 * 카테고리 전시(`/shop?displayCategory=`)에는 배너가 없다. 문구는 이미지에 굽지 않고 텍스트 레이어로 얹는다 —
 * 이미지가 늦거나 실패해도 무엇을 여는 배너인지 읽힌다(캠페인 배너와 같은 규칙). 이미지 대체텍스트는 그림 자체의 의미만
 * 따로 담고(선택), 비우면 장식 이미지(alt="")다.
 *
 * 로더(lib/collection-banners.server.ts)는 쿠키 없는 캐시 읽기로 지금 노출 중인 행을 내려 주고, 요청마다 종료 시각과
 * 목적지 게이트(카드 리워드·커뮤니티)를 서버에서 다시 거른 뒤 페이지 몫(굿즈샵 전체 10장, BEST·NEW 운영 순서 첫 장)만 넘긴다.
 * 그래서 화면(Shop)이 받은 목록이 곧 그릴 배너다 — 배너 유무로 정하는 머리말·여백이 실제 배너와 어긋나지 않는다.
 * DB 규칙(20261027020000 home_curations_collection_check)과 같은 한도로 한 번 더 검증한다 — 어긋난 행은 그리지 않는다.
 * 한 컬렉션에서 노출 기간이 겹치는 배너는 DB 트리거가 10장까지만 받는다(20261027020200) — 노출 중인데 화면에서 빠지는 배너가 없다.
 */

export const COLLECTION_BANNER_SLOTS = ['all', 'best', 'new'] as const;
export type CollectionBannerSlot = typeof COLLECTION_BANNER_SLOTS[number];

export const COLLECTION_BANNER_TITLE_LIMIT = 40;
export const COLLECTION_BANNER_SUBTITLE_LIMIT = 80;
export const COLLECTION_BANNER_ALT_LIMIT = 100;
/** 굿즈샵 전체 슬라이더의 상한. 한 컬렉션에서 노출 기간이 겹치는 배너도 DB가 이만큼만 받는다(collection_banner_limit). */
export const COLLECTION_BANNER_SLIDE_LIMIT = 10;

/** 컬렉션 한 페이지에 그리는 배너 수 — 굿즈샵 전체는 슬라이드 10장, BEST·NEW는 운영 순서 첫 장 하나(레퍼런스 BEST도 한 장). */
export function collectionBannerDisplayLimit(slot: CollectionBannerSlot): number {
  return slot === 'all' ? COLLECTION_BANNER_SLIDE_LIMIT : 1;
}

export const COLLECTION_BANNER_SLOT_LABELS: Record<CollectionBannerSlot, string> = {
  all: '굿즈샵 전체(슬라이드)',
  best: 'BEST',
  new: 'NEW',
};

export interface CollectionBanner {
  id: string;
  slot: CollectionBannerSlot;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  href: string | null;
  /** 그림 자체의 의미(선택). 빈 문자열이면 장식 이미지다 — 보이는 문구는 텍스트 레이어가 따로 읽힌다. */
  imageAlt: string;
  imageDim: HomeHeroImageDim;
  textColor: HomeHeroTextColor;
  /** 노출 종료 시각(epoch ms). null = 종료 없음. 캐시된 목록을 요청마다 다시 거르는 데 쓴다. */
  endsAt: number | null;
}

export interface CollectionBannerRow {
  id: string;
  title: string;
  image_path: string | null;
  link_path: string | null;
  slot: string | null;
  active_to: string | null;
  payload: Record<string, unknown> | null;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const BANNER_PAYLOAD_KEYS = new Set(['subtitle', 'mobile_image_path', 'image_alt', 'image_dim', 'text_color']);

export function isCollectionBannerSlot(value: unknown): value is CollectionBannerSlot {
  return typeof value === 'string' && (COLLECTION_BANNER_SLOTS as readonly string[]).includes(value);
}

function boundedText(value: unknown, limit: number): string | null | false {
  if (value === undefined) return null;
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  if (value !== value.trim() || length < 1 || length > limit || CONTROL_CHARACTER.test(value)) return false;
  return value;
}

/** DB 행 → 배너. 규칙을 하나라도 어기면 null(그리지 않는다). */
export function parseCollectionBannerRow(
  row: CollectionBannerRow,
  publicUrlFor: (path: string) => string,
): CollectionBanner | null {
  if (!isCollectionBannerSlot(row.slot)) return null;
  const title = row.title;
  if (typeof title !== 'string' || boundedText(title, COLLECTION_BANNER_TITLE_LIMIT) === false || !title) return null;
  if (!row.image_path || !HOME_CURATION_IMAGE_PATTERN.test(row.image_path)) return null;
  const href = row.link_path === null ? null : row.link_path.trim();
  if (href !== null && !isSafeInternalLink(href)) return null;

  const payload = row.payload ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Object.keys(payload).some((key) => !BANNER_PAYLOAD_KEYS.has(key))) return null;
  const subtitle = boundedText(payload.subtitle, COLLECTION_BANNER_SUBTITLE_LIMIT);
  const imageAlt = boundedText(payload.image_alt, COLLECTION_BANNER_ALT_LIMIT);
  if (subtitle === false || imageAlt === false) return null;
  const mobileImagePath = payload.mobile_image_path;
  if (mobileImagePath !== undefined && (typeof mobileImagePath !== 'string' || !HOME_CURATION_IMAGE_PATTERN.test(mobileImagePath))) return null;
  if (payload.image_dim !== undefined && !isHomeHeroImageDim(payload.image_dim)) return null;
  if (payload.text_color !== undefined && !isHomeHeroTextColor(payload.text_color)) return null;

  const endsAt = row.active_to ? Date.parse(row.active_to) : null;
  return {
    id: row.id,
    slot: row.slot,
    title,
    subtitle,
    imageUrl: publicUrlFor(row.image_path),
    mobileImageUrl: typeof mobileImagePath === 'string' ? publicUrlFor(mobileImagePath) : null,
    href,
    imageAlt: imageAlt ?? '',
    /* 새 종류라 옛 표시를 지킬 필요가 없다 — 비어 있으면 레퍼런스처럼 딤 없이 잉크 글자다. */
    imageDim: isHomeHeroImageDim(payload.image_dim) ? payload.image_dim : 'none',
    textColor: isHomeHeroTextColor(payload.text_color) ? payload.text_color : 'black',
    endsAt: endsAt !== null && Number.isFinite(endsAt) ? endsAt : null,
  };
}

function isLiveInSlot(banner: CollectionBanner, slot: CollectionBannerSlot, now: number): boolean {
  return banner.slot === slot && (banner.endsAt === null || banner.endsAt > now);
}

/**
 * 이 슬롯의 노출 중 배너 중 카드팩·게임으로 가는 것이 있는가 — 있을 때만 로더가 카드 리워드 게이트를 읽는다
 * (게이트 읽기는 요청마다 DB 왕복이라 대부분의 요청에서는 건너뛴다).
 */
export function collectionBannersNeedCardRewardGate(
  banners: readonly CollectionBanner[],
  slot: CollectionBannerSlot,
  now: number,
): boolean {
  return banners.some((banner) => isLiveInSlot(banner, slot, now) && banner.href !== null && isCardRewardDestination(banner.href));
}

/**
 * 페이지에 그릴 배너 — 요청 시각에 끝난 행과 꺼진 목적지(카드 리워드·커뮤니티)로 가는 행을 거른 **뒤에** 페이지 몫까지 자른다.
 * 게이트로 빠진 자리는 다음 순서 배너가 채운다. 순서는 로더의 운영 순서 그대로다.
 */
export function liveCollectionBanners(
  banners: readonly CollectionBanner[],
  slot: CollectionBannerSlot,
  now: number,
  gates: ShellNoticeGates,
): CollectionBanner[] {
  return banners
    .filter((banner) => isLiveInSlot(banner, slot, now) && shellNoticeDestinationAllowed(banner.href, gates))
    .slice(0, collectionBannerDisplayLimit(slot));
}

/** 루프 슬라이더의 다음·이전 장. 레퍼런스 굿즈샵 배너는 처음과 끝이 이어진다(swiper loop). */
export function wrapCollectionBannerIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
