import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  rpc: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));

import { closeDirectOrderAction, createCartRetryDraftAction, createCartSelectionDraftAction, createDirectCheckoutDraftAction, createDirectRetryDraftAction } from './draft-actions';

const userId = '00000000-0000-4000-8000-000000000001';
const draftId = '00000000-0000-4000-8000-0000000000d1';
const orderId = '5cbcbbed-202d-4676-821a-7706398e57c0';
const VARIANT = '00000000-0000-4000-8000-000000000002';
const fieldId = '00000000-0000-4000-8000-0000000000f1';

function onboarded(): CurrentAuthState {
  return { isConfigured: true, user: { id: userId, email: 'fan@icons.gg' }, isStaff: false,
    profile: { email: 'fan@icons.gg', nickname: 'fan', birth_date: '2000-01-01', consents: { terms: true, privacy: true }, onboarded_at: '2026-07-01T00:00:00Z' } };
}

beforeEach(() => {
  mocks.auth = onboarded();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: draftId, error: null });
});

describe('장바구니 선택 주문 초안(ADR-0030)', () => {
  it('고른 줄의 식별·수량만 로그인 사용자 소유로 보내고 주문서 주소를 돌려준다', async () => {
    const customInputs = { revision: 1, fields: [{ id: fieldId, name: '각인', value: 'ICONS' }] };
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 2, customInputs }]))
      .resolves.toEqual({ ok: true, draftId, href: `/checkout?draft=${draftId}` });
    expect(mocks.rpc).toHaveBeenCalledWith('service_create_checkout_selection_draft', {
      p_user_id: userId,
      p_lines: [{ good_id: 'g2', variant_id: VARIANT, input_revision: 1, input_values: { [fieldId]: 'ICONS' }, qty: 2 }],
    });
  });

  it('다른 탭에서 장바구니가 바뀌었으면 그 사실을 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'cart_snapshot_changed' } });
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'cart_changed' });
  });

  it('빈·잘못된 줄, 로그인·프로필·정지 상태는 DB에 닿지 않는다', async () => {
    for (const value of [[], null, [{ goodId: 'g2', variantId: 'x', qty: 1 }]]) {
      await expect(createCartSelectionDraftAction(value)).resolves.toEqual({ ok: false, error: 'invalid_request' });
    }
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'auth_required' });
    mocks.auth = { ...onboarded(), profile: null };
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'onboarding_required' });
    mocks.auth = { ...onboarded(), profile: { ...onboarded().profile!, suspended_at: '2026-11-01T00:00:00Z' } };
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'account_suspended' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB 응답이 초안 id가 아니면 성공으로 말하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'not-a-uuid', error: null });
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'unavailable' });
    mocks.rpc.mockRejectedValue(new Error('private network detail'));
    await expect(createCartSelectionDraftAction([{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'unavailable' });
  });
});

