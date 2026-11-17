import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '@/lib/orders';
import { BUSINESS_INFO } from '@/lib/legal/business-info';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  onboarded: true,
  loadOrderDetail: vi.fn(),
  loadPartial: vi.fn(),
  getBusinessInfo: vi.fn(),
  loadOrderer: vi.fn(),
  loadPaymentDisplay: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error('notFound'); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/orders.server', () => ({ loadOrderDetail: mocks.loadOrderDetail }));
vi.mock('@/lib/orders/partial-cancellation.server', () => ({ loadMyOrderPartialCancellations: mocks.loadPartial }));
vi.mock('@/lib/legal/business-info.server', () => ({ getBusinessInfo: mocks.getBusinessInfo }));
vi.mock('@/lib/orders/orderer.server', () => ({ loadOrdererInfo: mocks.loadOrderer }));
vi.mock('@/lib/orders/payment-display.server', () => ({ loadMyOrderPaymentDisplay: mocks.loadPaymentDisplay }));

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORDER_ID = '20000000-0000-4000-8000-000000002051';

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ORDER_ID,
    orderNumber: '20261117140510000001',
    status: 'paid',
    total: 30000,
    shippingFee: 3000,
    discountTotal: 0,
    storeCreditTotal: 0,
    paymentMethod: 'card',
    expiresAt: null,
    address: null,
    createdAt: '2026-11-17T05:05:00.000Z',
    deliveredAt: null,
    items: [{ id: 'item-1', variantId: 'v1', variantName: '파랑', goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴', qty: 1, unitPrice: 27000 }],
    payment: { amount: 30000, status: 'paid', createdAt: '2026-11-17T05:06:00.000Z' },
    refund: null,
    cancellationRequest: null,
    claimEligibility: { cancel: false, return: false, exchange: false },
    shipments: [],
    cardPacks: { issuedCount: 0, availableCount: 0 },
    ...overrides,
  };
}

function render(orderId: string = ORDER_ID) {
  return Page({ params: Promise.resolve({ orderId }) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { user: { id: USER_ID, email: 'fan@example.test' }, profile: { nickname: '홍길동', email: 'fan@example.test', onboarded_at: '2026-08-13T00:00:00.000Z' } };
  mocks.onboarded = true;
  mocks.loadOrderDetail.mockResolvedValue(order());
  mocks.loadPartial.mockResolvedValue([]);
  mocks.getBusinessInfo.mockResolvedValue(BUSINESS_INFO);
  mocks.loadOrderer.mockResolvedValue({ name: '홍길동', email: 'fan@example.test', maskedPhone: null });
  mocks.loadPaymentDisplay.mockResolvedValue({ provider: 'toss', method: '카드', detail: '43301234****123*', approvedAt: null });
});

describe('/orders/[orderId]/statement', () => {
  it('색인하지 않는 거래명세서 메타데이터다', () => {
    expect(metadata.title).toBe('거래명세서 — ICONS');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('UUID가 아닌 주문 id는 404이고 아무것도 읽지 않는다', async () => {
    await expect(render('not-a-uuid')).rejects.toThrow('notFound');
    expect(mocks.loadOrderDetail).not.toHaveBeenCalled();
  });

  it('로그인하지 않았으면 로그인으로, 온보딩 전이면 온보딩으로 보내고 돌아올 명세서 경로를 싣는다', async () => {
    const next = `/orders/${ORDER_ID}/statement`;
    mocks.auth = { user: null, profile: null };
    await expect(render()).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(next)}`);
    mocks.auth = { user: { id: USER_ID, email: 'fan@example.test' }, profile: null };
    mocks.onboarded = false;
    await expect(render()).rejects.toThrow(`redirect:/onboarding?next=${encodeURIComponent(next)}`);
    expect(mocks.loadOrderDetail).not.toHaveBeenCalled();
  });

  it('본인 주문이 아니거나 없으면(loadOrderDetail null) 404다', async () => {
    mocks.loadOrderDetail.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('notFound');
    expect(mocks.loadOrderDetail).toHaveBeenCalledWith(USER_ID, ORDER_ID);
  });

  it('결제가 끝난 주문은 명세서를 그리고, 주문자·결제수단 라벨·사업자 정보를 넘긴다', async () => {
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('거래명세서');
    expect(html).toContain('홍실 아크릴 블록');
    expect(html).toContain('신용·체크카드 (43301234****123*)');
    expect(html).toContain(BUSINESS_INFO.companyName);
    expect(html).toContain('홍길동');
    expect(html).toContain('인쇄하기');
    expect(html).toContain(`href="/orders/${ORDER_ID}"`);
    expect(mocks.loadPaymentDisplay).toHaveBeenCalledWith(ORDER_ID);
    expect(mocks.loadPartial).toHaveBeenCalledWith(ORDER_ID);
    expect(mocks.loadOrderer).toHaveBeenCalledWith(mocks.auth);
  });

  it('결제수단 근거를 못 읽으면 대체 라벨, 무통장은 무통장 입금으로 보인다', async () => {
    mocks.loadPaymentDisplay.mockResolvedValue(null);
    expect(renderToStaticMarkup(await render())).toContain('카드·간편결제');
    mocks.loadOrderDetail.mockResolvedValue(order({ paymentMethod: 'bank_transfer' }));
    expect(renderToStaticMarkup(await render())).toContain('무통장 입금');
  });

  it('결제 전 주문은 발급 안내와 주문 상세 링크만 보이고 명세서 본문은 없다', async () => {
    mocks.loadOrderDetail.mockResolvedValue(order({ status: 'pending' }));
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('결제가 완료된 주문만 거래명세서를 발급해요.');
    expect(html).toContain('주문 상세로 돌아가기');
    expect(html).not.toContain('홍실 아크릴 블록');
    expect(html).not.toContain('인쇄하기');
  });

  it('취소된 주문은 취소 안내만 보인다', async () => {
    mocks.loadOrderDetail.mockResolvedValue(order({ status: 'canceled' }));
    const html = renderToStaticMarkup(await render());
    expect(html).toContain('취소된 주문은 거래명세서를 발급하지 않아요.');
    expect(html).not.toContain('홍실 아크릴 블록');
  });
});
