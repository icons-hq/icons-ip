import { notFound } from 'next/navigation';
import { Exchange } from '@/components/screens/Exchange';
import { ExchangeDemo } from '@/components/screens/ExchangeDemo';
import { isCollectibleFeatureEnabled } from '@/lib/collectible-features.server';
import { canViewSecondaryMarketDemo } from '@/lib/secondary-market-demo.server';

/* 카드 트레이드는 운영하지 않는다 — DB 공개 스위치(lib/collectible-features.ts)가 꺼진 동안 누구에게나(스태프 포함) 404다.
   켜져 있으면 공개 표면은 v2 플레이스홀더 그대로이고, 로그인한 staff/admin 에게만 같은 라우트가 mock 시연을
   렌더한다(lib/secondary-market-demo.ts). 쿠키·DB를 읽는 판정이라 이 라우트는 동적이다. */
export default async function Page() {
  if (!await isCollectibleFeatureEnabled('exchange')) notFound();
  return (await canViewSecondaryMarketDemo()) ? <ExchangeDemo /> : <Exchange />;
}
