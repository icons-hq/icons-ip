import { IpHub } from '@/components/screens/IpHub';
import { Empty } from '@/components/ui/Empty';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogIpDetail, getCatalogSnapshot } from '@/lib/catalog';
import { getIpFollowState } from '@/lib/ip-follow.server';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const catalog = await getCatalogSnapshot();
  const query = await searchParams;
  const target = catalog.ips.find((ip) => ip.id === firstParam(query.ip)) ?? catalog.ips[0];

  if (!target) {
    return (
      <div className="screen">
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 80 }}>
          <Empty icon="ip" text="등록된 IP가 아직 없습니다" sub="곧 새로운 IP가 공개될 예정이에요." />
        </div>
      </div>
    );
  }

  const auth = await getCurrentAuthState();
  const [detail, followState] = await Promise.all([
    getCatalogIpDetail(target.id, { viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    getIpFollowState(target.id),
  ]);

  if (!detail) {
    return (
      <div className="screen">
        <div className="wrap" style={{ paddingTop: 48, paddingBottom: 80 }}>
          <Empty icon="ip" text="IP 정보를 불러오지 못했습니다" sub="잠시 후 다시 시도해주세요." />
        </div>
      </div>
    );
  }

  return (
    <IpHub
      ips={catalog.ips}
      detail={detail}
      followState={followState}
      followError={firstParam(query.follow_error) === '1'}
    />
  );
}
