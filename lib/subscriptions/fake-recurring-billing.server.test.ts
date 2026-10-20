import { describe, expect, it } from 'vitest';
import { BILLING_TEST_NOW, BILLING_TEST_PROFILE, billingChargeFixture, billingRefundFixture, billingRegistrationFixture } from '../../test/fixtures/recurring-billing';
import { createFakeRecurringBilling, createMemoryFakeBillingLedger } from './fake-recurring-billing.server';

async function setup(scenario: 'approved' | 'declined' | 'timeout_before_charge' | 'timeout_after_charge' = 'approved') {
  const ledger = createMemoryFakeBillingLedger();
  const adapter = createFakeRecurringBilling({ identity: BILLING_TEST_PROFILE, ledger, now: () => BILLING_TEST_NOW, scenario: () => scenario });
  const registration = { ...billingRegistrationFixture(), authKey: 'fake_auth_fixture' };
  const registered = await adapter.register(registration);
  if (registered.state !== 'ready') throw new Error('synthetic registration failed');
  return { adapter, ledger, registration, input: { ...billingChargeFixture(), billingKey: registered.billingKey } };
}

describe('Fake recurring billing 원장', () => {
  it('중복 등록/청구/환급은 원 영수증을 유지하고 현재 카트 같은 외부 상태에 의존하지 않는다', async () => {
    const { adapter, registration, input } = await setup();
    expect((await adapter.register(registration))).toMatchObject({ state: 'ready', billingKey: input.billingKey });
    const outcomes = await Promise.all([adapter.charge(input), adapter.charge(input)]);
    expect(outcomes[0]).toEqual(outcomes[1]); expect(outcomes[0].outcome).toBe('approved');
    const refund = await adapter.refund(billingRefundFixture());
    expect(refund).toMatchObject({ outcome: 'approved', refundedAmount: 25_000 });
    expect(await adapter.refund(billingRefundFixture())).toEqual(refund);
  });
  it('외부 승인 후 응답 손실을 새 Adapter와 같은 원장에서 조회로 복구한다', async () => {
    const { adapter, ledger, input } = await setup('timeout_after_charge');
    expect(await adapter.charge(input)).toMatchObject({ outcome: 'unknown' });
    const restarted = createFakeRecurringBilling({ identity: BILLING_TEST_PROFILE, ledger, now: () => BILLING_TEST_NOW });
    expect(await restarted.inspect(input)).toMatchObject({ outcome: 'approved', evidence: { resultCode: 'DONE' } });
  });
  it('발송 전 손실·확정 거절을 승인으로 만들지 않는다', async () => {
    const before = await setup('timeout_before_charge');
    expect(await before.adapter.charge(before.input)).toMatchObject({ outcome: 'unknown' });
    expect(await before.adapter.inspect(before.input)).toMatchObject({ outcome: 'unknown' });
    const declined = await setup('declined');
    expect(await declined.adapter.charge(declined.input)).toMatchObject({ outcome: 'declined' });
  });
  it('같은 멱등키에 다른 금액 또는 새 키로 같은 주문을 보내면 두 번째 승인을 만들지 않는다', async () => {
    const { adapter, input } = await setup(); await adapter.charge(input);
    expect(await adapter.charge({ ...input, attempt: { ...input.attempt, amount: 26_000 } })).toMatchObject({ outcome: 'needs_review' });
    expect(await adapter.charge({ ...input, binding: { ...input.binding, writeKeyVersion: 'v2' } })).toMatchObject({ outcome: 'needs_review' });
  });
  it('사용 중지 카드·다른 고객·다른 상점/라이브 profile을 허용하지 않는다', async () => {
    const { adapter, input } = await setup();
    expect(await adapter.revoke({ ...BILLING_TEST_PROFILE, billingKey: input.billingKey })).toMatchObject({ state: 'revoked' });
    expect(await adapter.charge(input)).toMatchObject({ outcome: 'declined' });
    expect(() => createFakeRecurringBilling({ identity: { ...BILLING_TEST_PROFILE, environment: 'live' } })).toThrow('invalid_fake_billing_profile');
    const other = await setup();
    expect(await other.adapter.charge({ ...other.input, customerKey: 'b1711000-0000-4000-8000-000000000099' })).toMatchObject({ outcome: 'declined' });
  });
});
