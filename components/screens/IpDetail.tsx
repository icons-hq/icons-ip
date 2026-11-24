'use client';

/* 온라인 팝업 개별 관(/ip/[id]) — X SQUARE 카테고리 화면 틀(ADR-0043, 스펙 C §2).
 * 위에서 아래로: IP 배너 한 장(IP명·소개·해시태그) → 팔로우·알림 한 줄 → 제목 줄('<IP명>의 굿즈' + 정렬 셀렉트) →
 * 굿즈샵 카테고리 화면과 같은 ListingGrid(4열 카드·VIEW MORE) → 이 IP의 다른 공간 링크.
 * 왼쪽 필터(타입·가격)는 없다 — 옛 type·min·max 주소는 서버 페이지가 무시한다.
 * 배너 그림은 IP관 PC/MO 배너(11 IP-06)가 있으면 그것, 없으면 키아트(ip.bg)다 — lib/ip-hall-banner.ts 의 폭별 폴백.
 * 팔로우·알림 폼은 app/ip/actions.ts 계약(hidden ipId·intent·next·setBoth·autoFollow…)을 그대로 승계한다. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useFormStatus } from 'react-dom';
import { setIpNotificationPreferencesAction, toggleIpFollowAction } from '@/app/ip/actions';
import { ListingGrid } from '@/components/shop/ListingGrid';
import { ListingHeader } from '@/components/shop/ListingHeader';
import { EmptyState } from '@/components/wc/EmptyState';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import type { CatalogIpDetail } from '@/lib/catalog';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { useCollectibleFeatures } from '@/components/shell/CollectibleFeatures';
import { compactNumber } from '@/lib/format';
import type { IpFollowState } from '@/lib/ip-follow';
import { IP_HALL_BANNER_EMPTY_SOURCE, type IpHallBanner } from '@/lib/ip-hall-banner';
import { selectOfflinePopupEvents } from '@/lib/events-catalog';
import { ipEn } from '@/lib/ip-display';
import { publicIpHref } from '@/lib/ip-identity';
import { LISTING_SORTS } from '@/lib/listing-sorts';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { hrefFor } from '@/lib/routes';
import {
  listingQueryString,
  parseListingSearchParams,
  selectCollectionGoods,
  type ShopListQuery,
  type ShopListResult,
  type ShopSort,
} from '@/lib/shop-catalog';

/** IP관 굿즈 컬렉션 — 서버 페이지가 URL 필터·정렬로 계산해 내려준다(`app/ip/[id]/page.tsx`). */
export interface IpGoodsCollection {
  query: ShopListQuery;
  result: ShopListResult;
}

/** URL 정렬이 없을 때의 IP관 컬렉션. IP 축은 스코프가 이미 이 IP 하나라 받지 않는다. */
function ipGoodsCollection(detail: Pick<CatalogIpDetail, 'ip' | 'goods'>): IpGoodsCollection {
  const { query } = parseListingSearchParams({}, 'all');
  return { query, result: selectCollectionGoods(detail.goods, { ips: [detail.ip] }, query) };
}

/* 하트 원형 40×40 은 아이콘 단독 버튼이라(R-03 §1.9) 팔로우 상태 카피는 스크린리더 이름으로 승계한다. */
function FollowSubmit({ isFollowed }: { isFollowed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      className={`wc-iphall__follow-heart${isFollowed ? ' is-followed' : ''}`}
      disabled={pending}
      type="submit"
    >
      <svg aria-hidden fill={isFollowed ? 'currentColor' : 'none'} height="21" viewBox="0 0 22 21" width="22">
        <path
          d="M11 19.2 2.8 11a5.7 5.7 0 0 1 0-8 5.6 5.6 0 0 1 7.9 0l.3.3.3-.3a5.6 5.6 0 0 1 7.9 0 5.7 5.7 0 0 1 0 8Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
      <span className="wc-sr-only">
        {pending ? '저장 중' : isFollowed ? '팬덤 가입됨 ✓' : '팬덤 가입 — 무료'}
      </span>
    </button>
  );
}

/* 팔로우 폼 계약(불변): hidden ipId·intent(follow|unfollow)·next.
 * 비로그인은 액션이 /login?next= 로 보내므로 클라이언트 게이트를 두지 않는다. */
function FollowForm({ followState, ipId, next }: { followState: IpFollowState; ipId: string; next: string }) {
  return (
    <form action={toggleIpFollowAction}>
      <input name="ipId" type="hidden" value={ipId} />
      <input name="intent" type="hidden" value={followState.isFollowed ? 'unfollow' : 'follow'} />
      <input name="next" type="hidden" value={next} />
      <FollowSubmit isFollowed={followState.isFollowed} />
    </form>
  );
}

function NotificationSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="wc-iphall__bar-submit" disabled={pending} type="submit">
      {pending ? '저장 중' : label}
    </button>
  );
}

