import { EmptyState } from '@/components/wc/EmptyState';
import { WcButton } from '@/components/wc/WcButton';

/* 셸(GNB·메가메뉴·전체 메뉴 시트)이 노출하는 NEW·BEST 링크의 목적지 껍데기다. 실화면(큐레이션
   컬렉션·filter-sidebar)은 S4 커머스 코어 범위라, 그 전까지 /shop/[goodId]에 잡혀 soft 404
   화면으로 떨어지던 것만 막는다. 정적 세그먼트가 동적 [goodId]보다 우선해 굿즈 상세 라우팅은
   바뀌지 않고, wc-fallback 크롬 차용도 그때까지의 한시 조치다.
   wc-root 래퍼는 White Catalog 토큰을 전역(:root)으로 승격하기 전까지 스코프를 이 표면 안에 가둔다. */
export function CollectionPlaceholder({ description, title }: { description: string; title: string }) {
  return (
    <div className="wc-root">
      <div className="wc-fallback">
        <EmptyState
          title={title}
          titleAs="h1"
          description={description}
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
