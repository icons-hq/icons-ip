'use client';

/* 온라인 팝업 개별 관(/ip/[id]) — R-03 §1.9 브랜드관 재현.
 * 풀블리드 배너(IP명·팔로우 하트+팬 수·설명·해시태그) + IP로 좁힌 굿즈샵 컬렉션(사이드바·정렬·VIEW MORE·
 * 212 카드 — 11 IP-01) + 연결 밴드 3종.
 * 배너 그림은 IP관 PC/MO 배너(11 IP-06)가 있으면 그것, 없으면 키아트(ip.bg)다 — lib/ip-hall-banner.ts 의 폭별 폴백.
 * 팔로우·알림 폼은 app/ip/actions.ts 계약(hidden ipId·intent·next·setBoth·autoFollow…)을 그대로 승계한다. */

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useFormStatus } from 'react-dom';
import { setIpNotificationPreferencesAction, toggleIpFollowAction } from '@/app/ip/actions';
import { CollectionBrowser } from '@/components/shop/CollectionBrowser';
import { shopQueryString } from '@/components/shop/collection-filters';
import { EmptyState } from '@/components/wc/EmptyState';
import { GoodsSalePeriodRefresh } from '@/components/shop/GoodsSalePeriodRefresh';
import { SectionHeading } from '@/components/wc/SectionHeading';
import type { CatalogIpDetail } from '@/lib/catalog';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { compactNumber } from '@/lib/format';
import type { IpFollowState } from '@/lib/ip-follow';
import { IP_HALL_BANNER_EMPTY_SOURCE, type IpHallBanner } from '@/lib/ip-hall-banner';
import { ipEn } from '@/lib/ip-display';
import { publicIpHref } from '@/lib/ip-identity';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { hrefFor } from '@/lib/routes';
import {
  SHOP_VIEW_SORTS,
  parseShopSearchParams,
  selectCollectionGoods,
  type ShopListQuery,
  type ShopListResult,
} from '@/lib/shop-catalog';

/** IP관 굿즈 컬렉션 — 서버 페이지가 URL 필터·정렬로 계산해 내려준다(`app/ip/[id]/page.tsx`). */
export interface IpGoodsCollection {
  query: ShopListQuery;
  result: ShopListResult;
}

/** URL 필터가 없을 때의 IP관 컬렉션. IP 축은 스코프가 이미 이 IP 하나라 받지 않는다. */
function ipGoodsCollection(detail: Pick<CatalogIpDetail, 'ip' | 'goods'>): IpGoodsCollection {
  const query = parseShopSearchParams({}, { view: 'ip', validIpIds: new Set() });
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
    <button className="wc-btn" disabled={pending} type="submit">
      {pending ? '저장 중' : label}
    </button>
  );
}