/* 미팔로우 상태의 원클릭 폼(불변): autoFollow·setBoth·notifyDrops·notifyEvents 전부 1로 고정 전송. */
function AutoFollowNotificationForm({ ipId, next }: { ipId: string; next: string }) {
  return (
    <form action={setIpNotificationPreferencesAction} className="wc-iphall__notify">
      <input name="ipId" type="hidden" value={ipId} />
      <input name="next" type="hidden" value={next} />
      <input name="autoFollow" type="hidden" value="1" />
      <input name="setBoth" type="hidden" value="1" />
      <input name="notifyDrops" type="hidden" value="1" />
      <input name="notifyEvents" type="hidden" value="1" />
      <NotificationSubmit label="팔로우하고 알림 받기" />
    </form>
  );
}

function NotificationPreferenceFields({ followState }: { followState: IpFollowState }) {
  const { pending } = useFormStatus();
  return (
    <>
      <fieldset className="wc-iphall__prefs" disabled={pending}>
        <legend className="wc-sr-only">IP 알림 종류</legend>
        <label className="wc-iphall__pref">
          <input
            defaultChecked={followState.notifyDrops}
            name="notifyDrops"
            role="switch"
            type="checkbox"
            value="1"
          />
          <span>새 굿즈·드롭</span>
        </label>
        <label className="wc-iphall__pref">
          <input
            defaultChecked={followState.notifyEvents}
            name="notifyEvents"
            role="switch"
            type="checkbox"
            value="1"
          />
          <span>팝업·이벤트</span>
        </label>
      </fieldset>
      <NotificationSubmit label="알림 설정 저장" />
    </>
  );
}

/* 팔로우 상태의 알림 설정 폼(불변): hidden ipId·next·setBoth + notifyDrops·notifyEvents 체크박스. */
function NotificationPreferencesForm({ followState, ipId, next }: { followState: IpFollowState; ipId: string; next: string }) {
  return (
    <form action={setIpNotificationPreferencesAction} aria-label="IP 알림 설정" className="wc-iphall__notify">
      <input name="ipId" type="hidden" value={ipId} />
      <input name="next" type="hidden" value={next} />
      <input name="setBoth" type="hidden" value="1" />
      <NotificationPreferenceFields followState={followState} />
    </form>
  );
}

/*
 * 배너 그림(IP-06). 없으면 지금처럼 키아트를 섹션 배경으로 깐다(마크업·스타일 그대로).
 * PC 배너가 있으면 키아트 배경을 걷고 picture 하나로 폭을 고른다(모바일 배너 → PC 배너). 모바일 배너만 있으면 데스크톱은 키아트를
 * CSS 변수로 남기고(모바일에서는 내려받지 않는다), picture 는 데스크톱에서 1×1 빈 그림을 골라 모바일 그림을 받지 않는다.
 * 그림은 IP명·설명이 텍스트로 얹히는 배경이라 장식(alt="")이고, 첫 화면 LCP 후보라 우선 로드한다.
 */
function HallBannerMedia({ banner }: { banner: IpHallBanner }) {
  const src = banner.imageUrl ?? banner.mobileImageUrl;
  if (!src) return null;
  return (
    <picture className="wc-iphall__banner-media">
      {banner.imageUrl
        ? banner.mobileImageUrl ? <source media="(max-width: 749px)" srcSet={banner.mobileImageUrl} /> : null
        : <source media="(min-width: 750px)" srcSet={IP_HALL_BANNER_EMPTY_SOURCE} />}
      <img alt="" decoding="async" fetchPriority="high" loading="eager" sizes="100vw" src={src} />
    </picture>
  );
}

