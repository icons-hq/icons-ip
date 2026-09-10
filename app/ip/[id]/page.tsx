/* 온라인 팝업 개별 관(/ip/[id]) 서버 wiring — R-03 §1.9.
 * detail·followState를 병렬로 읽고, 무효 id는 notFound. 쿼리 플래그(follow_error 등)는
 * 팔로우·알림 액션의 redirect 계약(app/ip/actions.ts)과 짝이다. */

import { notFound, permanentRedirect } from 'next/navigation';
import { IpDetail } from '@/components/screens/IpDetail';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogIpDetail } from '@/lib/catalog';
import { publicIpHref } from '@/lib/ip-identity';
import { resolvePublicIpIdentity } from '@/lib/ip-identity.server';
import { getIpFollowState } from '@/lib/ip-follow.server';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function canonicalIpRedirectHref(publicSlug: string, query: Record<string, string | string[] | undefined>) {
  const safeQuery = new URLSearchParams();
  for (const key of ['follow_error', 'notification_error', 'notification_saved'] as const) {
    if (firstParam(query[key]) === '1') safeQuery.set(key, '1');
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
  const [detail, followState] = await Promise.all([
    getCatalogIpDetail(identity.internalId, { viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    getIpFollowState(identity.internalId),
  ]);

  if (!detail) notFound();

  return (
    <IpDetail
      detail={detail}
      publicSlug={identity.publicSlug}
      followError={firstParam(query.follow_error) === '1'}
      followState={followState}
      notificationError={firstParam(query.notification_error) === '1'}
      notificationSaved={firstParam(query.notification_saved) === '1'}
    />
  );
}
