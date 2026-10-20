import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentGateway, PreparedCheckout } from '../payments/gateway';
import { createGoodsPaymentAttemptRepository } from '../payments/goods-checkout.server';
import { BILLING_TEST_PROFILE, billingChargeFixture, billingRefundFixture, billingPaymentFixture } from '../../test/fixtures/recurring-billing';
import { createBillingProfileRegistry } from './billing-profiles.server';
import { createAttemptAwarePaymentGateway, createPaymentDispatchRepository, createRuntimeAttemptPaymentGateway, goodsReconciliationFinalizer, type BillingDispatchBinding } from './payment-dispatch.server';

function setup(binding: BillingDispatchBinding | null = null) {
  const input = billingChargeFixture();
  const prepared: PreparedCheckout = { attemptId: input.attempt.id, provider: 'toss', callbackNonce: 'opaque-existing-callback',
    expiresAt: input.attempt.expiresAt, action: { kind: 'client_sdk', payload: { existing: true } } };
  const existing = { attemptId: input.attempt.id, provider: 'toss' as const, outcome: 'approved' as const };
  const legacy: PaymentGateway = { prepare: vi.fn(async () => prepared), confirm: vi.fn(async () => existing),
    reconcile: vi.fn(async () => existing), refund: vi.fn(async () => ({ ...existing, refundedAmount: input.attempt.amount })) };
  const recurring = { register: vi.fn(), charge: vi.fn(), inspect: vi.fn(async () => existing),
    refund: vi.fn(async () => ({ ...existing, refundedAmount: input.attempt.amount })), revoke: vi.fn() };
  const dependencies = { legacy, loadBinding: vi.fn(async () => binding), recurring: vi.fn(() => recurring),
    prepareRefund: vi.fn(async () => ({ writeKeyVersion: 'v1', firstDispatchedAt: '2026-10-14T00:59:00Z' })) };
  return { gateway: createAttemptAwarePaymentGateway('toss', dependencies), dependencies, recurring, prepared, input };
}

describe('attempt integration dispatch', () => {
  it('명시적 legacy null binding의 prepare/confirm/reconcile/refund 계약을 그대로 보존한다', async () => {
    const { gateway, dependencies, recurring, prepared, input } = setup();
    expect(await gateway.prepare(input.attempt)).toBe(prepared);
    const callback = { attempt: input.attempt, idempotencyKey: 'existing-confirm', providerOrderId: input.attempt.providerOrderId,
      callbackNonce: 'existing-proof', providerPayload: { paymentKey: 'existing-provider-return' } };
    await gateway.confirm(callback); await gateway.reconcile(input.attempt);
    const refund = billingRefundFixture(); await gateway.refund(refund);
    expect(dependencies.legacy.confirm).toHaveBeenCalledWith(callback);
    expect(dependencies.legacy.reconcile).toHaveBeenCalledWith(input.attempt);
    expect(dependencies.legacy.refund).toHaveBeenCalledWith(refund);
    expect(recurring.inspect).not.toHaveBeenCalled(); expect(dependencies.prepareRefund).not.toHaveBeenCalled();
  });
  it('billing attempt를 일반 결제창/콜백으로 보내지 않고 조회는 해당 binding으로 보낸다', async () => {
    const { gateway, dependencies, recurring, input } = setup(billingChargeFixture().binding);
    await expect(gateway.prepare(input.attempt)).rejects.toThrow('billing_checkout_not_supported');
    expect(await gateway.confirm({ attempt: input.attempt, idempotencyKey: 'ignored', providerOrderId: input.attempt.providerOrderId,
      callbackNonce: 'irrelevant-proof', providerPayload: {} })).toMatchObject({ outcome: 'needs_review', reasonCode: 'billing_callback_not_supported' });
    await gateway.reconcile(input.attempt);
    expect(recurring.inspect).toHaveBeenCalledWith({ attempt: input.attempt, binding: input.binding });
    expect(dependencies.legacy.prepare).not.toHaveBeenCalled(); expect(dependencies.legacy.confirm).not.toHaveBeenCalled();
    expect(recurring.charge).not.toHaveBeenCalled();
  });
  it('조회 오류·손상 binding은 일반 Toss 키 fallback이 아니다', async () => {
    const one = setup(); one.dependencies.loadBinding.mockRejectedValue(new Error('synthetic database unavailable'));
    await expect(one.gateway.reconcile(one.input.attempt)).rejects.toThrow('synthetic database unavailable');
    expect(one.dependencies.legacy.reconcile).not.toHaveBeenCalled();
    const two = setup({ ...billingChargeFixture().binding, attemptId: 'b1711000-0000-4000-8000-000000000099' });
    await expect(two.gateway.reconcile(two.input.attempt)).rejects.toThrow('payment_dispatch_binding_invalid');
    expect(two.dependencies.legacy.reconcile).not.toHaveBeenCalled();
  });
  it('발송 전 카드 주문을 조회/환급 가능한 외부 결제로 가정하지 않는다', async () => {
    const { gateway, input, recurring } = setup({ ...billingChargeFixture().binding, firstDispatchedAt: null });
    expect(await gateway.reconcile(input.attempt)).toMatchObject({ outcome: 'needs_review', reasonCode: 'billing_not_dispatched' });
    expect(recurring.inspect).not.toHaveBeenCalled();
  });
  it('환급은 자체 최초 write version을 원장에서 받아 일반 키 대신 billing에 전달한다', async () => {
    const { gateway, dependencies, recurring, input } = setup(billingChargeFixture().binding);
    const refund = billingRefundFixture(); await gateway.refund(refund);
    expect(dependencies.prepareRefund).toHaveBeenCalledWith(refund, input.binding);
    expect(recurring.refund).toHaveBeenCalledWith({ ...refund, binding: input.binding, writeKeyVersion: 'v1', firstDispatchedAt: '2026-10-14T00:59:00Z' });
    expect(dependencies.legacy.refund).not.toHaveBeenCalled();
  });
});