/* 바로구매 결제가 승인 전에 끝난 주문의 '다시 구매하기'(ADR-0030 확정 동작 8): 그 주문을 닫고 같은 줄로 주문서를 다시 연다. */
describe('바로구매 다시 구매하기', () => {
  it('그 주문을 닫고 같은 줄로 만든 바로구매 초안의 주문서로 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'draft', draftId }, error: null });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: true, href: `/checkout?draft=${draftId}` });
    expect(mocks.rpc).toHaveBeenCalledWith('service_retry_direct_order', { p_user_id: userId, p_order_id: orderId });
  });

  it('결제 확인 중·결제가 끝난 주문·지금 살 수 없는 구성은 주문서를 열지 않고 사유를 돌려준다', async () => {
    for (const [result, error] of [['payment_in_progress', 'payment_in_progress'], ['not_retryable', 'not_retryable'], ['unavailable', 'lines_unavailable'], ['other', 'unavailable']]) {
      mocks.rpc.mockResolvedValue({ data: { result, baseGoodId: 'g2' }, error: null });
      await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error });
    }
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'not_retryable' });
    mocks.rpc.mockResolvedValue({ data: { result: 'draft', draftId: 'x' }, error: null });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'unavailable' });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'account_suspended' } });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'account_suspended' });
    mocks.rpc.mockRejectedValue(new Error('private network detail'));
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'unavailable' });
  });

  /* 같은 주문의 다시 구매는 한 번이다 — 그 초안으로 이미 접수·결제했거나 결제를 확인하고 있으면 그 주문으로 잇는다. */
  it('이미 다시 주문했거나 결제를 확인하고 있으면 그 주문을 돌려준다', async () => {
    const reordered = '00000000-0000-4000-8000-0000000000e9';
    mocks.rpc.mockResolvedValue({ data: { result: 'not_retryable', orderId: reordered.toUpperCase() }, error: null });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'not_retryable', orderId: reordered });
    mocks.rpc.mockResolvedValue({ data: { result: 'payment_in_progress', orderId: reordered }, error: null });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'payment_in_progress', orderId: reordered });
    mocks.rpc.mockResolvedValue({ data: { result: 'not_retryable', orderId: 'x' }, error: null });
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'not_retryable' });
  });

  it('잘못된 주문 번호·로그인 전에는 DB에 닿지 않는다', async () => {
    await expect(createDirectRetryDraftAction('nope')).resolves.toEqual({ ok: false, error: 'invalid_request' });
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(createDirectRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'auth_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/* '이 주문 닫고 굿즈 상세에서 다시 고르기'(UI 재리뷰): 같은 닫기만 하고 그 굿즈 상세로 보낸다 — 초안은 만들지 않는다. */
describe('바로구매 주문 닫고 굿즈 상세로', () => {
  it('그 주문을 닫고 그 굿즈 상세로 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'closed', baseGoodId: 'g2' }, error: null });
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: true, href: '/shop/g2' });
    expect(mocks.rpc).toHaveBeenCalledWith('service_close_direct_order', { p_user_id: userId, p_order_id: orderId });
  });

  it('결제 확인 중·결제가 끝난 주문은 닫지 않고 사유를 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'payment_in_progress', baseGoodId: 'g2' }, error: null });
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: false, error: 'payment_in_progress' });
    mocks.rpc.mockResolvedValue({ data: { result: 'not_retryable', baseGoodId: 'g2' }, error: null });
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: false, error: 'not_retryable' });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: false, error: 'not_retryable' });
    mocks.rpc.mockResolvedValue({ data: { result: 'closed', baseGoodId: '' }, error: null });
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: false, error: 'unavailable' });
    mocks.rpc.mockRejectedValue(new Error('private network detail'));
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: false, error: 'unavailable' });
  });

  it('잘못된 주문 번호·로그인 전에는 DB에 닿지 않는다', async () => {
    await expect(closeDirectOrderAction('nope')).resolves.toEqual({ ok: false, error: 'invalid_request' });
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(closeDirectOrderAction(orderId)).resolves.toEqual({ ok: false, error: 'auth_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('장바구니 주문 다시 결제(ADR-0026·0030)', () => {
  it('그 주문의 줄로 만든 선택 초안의 주문서로 보낸다', async () => {
    await expect(createCartRetryDraftAction(orderId)).resolves.toEqual({ ok: true, href: `/checkout?draft=${draftId}` });
    expect(mocks.rpc).toHaveBeenCalledWith('service_create_checkout_retry_draft', { p_user_id: userId, p_order_id: orderId });
  });

  it('장바구니에 남은 줄이 없으면 장바구니로 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createCartRetryDraftAction(orderId)).resolves.toEqual({ ok: true, href: '/cart' });
  });

  it('잘못된 주문 번호·로그인 전에는 DB에 닿지 않는다', async () => {
    await expect(createCartRetryDraftAction('nope')).resolves.toEqual({ ok: false, error: 'invalid_request' });
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(createCartRetryDraftAction(orderId)).resolves.toEqual({ ok: false, error: 'auth_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('바로구매 초안(ADR-0030 · 1014-033·037·039)', () => {
  it('고른 옵션·수량·추가 구성·직접입력값만 로그인 사용자 소유로 보낸다 — 장바구니를 읽지 않는다', async () => {
    const customInputs = { revision: 1, fields: [{ id: fieldId, name: '각인', value: 'ICONS' }] };
    await expect(createDirectCheckoutDraftAction('g2', [{ goodId: 'g2', variantId: VARIANT, qty: 1, customInputs },
      { goodId: 'g3', variantId: '00000000-0000-4000-8000-000000000003', qty: 2 }]))
      .resolves.toEqual({ ok: true, draftId, href: `/checkout?draft=${draftId}` });
    expect(mocks.rpc).toHaveBeenCalledWith('service_create_checkout_direct_draft', {
      p_user_id: userId,
      p_base_good_id: 'g2',
      p_lines: [
        { good_id: 'g2', variant_id: VARIANT, qty: 1, input_revision: 1, input_values: { [fieldId]: 'ICONS' } },
        { good_id: 'g3', variant_id: '00000000-0000-4000-8000-000000000003', qty: 2, input_revision: 0, input_values: {} },
      ],
    });
  });

  it.each([
    ['adult_verification_required', 'adult_verification_required'],
    ['additional_good_unavailable', 'additional_good_unavailable'],
    ['catalog_item_unavailable', 'goods_unavailable'],
    ['invalid_goods_custom_inputs', 'custom_inputs_changed'],
    ['invalid_checkout_direct', 'invalid_request'],
    ['private network detail', 'unavailable'],
  ])('DB 거절 %s 를 화면 사유 %s 로 바꾼다', async (message, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(createDirectCheckoutDraftAction('g2', [{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error });
  });

  it('본품이 없는 선택·로그인 전에는 DB에 닿지 않는다(로그인 전이면 화면이 선택을 들고 로그인으로 간다)', async () => {
    await expect(createDirectCheckoutDraftAction('g2', [{ goodId: 'g3', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'invalid_request' });
    await expect(createDirectCheckoutDraftAction('', [{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'invalid_request' });
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(createDirectCheckoutDraftAction('g2', [{ goodId: 'g2', variantId: VARIANT, qty: 1 }])).resolves.toEqual({ ok: false, error: 'auth_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

