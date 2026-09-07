/* 온라인 팝업 디렉토리(/ip) 서버 wiring — R-03 §3.
 * 레거시 쿼리 /ip?ip=<id>는 유효한 id일 때만 개별 관(/ip/<id>)으로 redirect 하고,
 * 그 밖에는 디렉토리를 렌더한다(빈 카탈로그 처리도 화면 몫).
 *
 * IP 목록은 팬 많은 순 한 페이지만 읽는다 — 전량 select 는 1,000번째에서 잘린다(규모 ⑤). */

import { redirect } from 'next/navigation';
import { IpDirectory } from '@/components/screens/IpDirectory';
import { getStorefrontIpsPage } from '@/lib/storefront.server';

const IP_DIRECTORY_PAGE_SIZE = 200;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ ips }, query] = await Promise.all([
    getStorefrontIpsPage({ limit: IP_DIRECTORY_PAGE_SIZE }),
    searchParams,
  ]);

  const legacyId = firstParam(query.ip);
  if (legacyId && ips.some((ip) => ip.id === legacyId)) {
    redirect(`/ip/${encodeURIComponent(legacyId)}`);
  }

  return <IpDirectory ips={ips} />;
}
