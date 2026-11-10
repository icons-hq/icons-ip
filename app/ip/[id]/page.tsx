/* 온라인 팝업 개별 관(/ip/[id]) 서버 wiring — R-03 §1.9.
 * detail·followState·목록 위시 상태를 병렬로 읽고, 무효 id는 notFound. 쿼리 플래그(follow_error 등)는
 * 팔로우·알림 액션의 redirect 계약(app/ip/actions.ts)과 짝이다. 굿즈 영역은 IP로 좁힌 굿즈샵 컬렉션이라
 * 카테고리·타입·가격·정렬 파라미터를 함께 읽는다(LFS 패리티 2차 L4 · IP-01). */

import { notFound, permanentRedirect } from 'next/navigation';
import { IpDetail } from '@/components/screens/IpDetail';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogIpDetail } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadPublicCatalogCategories } from '@/lib/catalog-categories.server';
import { publicIpHref } from '@/lib/ip-identity';
import { resolvePublicIpIdentity } from '@/lib/ip-identity.server';
import { getIpFollowState } from '@/lib/ip-follow.server';
import { loadIpHallBanner } from '@/lib/ip-hall-banner.server';
import { parseShopSearchParams, selectCollectionGoods } from '@/lib/shop-catalog';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/* 옛 별칭은 정본 슬러그로 보낸다. 액션 결과 플래그와 굿즈 컬렉션 필터·정렬만 옮기고 나머지는 버린다 —
   값 검증은 정본 페이지의 파서(parseShopSearchParams)가 다시 한다. */
const COLLECTION_PARAMS = ['category', 'type', 'min', 'max', 'sort'] as const;

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
    getAdultGoodsAccess().then(adultGoods => getCatalogIpDetail(identity.internalId, { viewerId: auth.user?.id ?? null, isStaff: auth.isStaff, adultGoods })),
    getIpFollowState(identity.internalId),
    loadListingWishlist(),
    /* IP관 PC/MO 배너(IP-06). 없거나 못 읽으면 null — 배너는 키아트 그대로다. */
    loadIpHallBanner(identity.internalId),
  ]);

  if (!detail) notFound();

  /* 굿즈 영역은 IP로 좁힌 굿즈샵 컬렉션이다(11 IP-01). 스코프가 이미 이 IP 하나라 ip 파라미터는 받지 않고,
     카테고리·타입·가격·정렬만 URL 에서 읽는다. */
  const categories = detail.source === 'supabase' ? await loadPublicCatalogCategories() : [];
  const listQuery = parseShopSearchParams(query, {
    view: 'ip',
    validIpIds: new Set(),
    validCategoryIds: new Set(categories.map((category) => category.id)),
  });
  const collection = {
    query: listQuery,
    result: selectCollectionGoods(detail.goods, { ips: [detail.ip], categories, reviewSummaries: detail.reviewSummaries }, listQuery),
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
