import { notFound } from 'next/navigation';
import { IpHub } from '@/components/screens/IpHub';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogIpDetail, getCatalogSnapshot } from '@/lib/catalog';
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
  const [catalog, detail, followState] = await Promise.all([
    getCatalogSnapshot(),
    getCatalogIpDetail(id, { viewerId: auth.user?.id ?? null, isStaff: auth.isStaff }),
    getIpFollowState(id),
  ]);

  if (!detail) notFound();

  const query = (await searchParams) ?? {};

  return (
    <IpHub
      ips={catalog.ips}
      detail={detail}
      followState={followState}
      followError={firstParam(query.follow_error) === '1'}
    />
  );
}
