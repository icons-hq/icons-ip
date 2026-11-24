/* 온라인 팝업 개별 관(/ip/[id]) 서버 wiring — X SQUARE 카테고리 화면 틀(ADR-0043).
 * detail·followState·목록 위시 상태를 병렬로 읽고, 무효 id는 notFound. 쿼리 플래그(follow_error 등)는
 * 팔로우·알림 액션의 redirect 계약(app/ip/actions.ts)과 짝이다. 굿즈 영역은 IP로 좁힌 굿즈 목록이라 정렬 파라미터만 읽는다. */

import { notFound, permanentRedirect } from 'next/navigation';
import { IpDetail } from '@/components/screens/IpDetail';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogIpDetail } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadListingSortOrders } from '@/lib/goods-listing-orders.server';
import { publicIpHref } from '@/lib/ip-identity';
import { resolvePublicIpIdentity } from '@/lib/ip-identity.server';
import { getIpFollowState } from '@/lib/ip-follow.server';
import { loadIpHallBanner } from '@/lib/ip-hall-banner.server';
import { isServerOrderedSort, parseListingSearchParams, selectCollectionGoods } from '@/lib/shop-catalog';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/* 옛 별칭은 정본 슬러그로 보낸다. 액션 결과 플래그와 굿즈 정렬만 옮기고 나머지는 버린다 —
   값 검증은 정본 페이지의 파서(parseListingSearchParams)가 다시 한다. 필터(타입·가격·카테고리)는 화면에서 없어졌다. */
const COLLECTION_PARAMS = ['sort'] as const;

function canonicalIpRedirectHref(publicSlug: string, query: Record<string, string | string[] | undefined>) {
  const safeQuery = new URLSearchParams();
  for (const key of ['follow_error', 'notification_error', 'notification_saved'] as const) {
    if (firstParam(query[key]) === '1') safeQuery.set(key, '1');
  }
  for (const key of COLLECTION_PARAMS) {
    const value = query[key];
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) safeQuery.append(key, item);
  }
  const suffix = safeQuery.toString();
  return `${publicIpHref(publicSlug)}${suffix ? `?${suffix}` : ''}`;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const identity = await resolvePublicIpIdentity(id);
  if (!identity) notFound();
  const query = (await searchParams) ?? {};
  if (identity.isAlias) permanentRedirect(canonicalIpRedirectHref(identity.publicSlug, query));

  const auth = await getCurrentAuthState();
  const [detail, followState, wishlist, banner] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogIpDetail(identity.internalId, { viewerId: auth.user?.id ?? null, isStaff: auth.isStaff, adultGoods, storefrontReadCache: true })),
    getIpFollowState(identity.internalId),
    loadListingWishlist(),
    /* IP관 PC/MO 배너(IP-06). 없거나 못 읽으면 null — 배너는 키아트 그대로다. */
    loadIpHallBanner(identity.internalId),
  ]);

  if (!detail) notFound();

  /* 굿즈 영역은 굿즈샵 카테고리 화면과 같은 틀이라 정렬만 URL 에서 읽는다(화면 정렬 7종). 옛 type·min·max·category·ip 주소는 무시한다.
     인기도·판매량·리뷰 많은순은 DB 가 정한 순서 배열이 필요해 그 정렬일 때만 읽는다. */
  const { query: listQuery } = parseListingSearchParams(query, 'all');
  const sortOrders = isServerOrderedSort(listQuery.sort) ? await loadListingSortOrders() : null;
  const collection = {
    query: listQuery,
    result: selectCollectionGoods(detail.goods, { ips: [detail.ip], reviewSummaries: detail.reviewSummaries }, listQuery, sortOrders),
  };

  return (
    <IpDetail
      banner={detail.source === 'supabase' ? banner : null}
      collection={collection}
      detail={detail}
      wishlist={wishlist}
      publicSlug={identity.publicSlug}
      followError={firstParam(query.follow_error) === '1'}
      followState={followState}
      notificationError={firstParam(query.notification_error) === '1'}
      notificationSaved={firstParam(query.notification_saved) === '1'}
    />
  );
}
