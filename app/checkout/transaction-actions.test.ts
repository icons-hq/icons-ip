import { beforeEach, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { transactionActor, transactionInput, transactionOrder, transactionQuote, transactionRecovery } from '@/test/fixtures/cart-transaction';
const mocks = vi.hoisted(() => ({ auth: null as CurrentAuthState | null, rpc: vi.fn(), offers: vi.fn(), analytics: vi.fn(), card: true, bank: true, runtime: 'transaction',
  cardProviders: [] as Array<string | undefined>, cartProvider: vi.fn(), userCartProvider: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/goods-transaction-offers.server', () => ({ loadGoodsTransactionOffers: mocks.offers }));
vi.mock('@/lib/store-analytics.server', () => ({ bindStoreAnalyticsOrder: mocks.analytics }));
vi.mock('@/lib/payments/goods-checkout-availability', () => ({ goodsCheckoutPaymentsEnabled: (_userId?: string, provider?: string) => { mocks.cardProviders.push(provider); return mocks.card; } }));
vi.mock('@/lib/payments/goods-sale-restriction.server', () => ({ deriveGoodsCartProvider: mocks.cartProvider, deriveUserCartProvider: mocks.userCartProvider }));
vi.mock('@/lib/payments/bank-transfer.server', () => ({ bankTransferCheckoutEnabled: () => mocks.bank }));
vi.mock('@/lib/checkout-transaction.server', () => ({ loadGoodsTransactionRuntimeMode: () => mocks.runtime }));
const drafts = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/checkout-draft.server', () => ({ loadCheckoutDraft: drafts.load }));
import { placeCartTransactionAction, quoteCartTransactionAction, resumeCartTransactionAction } from './transaction-actions';
const placeInput = { ...transactionInput, quoteId: transactionRecovery.quoteId, checkoutKey: transactionRecovery.checkoutKey, paymentMethod: transactionRecovery.paymentMethod };
beforeEach(() => {
  vi.clearAllMocks(); mocks.card = true; mocks.bank = true; mocks.runtime = 'transaction'; mocks.cardProviders = [];
  mocks.cartProvider.mockResolvedValue('toss'); mocks.userCartProvider.mockResolvedValue('toss');
  mocks.auth = { isConfigured: true, user: { id: transactionActor, email: 'qa@example.test' }, profile: { email: 'qa@example.test', nickname: '구매자', birth_date: '2000-01-01', consents: { terms: true, privacy: true }, onboarded_at: '2026-01-01T00:00:00Z' }, isStaff: false };
  mocks.rpc.mockResolvedValue({ data: transactionOrder, error: null }); mocks.offers.mockResolvedValue([]); mocks.analytics.mockResolvedValue(undefined);
});
it('서버 인증된 계정과 일치하지 않는 요청은 RPC 전에 거절한다', async () => {
  expect(await placeCartTransactionAction({ ...placeInput, expectedActorId: transactionOrder })).toMatchObject({ ok: false, error: 'auth_changed', uncertain: false });
  expect(await quoteCartTransactionAction({ ...transactionInput, expectedActorId: transactionOrder })).toMatchObject({ ok: false, error: 'auth_changed' });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('처리 크기 초과를 일시적인 실패로 안내하지 않는다', async () => {
  expect(await quoteCartTransactionAction({ ...transactionInput, extra: '가'.repeat(700_000) })).toEqual({ ok: false, error: 'order_too_large' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '54000', message: 'transaction_quote_too_large' } });
  expect(await quoteCartTransactionAction(transactionInput)).toEqual({ ok: false, error: 'order_too_large' });
});
it('quote는 선택·주소·할인 의도만 전달하고 엄격한 서버 금액을 반환한다', async () => {
  mocks.rpc.mockResolvedValue({ data: transactionQuote, error: null });
  expect(await quoteCartTransactionAction(transactionInput)).toEqual({ ok: true, quote: transactionQuote, offers: [] });
  expect(mocks.rpc).toHaveBeenCalledWith('quote_cart_goods_transaction', expect.objectContaining({ p_user_id: transactionActor, p_delivery_choices: transactionInput.deliveryChoices, p_store_credit_amount: 1000 }));
  mocks.rpc.mockResolvedValueOnce({ data: { ...transactionQuote, address: transactionInput.address }, error: null });
  expect(await quoteCartTransactionAction(transactionInput)).toEqual({ ok: false, error: 'unavailable' });
  mocks.offers.mockResolvedValueOnce(null);
  expect(await quoteCartTransactionAction(transactionInput)).toEqual({ ok: false, error: 'unavailable' });
  expect(await quoteCartTransactionAction({ ...transactionInput, storeCreditAmount: 0 })).toEqual({ ok: false, error: 'unavailable' });
  expect(await quoteCartTransactionAction({ ...transactionInput, items: [{ ...transactionInput.items[0], qty: 3 }] })).toEqual({ ok: false, error: 'unavailable' });
});
it('주문 생성은 견적 UUID로 금액을 확정하며 분석 기록 실패가 생성 성공을 뒤집지 않는다', async () => {
  mocks.analytics.mockRejectedValueOnce(new Error('analytics unavailable'));
  expect(await placeCartTransactionAction(placeInput)).toEqual({ ok: true, orderId: transactionOrder });
  expect(mocks.rpc.mock.calls[0][1]).toEqual({ p_user_id: transactionActor, p_expected_cart: [{ good_id: 'transaction-good', variant_id: transactionInput.items[0].variantId, qty: 2, input_revision: 0, input_values: {} }], p_address: transactionInput.address, p_quote_id: transactionRecovery.quoteId, p_checkout_key: transactionRecovery.checkoutKey, p_payment_method: 'card' });
});
it.each([['PT409', 'transaction_quote_expired', 'quote_changed', false], ['PT409', 'cart_snapshot_changed', 'cart_changed', false], ['', 'network failed', 'unavailable', true],
  // 옵션별 구매 제한·랜덤 판매 굿즈는 order_items 경계가 거절한다(계산 단계 이슈를 지나친 경합). 장바구니 확인으로 돌려보낸다.
  ['23514', 'option_order_limit_exceeded: 00000000-0000-4000-8000-000000000001', 'cart_changed', false],
  ['23514', 'option_member_limit_exceeded: 00000000-0000-4000-8000-000000000001', 'cart_changed', false],
  ['23514', 'random_option_checkout_unsupported: transaction-good', 'cart_changed', false]])('DB 거절과 결과 불명을 구분한다: %s %s', async (code, message, error, uncertain) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
  expect(await placeCartTransactionAction(placeInput)).toEqual({ ok: false, error, uncertain });
});
it('통신 예외와 잘못된 성공 응답은 같은 키 복구가 필요한 결과 불명이다', async () => {
  mocks.rpc.mockRejectedValueOnce(new Error('response lost'));
  expect(await placeCartTransactionAction(placeInput)).toMatchObject({ ok: false, uncertain: true });
  mocks.rpc.mockResolvedValueOnce({ data: 'bad-id', error: null });
  expect(await placeCartTransactionAction(placeInput)).toMatchObject({ ok: false, uncertain: true });
});
it('카드가 닫혀도 기존 주문 복구를 조회하되 신규 생성을 허용하지 않는다', async () => {
  mocks.card = false;
  expect(await placeCartTransactionAction(placeInput)).toMatchObject({ ok: false, error: 'payment_unavailable' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await resumeCartTransactionAction(transactionRecovery)).toEqual({ ok: true, orderId: transactionOrder });
  expect(mocks.rpc).toHaveBeenCalledWith('resume_cart_goods_transaction', { p_user_id: transactionActor, p_quote_id: transactionRecovery.quoteId, p_checkout_key: transactionRecovery.checkoutKey, p_payment_method: 'card', p_allow_new: false });
});
it.each(['legacy', 'unavailable'])('실행 상태 %s에서는 직접 Action 호출도 신규 발급·생성을 막고 기존 주문만 복구한다', async runtime => {
  mocks.runtime = runtime;
  expect(await quoteCartTransactionAction(transactionInput)).toEqual({ ok: false, error: 'checkout_unavailable' });
  expect(await placeCartTransactionAction(placeInput)).toEqual({ ok: false, error: 'checkout_unavailable', uncertain: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await resumeCartTransactionAction(transactionRecovery)).toEqual({ ok: true, orderId: transactionOrder });
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_allow_new: false });
});
it('무통장 복구는 카드가 아니라 무통장 gate를 따른다', async () => {
  mocks.card = false; mocks.bank = true;
  await resumeCartTransactionAction({ ...transactionRecovery, paymentMethod: 'bank_transfer' });
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_allow_new: true, p_payment_method: 'bank_transfer' });
});

it('쿠폰 순서를 별도 명시하고 응답의 쿠폰 선택이 다르면 견적을 수락하지 않는다', async () => {
  const ids = [transactionInput.userCouponId];
  const quote = structuredClone(transactionQuote);
  if (quote.state !== 'quoted') throw new Error('fixture');
  quote.display.coupons = [{ userCouponId: ids[0], code: 'COUPON-TEST', name: 'TEST 쿠폰', benefitKind: 'goods', discount: quote.display.totals.couponDiscountTotal, applicationIndex: 1 }];
  quote.display.totals.shippingCouponDiscountTotal = 0;
  mocks.rpc.mockResolvedValue({ data: quote, error: null });
  expect(await quoteCartTransactionAction({ ...transactionInput, userCouponIds: ids })).toMatchObject({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith('quote_cart_goods_transaction_combined', expect.objectContaining({ p_user_coupon_ids: ids }));
  expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_user_coupon_id');
  quote.display.coupons[0].userCouponId = transactionOrder;
  expect(await quoteCartTransactionAction({ ...transactionInput, userCouponIds: ids })).toEqual({ ok: false, error: 'unavailable' });
});

it('19금 굿즈가 섞인 카트의 카드 주문과 이어서 주문하기는 나이스페이 gate를 본다(ADR-0024)', async () => {
  mocks.cartProvider.mockResolvedValue('nicepay'); mocks.userCartProvider.mockResolvedValue('nicepay'); mocks.card = false;
  expect(await placeCartTransactionAction(placeInput)).toMatchObject({ ok: false, error: 'payment_unavailable', uncertain: false });
  expect(mocks.cartProvider).toHaveBeenCalledWith(placeInput.items.map(item => item.goodId));
  expect(mocks.cardProviders).toEqual(['nicepay']);
  expect(mocks.rpc).not.toHaveBeenCalled();
  await resumeCartTransactionAction(transactionRecovery);
  expect(mocks.userCartProvider).toHaveBeenCalledWith(transactionActor);
  expect(mocks.rpc).toHaveBeenCalledWith('resume_cart_goods_transaction', expect.objectContaining({ p_allow_new: false }));
});

/* 바로구매 초안(ADR-0030): 초안이 있으면 장바구니 어댑터가 아니라 바로구매 어댑터로 견적·주문·복구한다. */
it('바로구매 초안은 장바구니 스냅샷 대신 초안 id로 견적·주문·복구한다', async () => {
  const draftId = '00000000-0000-4000-8000-0000000000d1';
  mocks.rpc.mockResolvedValueOnce({ data: transactionQuote, error: null });
  await quoteCartTransactionAction({ ...transactionInput, draftId });
  expect(mocks.rpc).toHaveBeenLastCalledWith('quote_direct_goods_transaction', expect.objectContaining({ p_user_id: transactionActor, p_draft_id: draftId }));
  expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_expected_cart');
  await placeCartTransactionAction({ ...placeInput, draftId });
  expect(mocks.rpc).toHaveBeenLastCalledWith('place_direct_goods_transaction', expect.objectContaining({ p_user_id: transactionActor, p_draft_id: draftId,
    p_quote_id: transactionRecovery.quoteId, p_checkout_key: transactionRecovery.checkoutKey }));
  drafts.load.mockResolvedValueOnce({ id: draftId, source: 'direct', baseGoodId: 'transaction-good', expiresAt: '2099-01-01T00:00:00Z', stale: false,
    lines: [{ goodId: 'transaction-good', variantId: transactionInput.items[0].variantId, qty: 2 }] });
  await resumeCartTransactionAction({ ...transactionRecovery, draftId });
  expect(mocks.rpc).toHaveBeenLastCalledWith('resume_direct_goods_transaction', expect.objectContaining({ p_user_id: transactionActor, p_draft_id: draftId, p_allow_new: true }));
  expect(mocks.cartProvider).toHaveBeenLastCalledWith(['transaction-good']);
});
it('바로구매 초안이 만료됐으면 따로 알리고, 복구는 새 결제를 열지 않는다', async () => {
  const draftId = '00000000-0000-4000-8000-0000000000d1';
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'checkout_draft_expired' } });
  expect(await placeCartTransactionAction({ ...placeInput, draftId })).toEqual({ ok: false, error: 'draft_expired', uncertain: false });
  drafts.load.mockResolvedValueOnce(null);
  await resumeCartTransactionAction({ ...transactionRecovery, draftId });
  expect(mocks.rpc).toHaveBeenLastCalledWith('resume_direct_goods_transaction', expect.objectContaining({ p_allow_new: false }));
  /* 만료돼 줄이 지워진 주문서도 새 결제를 열지 않는다(같은 키의 원래 주문만 돌려받는다). */
  drafts.load.mockResolvedValueOnce({ id: draftId, source: 'direct', baseGoodId: 'transaction-good', closed: 'expired', usedOrderId: null });
  await resumeCartTransactionAction({ ...transactionRecovery, draftId });
  expect(mocks.rpc).toHaveBeenLastCalledWith('resume_direct_goods_transaction', expect.objectContaining({ p_allow_new: false }));
});
/* 다른 탭·뒤로 가기로 같은 바로구매 주문서를 새 키로 다시 내면 DB가 원 주문 id(detail)와 함께 거절한다(완료 기준 5). */
it('같은 주문서로 이미 접수·결제한 주문이 있으면 견적·주문 모두 원 주문을 알린다', async () => {
  const draftId = '00000000-0000-4000-8000-0000000000d1';
  const usedOrder = '00000000-0000-4000-8000-0000000000e1';
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'checkout_draft_used', details: usedOrder } });
  expect(await quoteCartTransactionAction({ ...transactionInput, draftId })).toEqual({ ok: false, error: 'draft_used', orderId: usedOrder });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'checkout_draft_used', details: usedOrder } });
  expect(await placeCartTransactionAction({ ...placeInput, draftId })).toEqual({ ok: false, error: 'draft_used', uncertain: false, orderId: usedOrder });
});
/* 그 주문의 결제 승인을 확인하고 있으면(리스가 지난 confirming 포함) 새 주문을 만들지 않고 그 주문을 알린다. */
it('결제 확인 중인 주문이 있으면 견적·주문 모두 그 주문을 알린다', async () => {
  const draftId = '00000000-0000-4000-8000-0000000000d1';
  const confirming = '00000000-0000-4000-8000-0000000000e2';
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'checkout_payment_in_progress', details: confirming } });
  expect(await quoteCartTransactionAction({ ...transactionInput, draftId })).toEqual({ ok: false, error: 'payment_in_progress', orderId: confirming });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'checkout_payment_in_progress', details: confirming } });
  expect(await placeCartTransactionAction({ ...placeInput, draftId })).toEqual({ ok: false, error: 'payment_in_progress', uncertain: false, orderId: confirming });
});

