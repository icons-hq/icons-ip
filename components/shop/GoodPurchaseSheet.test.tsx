import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, GoodOption } from '@/lib/data';
import { GoodPurchasePanel, type GoodPurchaseController } from './GoodPurchasePanel';
import { GoodPurchaseSheet } from './GoodPurchaseSheet';

vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ error: null, getQuantity: () => 0, pending: false, ready: true, setQuantity: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop/g13',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/shop/RestockCta', () => ({
  RestockCta: () => <button className="wc-restock-cta" type="button">재입고 알림 받기</button>,
}));

/* 정기배송·선물 진입은 마운트 뒤 서버에 물어 보이므로(SSR 에서는 비어 있다) 대상 굿즈처럼 보이는 대역을 세운다. */
vi.mock('@/components/subscriptions/SubscriptionPurchaseEntry', () => ({
  SubscriptionPurchaseEntry: ({ goodId }: { goodId: string }) => <a className="wc-btn wc-btn-outline" href={`/subscriptions/new?goodId=${goodId}`}>정기배송 신청</a>,
}));
vi.mock('@/components/gifts/GiftPurchaseEntry', () => ({
  GiftPurchaseEntry: () => <aside className="wc-good-gift-entry"><a href="/gifts">선물함</a></aside>,
}));

/*
 * 운영에는 아직 다옵션 굿즈가 없다(11 §10). 시트가 패널의 어떤 칸도 빠뜨리지 않는지는
 * 칸이 전부 켜진 굿즈로만 확인할 수 있어, 다옵션(품절 옵션 포함)·예약판매·구매 한도·
 * 직접 입력·추가 구성·주문제작 거래 조건을 한 굿즈에 모은다.
 */
const preorder: GoodOption = {
  id: '00000000-0000-4000-8000-000000000101', name: '10월 예약', code: 'G13-PRE', price: 15000, stockQty: 5, isDefault: true, attributes: {},
  supply: { mode: 'preorder', state: 'open', policyId: '00000000-0000-4000-8000-000000000102', policyRevision: 1, availableQty: 5,
    startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z', expectedShipDate: '2026-11-20', calculatedAt: '2026-10-22T00:00:00Z', nextChangeAt: null },
};
const soldOutOption: GoodOption = { id: '00000000-0000-4000-8000-000000000103', name: '빨강', code: 'G13-RED', price: 12000, stockQty: 0, isDefault: false, attributes: {} };
const extraOption: GoodOption = { id: '00000000-0000-4000-8000-000000000104', name: '스티커 A', code: 'G14-A', price: 3000, stockQty: 4, isDefault: false, attributes: {} };

const good: Good = {
  id: 'g13', name: '각인 아크릴 블록', ip: 'hong-sil-quest', type: '아크릴', price: 12000, priceMax: 15000, badge: null, stock: 'ok', stockQty: 5,
  img: 'linear-gradient(#111, #222)', options: [preorder, soldOutOption],
  orderQuantityLimitEnabled: true, minOrderQty: 1, maxOrderQty: 3,
  memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 6,
  customInputs: { enabled: true, revision: 1, fields: [{ id: 'engrave', name: '각인 문구', active: true }] },
  transactionOffer: { goodId: 'g13', volume: null, delivery: null, collectReady: false, collector: null,
    production: { version: 1, goodId: 'g13', revision: 1, leadDays: 5, dayBasis: 'business', closedDates: [], publicNote: '각인은 주문 후 제작합니다.' } },
};
const extra: Good = { id: 'g14', name: '추가 스티커', ip: 'hong-sil-quest', type: '문구', price: 3000, badge: null, stock: 'ok', stockQty: 4,
  img: 'linear-gradient(#111, #222)', options: [{ ...extraOption, id: '00000000-0000-4000-8000-000000000105', name: '스티커 B' }, extraOption] };

const controller: GoodPurchaseController = {
  good, selectedOption: preorder, selectOption: vi.fn(), selectionRequired: false, quantity: 2, setQuantity: vi.fn(), subtotal: 33000,
  soldOut: false, restockRequested: false, disabled: false, inert: false, message: '각인 아크릴 블록: 각인 문구를 입력해주세요.',
  addToCart: vi.fn(), buyNow: vi.fn(),
  additionalChoices: [{ goodId: extra.id, name: extra.name, good: extra, selected: true, selectedOption: extraOption, quantity: 1 }],
  toggleAdditional: vi.fn(), selectAdditionalOption: vi.fn(), setAdditionalQuantity: vi.fn(),
  customInputValues: { g13: { engrave: '' } }, setCustomInputValue: vi.fn(),
};

describe('GoodPurchaseSheet', () => {
  it('정보 칼럼의 구매 패널을 한 칸도 빼지 않고 그대로 담는다', () => {
    const sheet = renderToStaticMarkup(<GoodPurchaseSheet onClose={vi.fn()} purchase={controller} />);
    const panel = renderToStaticMarkup(<GoodPurchasePanel purchase={controller} />);

    expect(sheet).toContain(panel);
    /* 패널이 실제로 모든 칸을 그렸는지도 직접 본다 — 위 포함 단언이 빈 패널끼리 통과하지 않게. */
    expect(panel).toContain('주문당 1–3개 구매할 수 있습니다.');
    expect(panel).toContain('회원 누적 최대 6개');
    expect(panel).toMatch(/<select[^>]*>/);
    expect(panel).toContain('빨강 · ₩12,000 · 품절');
    expect(panel).toContain('예약판매 · 주문 시 결제 · 2026년 11월 20일 발송 예정');
    expect(panel).toContain('직접 입력 옵션');
    expect(panel).toMatch(/<input id="good-custom-g13-engrave"[^>]*required=""/);
    expect(panel).toContain('추가 구성 굿즈');
    expect(panel).toContain('aria-label="추가 스티커 추가 수량"');
    expect(panel).toContain('주문 후 제작');
    expect(panel).toContain('예상 굿즈 금액');
    expect(panel).toContain('₩33,000');
    expect(panel).toContain('>장바구니<');
    expect(panel).toContain('>구매하기<');
    expect(panel).toContain('wc-buy-panel__other-purchases');
    expect(panel).toContain('href="/subscriptions/new?goodId=g13">정기배송 신청</a>');
    expect(panel).toContain('<a href="/gifts">선물함</a>');
    expect(panel).toContain('각인 문구를 입력해주세요.');
    expect(panel).toContain('role="status"');
  });

  it('제목으로 이름 붙은 모달 다이얼로그이고 닫기 버튼과 백드롭을 둔다', () => {
    const html = renderToStaticMarkup(<GoodPurchaseSheet onClose={vi.fn()} purchase={controller} />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(html).toContain(`id="${labelledBy}">각인 아크릴 블록</h2>`);
    expect(html).toContain('aria-label="구매 옵션 닫기"');
    expect(html).toMatch(/<div aria-hidden="true" class="wc-pdp-sheet__dim"><\/div>/);
  });
});
