/* 온라인 팝업 디렉토리(/ip) 서버 wiring — R-03 §3.
 * 레거시 쿼리 /ip?ip=<id>는 유효한 id일 때만 개별 관(/ip/<id>)으로 redirect 하고,
 * 그 밖에는 전체 카탈로그로 디렉토리를 렌더한다(빈 카탈로그 처리도 화면 몫). */

import { redirect } from 'next/navigation';
import { IpDirectory } from '@/components/screens/IpDirectory';
import { getCatalogSnapshot } from '@/lib/catalog';

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [catalog, query] = await Promise.all([getCatalogSnapshot(), searchParams]);

  const legacyId = firstParam(query.ip);
  if (legacyId && catalog.ips.some((ip) => ip.id === legacyId)) {
    redirect(`/ip/${encodeURIComponent(legacyId)}`);
  }

  return <IpDirectory ips={catalog.ips} />;
}
