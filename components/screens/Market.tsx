import { Badge } from '@/components/wc/Badge';
import { WcButton } from '@/components/wc/WcButton';

/* 중고 마켓 v2 플레이스홀더 — DESIGN.md §8 "마켓·트레이드" 행, S5 계약 §2 .wc-placeholder·§3 확정 카피.
   마켓은 굿즈 C2C 중고 거래(v2 범위)다(CONTEXT.md). mock 매물 그리드와 검수·정산 프로세스를
   단정하는 문구는 싣지 않고, v2 안내와 지금 가능한 행동만 남긴다. */
export function Market() {
  return (
    <div className="wc-root">
      <section className="wc-placeholder">
        <Badge className="wc-placeholder__badge">V2 예정</Badge>
        <h1>중고 마켓</h1>
        <p className="wc-placeholder__body">
          팬과 팬을 잇는 굿즈 C2C 중고 거래를 준비하고 있어요. 검수·정산 정책과 함께 v2에서 열립니다.
        </p>
        <div className="wc-placeholder__cta">
          <WcButton href="/shop" variant="primary">굿즈샵 둘러보기</WcButton>
        </div>
      </section>
    </div>
  );
}
