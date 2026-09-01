import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { COIN_LEDGER_LIMIT, MyCoins } from '@/components/screens/MyCoins';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadCoinLedger, loadCoinOverview } from '@/lib/coins.server';

export const metadata: Metadata = {
  title: '코인 — ICONS',
  description: '보유한 코인과 적립·사용 내역을 확인합니다.',
  robots: { index: false, follow: false },
};

/* 코인 잔액·원장은 개인 기록이라 공개 브라우징 대상이 아니다 — 진입에 로그인이 필요하다.
   두 로더 모두 비로그인에 빈 값으로 답하므로, 로그인 없이 열면 빈 화면이
   "코인이 없다"는 거짓말이 된다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/coins')}`);

  const [coin, ledger] = await Promise.all([
    loadCoinOverview(),
    loadCoinLedger(COIN_LEDGER_LIMIT),
  ]);

  return <MyCoins coin={coin} ledger={ledger} />;
}