export function IpDetail({
  banner = null,
  collection,
  detail,
  publicSlug,
  followState,
  followError,
  notificationError,
  notificationSaved,
  wishlist,
}: {
  /** IP관 PC/MO 배너(lib/ip-hall-banner.server). 생략·null 이면 키아트 배경 그대로다. */
  banner?: IpHallBanner | null;
  /** URL 정렬이 걸린 굿즈 컬렉션. 생략하면 기본 정렬 컬렉션을 그린다. */
  collection?: IpGoodsCollection;
  detail: CatalogIpDetail;
  publicSlug?: string;
  followState: IpFollowState;
  followError: boolean;
  notificationError: boolean;
  notificationSaved: boolean;
  /** 목록 하트의 초기 상태. 생략하면 하트를 그리지 않는다. */
  wishlist?: ListingWishlist | null;
}) {
  const { ip, goods, cards } = detail;
  const router = useRouter();
  /* 카드 도감(바인더) 링크는 카드 바인더 공개 스위치가 켜진 동안에만 그린다(lib/collectible-features.ts). */
  const binderEnabled = useCollectibleFeatures().binder;
  const hallBanner = banner && (banner.imageUrl || banner.mobileImageUrl) ? banner : null;
  const canonicalSlug = publicSlug ?? ip.publicSlug ?? ip.id;
  const hallPath = publicIpHref(canonicalSlug);
  const goodsCollection = collection ?? ipGoodsCollection(detail);
  const { query, result } = goodsCollection;
  /* 팔로우·알림 폼은 저장(성공·실패·로그인 왕복) 뒤 지금 보던 IP 관으로 돌아온다 — 고른 정렬까지.
     액션은 이 주소를 safeNextPath 로 다시 검사하고 결과 파라미터를 searchParams 로 덧붙인다. */
  const sortQuery = listingQueryString(query);
  const returnPath = sortQuery ? `${hallPath}?${sortQuery}` : hallPath;
  const description = [ip.tagline, ip.synopsis].filter(Boolean).join(' ');
  /* 진행·예매·예정 중인 오프라인 팝업이 이 IP 에 있을 때만 목록으로 가는 링크를 둔다(끝난 팝업만이면 빈 칸이라 감춘다). */
  const hasOfflinePopup = selectOfflinePopupEvents(detail.events).some((event) => ['진행중', '예매중', '예정'].includes(event.status));

  const navigateSort = (sort: ShopSort) => {
    if (sort === query.sort) return;
    const next = listingQueryString({ ...query, sort });
    router.push(next ? `${hallPath}?${next}` : hallPath, { scroll: false });
  };

  return (
    <main className="wc-root wc-listing wc-iphall" data-lead="banner">
      <GoodsSalePeriodRefresh goods={goods} />
      <div className="wc-container wc-container--wide">
        <section
          className="wc-iphall__banner"
          data-banner={hallBanner ? (hallBanner.imageUrl ? 'all' : 'mobile') : undefined}
          style={hallBanner
            ? hallBanner.imageUrl ? undefined : ({ '--wc-iphall-keyart': ip.bg } as CSSProperties)
            : { background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          {hallBanner ? <HallBannerMedia banner={hallBanner} /> : null}
          <div className="wc-iphall__copy">
            <h1 className="wc-iphall__name">{ip.title}</h1>
            {description ? <p className="wc-iphall__desc">{description}</p> : null}
            <ul className="wc-iphall__hashtags">
              <li>{`#${ipEn(ip)}`}</li>
              <li>{`#${ip.v.label}`}</li>
            </ul>
          </div>
        </section>

        {/* 팔로우(무료 팬덤 가입)와 알림 설정은 배너 아래 한 줄이다 — 흰 지면이라 체크박스 가독성도 지킨다. */}
        <section aria-label="IP 알림" className="wc-iphall__bar">
          <div className="wc-iphall__bar-row">
            <div className="wc-iphall__follow">
              <FollowForm followState={followState} ipId={ip.id} next={returnPath} />
              <span className="wc-iphall__follow-count">
                <span className="wc-sr-only">팬 </span>
                {compactNumber(ip.fans)}
              </span>
            </div>
            {followState.isFollowed
              ? <NotificationPreferencesForm followState={followState} ipId={ip.id} next={returnPath} />
              : <AutoFollowNotificationForm ipId={ip.id} next={returnPath} />}
          </div>
          {followError ? (
            <p className="wc-iphall__notice is-error" role="alert">
              팔로우 상태를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : null}
          {notificationError ? (
            <p className="wc-iphall__notice is-error" role="alert">
              알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          ) : null}
          {notificationSaved && !notificationError ? (
            <p aria-live="polite" className="wc-iphall__notice is-success" role="status">
              알림 설정을 저장했습니다.
            </p>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="iphall-goods-heading" className="wc-container wc-container--wide wc-iphall__goods">
        {/* 제목은 굿즈샵 카테고리 화면과 같은 목록 머리다. 페이지의 h1 은 배너의 IP명이라 여기는 h2 다. */}
        <ListingHeader
          headingId="iphall-goods-heading"
          headingLevel={2}
          sort={result.total > 0 ? { value: query.sort, options: LISTING_SORTS, onChange: navigateSort } : null}
          title={`${ip.title}의 굿즈`}
        />
        {result.total === 0 ? (
          <div className="wc-listing__empty">
            <EmptyState description="새 굿즈가 입점하면 이 자리에 소개돼요." title="등록된 굿즈가 아직 없습니다" />
          </div>
        ) : (
          <ListingGrid resetKey={`ip|${hallPath}|${sortQuery}`} result={result} wishlist={wishlist} />
        )}
      </section>

      <div className="wc-container wc-container--wide">
        <nav aria-label="이 IP의 다른 공간" className="wc-iphall__links">
          <Link href={`${hrefFor('shop')}?ip=${ip.id}`}>굿즈샵에서 전체 보기</Link>
          {binderEnabled && <Link href={hrefFor('binder')}>{`카드 도감 ${cards.length}종`}</Link>}
          {hasOfflinePopup && <Link href={`${hrefFor('offlinePopups')}?ip=${ip.id}`}>오프라인 팝업</Link>}
          {COMMUNITY_ENABLED && <Link href={`${hrefFor('community')}?ip=${ip.id}`}>팬덤 채널</Link>}
        </nav>
      </div>
    </main>
  );
}
