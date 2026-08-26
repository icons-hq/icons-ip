import { EmptyState } from '@/components/wc/EmptyState';
import { WcButton } from '@/components/wc/WcButton';

/* wc-root 래퍼는 White Catalog 토큰을 전역(:root)으로 승격하기 전까지 스코프를 이 표면 안에 가둔다. */
export default function NotFound() {
  return (
    <div className="wc-root">
      <div className="wc-fallback">
        <EmptyState
          title="페이지를 찾을 수 없습니다"
          titleAs="h1"
          description="주소가 바뀌었거나 삭제된 페이지예요."
          action={
            <WcButton href="/" variant="primary">
              홈으로 가기
            </WcButton>
          }
        />
      </div>
    </div>
  );
}
