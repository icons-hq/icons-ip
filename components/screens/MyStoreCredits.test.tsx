import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StoreCreditHistory } from '@/lib/store-credits';
import { MyStoreCredits, StoreCreditHistoryList } from './MyStoreCredits';
vi.mock('@/components/shell/CardRewardAvailability', () => ({ useCardRewardsEnabled: () => false }));
const history: StoreCreditHistory = {
  userId: 'buyer', enabled: false, available: 5000, reserved: 1000, debt: 200,
  total: 61, page: 2, pageSize: 30, items: [{
    id: '31', kind: 'consume', amount: 0, availableDelta: 0, reservedDelta: -1000, debtDelta: 0,
    orderId: 'order-31', lotId: 'lot-1', actorId: null, reason: '', expiresAt: null, createdAt: '2026-09-10T00:00:00Z',
  }],
};
describe('고객 적립금 이력', () => {
  it('비활성 상태에서도 잔액·대기·회수 예정 금액을 정확히 구별한다', () => {
    const html = renderToStaticMarkup(<MyStoreCredits history={history} />);
    expect(html).toContain('<strong>5,000</strong>원');
    expect(html).toContain('주문 사용 대기 1,000원');
    expect(html).toContain('회수 예정 200원');
    expect(html).toContain('적립금 지급과 주문 사용을 준비 중입니다');
    expect(html).toContain('1,000원 사용 확정');
  });
  it('조회 실패를 0원 잔액으로 표시하지 않는다', () => {
    const html = renderToStaticMarkup(<MyStoreCredits history={null} />);
    expect(html).toContain('적립금 내역을 불러오지 못했습니다');
    expect(html).not.toContain('aria-label="적립금 잔액"');
  });
  it('서버의 전체 건수로 이전·다음 페이지와 정확한 주문으로 이동한다', () => {
    const html = renderToStaticMarkup(<StoreCreditHistoryList history={history} pagePath="/my/store-credits" />);
    expect(html).toContain('전체 61건');
    expect(html).toContain('/my/store-credits?page=1');
    expect(html).toContain('/my/store-credits?page=3');
    expect(html).toContain('/orders/order-31');
  });
});
