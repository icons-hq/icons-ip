/* 온라인 팝업 개별 관(/ip/[id]) 서버 wiring — R-03 §1.9.
 * detail·followState를 병렬로 읽고, 무효 id는 notFound. 쿼리 플래그(follow_error 등)는
 * 팔로우·알림 액션의 redirect 계약(app/ip/actions.ts)과 짝이다. */

import { notFound } from 'next/navigation';
import { IpDetail } from '@/components/screens/IpDetail';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogIpDetail } from '@/lib/catalog';
import { getIpFollowState } from '@/lib/ip-follow.server';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = await params;
  const auth = await getCurrentAuthState();
  const [detail, followState] = await Promise.all([
    getCatalogIpDetail(id, { viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    getIpFollowState(id),
  ]);

  if (!detail) notFound();

  const query = (await searchParams) ?? {};

  return (
    <IpDetail
      detail={detail}
      followError={firstParam(query.follow_error) === '1'}
      followState={followState}
      notificationError={firstParam(query.notification_error) === '1'}
      notificationSaved={firstParam(query.notification_saved) === '1'}
    />
  );
}
