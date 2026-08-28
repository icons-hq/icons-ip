import type { Metadata } from 'next';
import { EmptyState } from '@/components/wc/EmptyState';
import { WcButton } from '@/components/wc/WcButton';

export const metadata: Metadata = {
  title: '위시리스트 — ICONS',
  description: '찜해 둔 굿즈를 한곳에 모아 보는 위시리스트를 준비하고 있어요.',
  robots: { index: false, follow: false },
};

/* 셸(바텀 탭·푸터·전체 메뉴)이 노출하는 위시 링크의 목적지다. 실화면(찜 저장·목록)은
   S4 커머스 코어(migration③ wishlists) 범위라, 그 전까지 dead link 404만 막는 플레이스홀더다.
   보여줄 개인 데이터가 아직 없어 공개로 두고, 로그인 게이트는 S4 실화면과 함께 들어온다.
   wc-fallback 크롬 차용도 한시적이다 — 마이 표면군 정본 크롬은 mypage-shell(S6)이다.
   wc-root 래퍼는 White Catalog 토큰을 전역(:root)으로 승격하기 전까지 스코프를 이 표면 안에 가둔다. */
export default function Page() {
  return (
    <div className="wc-root">
      <div className="wc-fallback">
        <EmptyState
          title="위시리스트를 준비하고 있어요"
          titleAs="h1"
          description="찜해 둔 굿즈를 한곳에 모아 보는 공간이 곧 열려요. 지금은 굿즈샵에서 마음에 드는 굿즈를 먼저 만나 보세요."
          action={
            <WcButton href="/shop" variant="primary">
              굿즈샵 둘러보기
            </WcButton>
          }
        />
      </div>
    </div>
  );
}
