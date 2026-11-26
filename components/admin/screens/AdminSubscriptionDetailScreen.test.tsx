import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => ({ blocked: false, locked: false, pending: false, failure: null, retry: vi.fn(), run: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/admin/sales/subscriptions' }));
vi.mock('@/app/admin/subscription-actions', () => ({ inspectGoodsSubscriptionPaymentAction: vi.fn() }));
vi.mock('@/components/subscriptions/useSubscriptionRequest', () => ({ useSubscriptionRequest: () => request }));
import { AdminSubscriptionDetailScreen } from './AdminSubscriptionDetailScreen';
const ID = 'c00000a3-0000-4000-8000-00000000a301';
const data = { cycles: { rows: [{ id: 'cycle', number: 1, state: 'approved', scheduledAt: '2026-10-25T04:29:00Z', orderId: 'c0000010-0000-4000-8000-000000000042', orderStatus: 'paid', amount: 19000, settledAt: null }], total: 1, hasMore: false, nextBeforeNumber: null },
  subscription: { id: ID, ownerId: 'owner', buyerName: '춘식이집사', state: 'paused', revision: 1, createdAt: '2026-10-25T04:29:00Z', updatedAt: '2026-10-25T04:29:00Z', nextRunAt: null, schedule: { unit: 'month', count: 1 }, goodsLabel: '스타포스 강화 스티커 1개', renewalOnlineTotal: 7500, renewalCollectTotal: 0, paidCycleCount: 1, paidOnlineTotal: 19000, reason: 'customer_paused', latestCycle: null } } as never;
const render = () => renderToStaticMarkup(<AdminSubscriptionDetailScreen actorId="actor" canManage data={data} older={false} />);
describe('정기구매 상세', () => {
  beforeEach(() => { request.blocked = false; });
  /* 사람 눈 판정: 구매자·상태·금액이 표 안에 작게 묻혔다. 정기구매에는 운영자가 쓰는 번호가 없다(고객 화면에도 번호가 없다) — 내부 번호는 머리에도 신청 내용에도 적지 않는다. */
  it('머리에 구매자·상태·금액을 먼저 보이고 내부 번호는 적지 않는다', () => {
    const html = render();
    const strip = html.slice(html.indexOf('data-subscription-status-strip'), html.indexOf('</section>'));
    expect(strip).toContain('>춘식이집사<'); expect(strip).toContain('일시정지'); expect(strip).toContain('₩7,500');
    expect(html).not.toContain('신청번호'); expect(html.replace(/<[^>]*>/g, ' ')).not.toContain(ID); expect(html).not.toMatch(/title="[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
  /* 회차 조회가 주문번호를 주지 않아(orderId만) 번호 조각 대신 가는 곳을 말한다. */
  it('회차의 주문은 번호 조각 없이 주문 상세 링크로 말한다', () => {
    const html = render(), orderId = 'c0000010-0000-4000-8000-000000000042';
    expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/sales/orders/${orderId}"[^>]*>주문 상세</a>`));
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\b[0-9A-Fa-f]{8}\b/);
  });
  it('구매자 이름이 비어 있으면 머리와 신청 내용에 회원으로 적는다', () => {
    const named = data as unknown as { subscription: { buyerName: string } }, before = named.subscription.buyerName;
    named.subscription.buyerName = '  ';
    try {
      const html = render(), strip = html.slice(html.indexOf('data-subscription-status-strip'), html.indexOf('</section>'));
      expect(strip).toContain('>회원<'); expect(html).toContain('<dd class="min-w-0 wrap-anywhere">회원</dd>');
    } finally { named.subscription.buyerName = before; }
  });
  it('운영자가 할 일이 없으면 그렇게 말하고, 안내와 버튼을 구역 안에 둔다', () => {
    const html = render();
    expect(html).toContain('운영자가 처리할 일은 없습니다');
    const card = html.slice(html.indexOf('aria-label="신청 내용"'));
    expect(card.indexOf('고객의 동의를 받아')).toBeLessThan(card.indexOf('</section>'));
    expect(html.indexOf('최신 상태 확인')).toBeLessThan(html.indexOf('aria-label="신청 내용"'));
  });
  it('로그인 계정이 바뀌면 머리의 신청 정보와 처리 버튼까지 감춘다', () => {
    request.blocked = true;
    const html = render();
    expect(html).not.toContain(ID); expect(html).not.toContain('춘식이집사'); expect(html).not.toContain('최신 상태 확인');
    expect(html).toContain('정기구매 목록');
  });
});