/* 미팔로우 상태의 원클릭 폼(불변): autoFollow·setBoth·notifyDrops·notifyEvents 전부 1로 고정 전송. */
function AutoFollowNotificationForm({ ipId, next }: { ipId: string; next: string }) {
  return (
    <form action={setIpNotificationPreferencesAction}>
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
      <fieldset
        disabled={pending}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 12px', padding: 0, border: 0 }}
      >
        <legend className="wc-sr-only">IP 알림 종류</legend>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <input
            defaultChecked={followState.notifyDrops}
            name="notifyDrops"
            role="switch"
            type="checkbox"
            value="1"
          />
          <span>새 굿즈·드롭</span>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
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
    <form action={setIpNotificationPreferencesAction} aria-label="IP 알림 설정">
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
  /** URL 필터·정렬이 걸린 굿즈 컬렉션. 생략하면 필터 없는 기본 컬렉션을 그린다. */
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
  const hallBanner = banner && (banner.imageUrl || banner.mobileImageUrl) ? banner : null;
  const canonicalSlug = publicSlug ?? ip.publicSlug ?? ip.id;
  const hallPath = publicIpHref(canonicalSlug);
  const goodsCollection = collection ?? ipGoodsCollection(detail);
  /* 팔로우·알림 폼은 저장(성공·실패·로그인 왕복) 뒤 지금 보던 IP 관으로 돌아온다 — 고른 굿즈 필터·정렬까지.
     액션은 이 주소를 safeNextPath 로 다시 검사하고 결과 파라미터를 searchParams 로 덧붙인다. */
  const collectionQuery = shopQueryString(goodsCollection.query);
  const returnPath = collectionQuery ? `${hallPath}?${collectionQuery}` : hallPath;
  const description = [ip.tagline, ip.synopsis].filter(Boolean).join(' ');
  /* 해시태그는 데스크톱에서 배너 안, 모바일에서 배너 아래에 선다(11 IP-05). 같은 목록을 두 자리에
     두고 폭마다 하나만 보인다 — 감춘 쪽은 display 로 빠져 스크린리더가 두 번 읽지 않는다. */
  const hashtags = (placement: 'banner' | 'below') => (
    <ul className={`wc-iphall__hashtags wc-iphall__hashtags--${placement}`}>
      <li>{`#${ipEn(ip)}`}</li>
      <li>{`#${ip.v.label}`}</li>
    </ul>
  );

  return (
    <div className="wc-root wc-iphall">
      <GoodsSalePeriodRefresh goods={goods} />
      <section
        className="wc-iphall__banner"
        data-banner={hallBanner ? (hallBanner.imageUrl ? 'all' : 'mobile') : undefined}
        style={hallBanner
          ? hallBanner.imageUrl ? undefined : ({ '--wc-iphall-keyart': ip.bg } as CSSProperties)
          : { background: ip.bg, backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        {hallBanner ? <HallBannerMedia banner={hallBanner} /> : null}
        <div className="wc-container">
          <h1 className="wc-iphall__name">{ip.title}</h1>
          <div className="wc-iphall__follow">
            <FollowForm followState={followState} ipId={ip.id} next={returnPath} />
            <span className="wc-iphall__follow-count">
              <span className="wc-sr-only">팬 </span>
              {compactNumber(ip.fans)}
            </span>
          </div>
          {description ? <p className="wc-iphall__desc">{description}</p> : null}
          {hashtags('banner')}
        </div>
      </section>
      <div className="wc-container wc-iphall__tags-band">{hashtags('below')}</div>

      {/* 알림 폼·저장 결과는 배너의 흰 글자 영역이 아니라 흰 지면에서 다룬다(체크박스 가독성). */}
      <div className="wc-container">
        <section
          aria-label="IP 알림"
          style={{ display: 'grid', gap: 12, maxWidth: 448, margin: '32px 0 0' }}
        >
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
          {followState.isFollowed
            ? <NotificationPreferencesForm followState={followState} ipId={ip.id} next={returnPath} />
            : <AutoFollowNotificationForm ipId={ip.id} next={returnPath} />}
        </section>
      </div>

      <section aria-labelledby="iphall-goods-heading" className="wc-iphall__goods">
        <div className="wc-container">
          <div className="wc-iphall__goods-head">
            <SectionHeading id="iphall-goods-heading" title={`${ip.title}의 굿즈`} />
            <Link className="wc-iphall__shop-link" href={`${hrefFor('shop')}?ip=${ip.id}`}>굿즈샵에서 전체 보기</Link>
          </div>
          {goodsCollection.result.total === 0 ? (
            <EmptyState description="새 굿즈가 입점하면 이 자리에 소개돼요." title="등록된 굿즈가 아직 없습니다" />
          ) : (
            /* 굿즈샵 컬렉션을 IP 범위로 재사용한다(DESIGN §8 'facet 축약 컬렉션'). IP 그룹은 값이 하나뿐이라 그리지 않는다. */
            <CollectionBrowser
              countNoun="굿즈"
              hrefFor={(next) => {
                const qs = shopQueryString(next);
                return qs ? `${hallPath}?${qs}` : hallPath;
              }}
              query={goodsCollection.query}
              result={goodsCollection.result}
              sheetDescription="원하는 타입과 가격을 골라보세요."
              showIpFacet={false}
              sorts={SHOP_VIEW_SORTS.ip}
              wishlist={wishlist}
            />
          )}
        </div>
      </section>

      <div className="wc-container">
        <nav aria-label="이 IP의 다른 공간" className="wc-iphall__links">
          <Link href={hrefFor('binder')}>{`카드 도감 ${cards.length}종`}</Link>
          <Link href={hrefFor('offlinePopups')}>오프라인 팝업</Link>
          {COMMUNITY_ENABLED && <Link href={`${hrefFor('community')}?ip=${ip.id}`}>팬덤 채널</Link>}
        </nav>
      </div>
    </div>
  );
}
