import { Market } from '@/components/screens/Market';
import { MarketDemo } from '@/components/screens/MarketDemo';
import { canViewSecondaryMarketDemo } from '@/lib/secondary-market-demo.server';

/* 공개 표면은 v2 플레이스홀더 그대로다. 로그인한 staff/admin 에게만 같은 라우트가 mock 시연을
   렌더한다(lib/secondary-market-demo.ts). 쿠키를 읽는 판정이라 이 라우트는 동적이다. */
export default async function Page() {
  return (await canViewSecondaryMarketDemo()) ? <MarketDemo /> : <Market />;
}
