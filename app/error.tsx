'use client';

import { useEffect } from 'react';
import { EmptyState } from '@/components/wc/EmptyState';
import { WcButton } from '@/components/wc/WcButton';

/* 서버 컴포넌트에서 넘어온 오류는 digest만 남고 메시지가 지워지므로, 클라이언트 콘솔에도 원본을 한 번 남긴다. */
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="wc-root">
      <div className="wc-fallback">
        <EmptyState
          title="문제가 발생했습니다"
          description="일시적인 오류일 수 있어요. 다시 시도해 주세요."
          action={
            <div className="wc-btn-group">
              <WcButton onClick={() => retry()}>다시 시도</WcButton>
              <WcButton href="/" variant="primary">
                홈으로 가기
              </WcButton>
            </div>
          }
        />
      </div>
    </div>
  );
}
