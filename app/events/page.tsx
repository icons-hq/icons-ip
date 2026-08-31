import type { Metadata } from 'next';
import { EmptyState } from '@/components/wc/EmptyState';

/* 캠페인 허브 자리표시 — S8 W2가 실제 캠페인 목록·로더로 교체한다.
   오프라인 팝업 예매는 /offline-popups로 이사했다(CONTEXT.md의 별개 도메인). */

export const metadata: Metadata = {
  title: '이벤트 — ICONS',
  description: 'ICONS의 기간 한정 캠페인과 프로모션을 모아 봅니다.',
};

export default function Page() {
  return (
    <div className="wc-root">
      <div className="wc-fallback">
        <EmptyState
          title="이벤트"
          titleAs="h1"
          description="진행 중인 캠페인을 준비하고 있어요."
        />
      </div>
    </div>
  );
}
