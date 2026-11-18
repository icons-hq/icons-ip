'use client';

import { useCardRewardsEnabled } from '@/components/shell/CardRewardAvailability';
import { useCollectibleFeatures } from '@/components/shell/CollectibleFeatures';
import { Badge } from '@/components/wc/Badge';
import { WcButton } from '@/components/wc/WcButton';
import { hrefFor } from '@/lib/routes';

/* 카드 트레이드 v2 플레이스홀더 — DESIGN.md §8 "마켓·트레이드" 행, S5 계약 §2 .wc-placeholder·§3 확정 카피.
   트레이드는 카드 C2C(v2 범위)다. 구 명칭은 굿즈 클레임 유형과 겹치므로 쓰지 않는다(CONTEXT.md).
   mock 매물 리스트와 수수료·체결 방식을 단정하는 문구는 싣지 않는다. */
export function Exchange() {
  const cardRewardsEnabled = useCardRewardsEnabled();
  /* 카드 바인더가 숨김(DB 공개 스위치)이면 바인더 버튼을 그리지 않는다. */
  const binderEnabled = useCollectibleFeatures().binder;

  return (
    <div className="wc-root">
      <section className="wc-placeholder">
        <Badge className="wc-placeholder__badge">V2 예정</Badge>
        <h1>카드 트레이드</h1>
        <p className="wc-placeholder__body">
          보유 카드를 팬끼리 직접 거래하는 트레이드는 v2에서 열려요.
        </p>
        <div className="wc-placeholder__cta">
          {cardRewardsEnabled ? (
            <WcButton href={hrefFor('packs')} variant="primary">카드팩 열기</WcButton>
          ) : null}
          {binderEnabled ? (
            <WcButton href={hrefFor('binder')} variant={cardRewardsEnabled ? 'outline' : 'primary'}>내 바인더</WcButton>
          ) : null}
        </div>
      </section>
    </div>
  );
}
