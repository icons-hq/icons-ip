import { NotFoundActions } from '@/components/shell/NotFoundActions';
import { EmptyState } from '@/components/wc/EmptyState';

/* wc-root 래퍼는 White Catalog 토큰을 전역(:root)으로 승격하기 전까지 스코프를 이 표면 안에 가둔다.
   404 기본 표면(CH-14): 제목 18/700 → 안내 → [이전 페이지][메인으로] 2CTA. 일러스트 자리는 ICONS 자체 라인아트
   (LG-7)가 오기 전까지 비워 둔다 — 빈 상자나 대체 그림 없이 제목부터 시작해도 가운데 정렬이 그대로 선다. */
export default function NotFound() {
  return (
    <div className="wc-root">
      <div className="wc-fallback wc-not-found">
        <EmptyState
          title="페이지를 찾을 수 없습니다"
          titleAs="h1"
          description="주소가 바뀌었거나 삭제된 페이지예요."
          action={<NotFoundActions />}
        />
      </div>
    </div>
  );
}