describe('payment dispatch repository', () => {
  it('RPC 실패·불완전 응답을 legacy null로 축소하지 않는다', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { code: '42501' } })
      .mockResolvedValueOnce({ data: undefined, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const repository = createPaymentDispatchRepository({ rpc }, () => null);
    await expect(repository.loadBinding(billingChargeFixture().attempt.id)).rejects.toThrow('payment_dispatch_lookup_failed');
    await expect(repository.loadBinding(billingChargeFixture().attempt.id)).rejects.toThrow('payment_dispatch_binding_invalid');
    await expect(repository.loadBinding(billingChargeFixture().attempt.id)).resolves.toBeNull();
  });
  it('새 환급은 현재 key version을 제안하되 DB의 최초 version/시각을 따른다', async () => {
    const rpc = vi.fn(async () => ({ data: { writeKeyVersion: 'v1', firstDispatchedAt: '2026-10-14T00:59:00Z' }, error: null }));
    const repository = createPaymentDispatchRepository({ rpc }, () => createBillingProfileRegistry([BILLING_TEST_PROFILE]));
    expect(await repository.prepareRefund(billingRefundFixture(), billingChargeFixture().binding))
      .toEqual({ writeKeyVersion: 'v1', firstDispatchedAt: '2026-10-14T00:59:00Z' });
    expect(rpc).toHaveBeenCalledWith('service_prepare_billing_refund', expect.objectContaining({ p_key_version: 'v2', p_request_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
  });
  it('billing reconciliation만 원자적인 회차 wrapper로 보내며 provider 재승인은 없다', async () => {
    const binding = billingChargeFixture().binding;
    const client = { rpc: vi.fn(async (name: string) => ({ data: name === 'service_get_payment_gateway_binding' ? binding : 'approved', error: null })) };
    const repository = createGoodsPaymentAttemptRepository(client, {
      reconciliationFinalizer: id => goodsReconciliationFinalizer(client, 'toss', id),
    });
    await repository.finalizeOrderReconciliation({ attemptId: binding.attemptId,
      claimToken: 'b1711000-0000-4000-8000-000000000098', outcome: { attemptId: binding.attemptId, provider: 'toss', outcome: 'approved' } });
    expect(client.rpc).toHaveBeenLastCalledWith('service_finalize_subscription_payment_reconciliation', expect.objectContaining({
      p_attempt_id: binding.attemptId, p_claim_token: 'b1711000-0000-4000-8000-000000000098', p_outcome: 'approved',
    }));
    expect(await goodsReconciliationFinalizer({ rpc: async () => ({ data: null, error: null }) }, 'toss', binding.attemptId))
      .toBe('finalize_goods_payment_reconciliation');
  });
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('등록키와 vault를 삭제한 과거 결제도 불변 billing profile 현재 키로 조회한다', async () => {
  vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', JSON.stringify([BILLING_TEST_PROFILE]));
  vi.stubEnv('BILLING_ENCRYPTION_KEYS', ''); vi.stubEnv('BILLING_ENCRYPTION_ACTIVE_VERSION', ''); vi.stubEnv('BILLING_FAKE_LOCAL_ENABLED', 'false');
  const input = billingChargeFixture(), legacy = setup().dependencies.legacy;
  const fetch = vi.fn(async () => new Response(JSON.stringify(billingPaymentFixture()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const gateway = createRuntimeAttemptPaymentGateway({ rpc: async () => ({ data: input.binding, error: null }) }, 'toss', legacy);
  expect(await gateway.reconcile(input.attempt)).toMatchObject({ outcome: 'approved' });
  expect(fetch).toHaveBeenCalledTimes(1); expect(legacy.reconcile).not.toHaveBeenCalled();
  const [, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(request.headers).get('Authorization')).toBe(`Basic ${Buffer.from(BILLING_TEST_PROFILE.secretKeys.v2 + ':').toString('base64')}`);
});
