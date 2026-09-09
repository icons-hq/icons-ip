import { Badge } from '@/components/wc/Badge';

/* 시연 화면 상단 고정 안내 — 발표 중 화면을 보는 사람이 mock 임을 오해하지 않도록 두 화면이 같은 문장을 쓴다. */
export function DemoNotice() {
  return (
    <p className="wc-c2c__notice" role="note">
      <Badge>시연</Badge>
      <span>스태프 전용 시연 화면이에요. 매물·결제·체결은 모두 mock 데이터로, 실제 거래·정산은 일어나지 않아요.</span>
    </p>
  );
}
