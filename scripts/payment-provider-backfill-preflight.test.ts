import { describe, expect, it, vi } from 'vitest';
import {
  evaluatePaymentProviderBackfillPreflight,
  runPaymentProviderBackfillPreflight,
} from './payment-provider-backfill-preflight.mjs';

describe('payment provider backfill production preflight', () => {
  it('provider migration 전에는 legacy 결제 수가 정확히 2건일 때만 통과한다', () => {
    expect(evaluatePaymentProviderBackfillPreflight({
      providerColumnExists: false,
      paymentCount: 2,
    })).toEqual({ status: 'ready', legacyPaymentCount: 2 });

    expect(() => evaluatePaymentProviderBackfillPreflight({
      providerColumnExists: false,
      paymentCount: 3,
    })).toThrow('expected exactly 2 legacy payments before provider backfill, found 3');
  });

  it('provider migration이 이미 적용됐으면 이후 결제 수와 무관하게 preflight를 재실행할 수 있다', () => {
    expect(evaluatePaymentProviderBackfillPreflight({
      providerColumnExists: true,
      paymentCount: 29,
    })).toEqual({ status: 'already_applied' });
  });

  it('linked query의 schema-aware snapshot만 평가하고 비정상 응답은 fail closed한다', async () => {
    const query = vi.fn(async () => ({
      provider_column_exists: false,
      payment_count: '2',
    }));

    await expect(runPaymentProviderBackfillPreflight(query)).resolves.toEqual({
      status: 'ready',
      legacyPaymentCount: 2,
    });
    expect(query).toHaveBeenCalledTimes(1);

    await expect(runPaymentProviderBackfillPreflight(async () => ({
      provider_column_exists: 'false',
      payment_count: '2',
    }))).rejects.toThrow('invalid provider backfill preflight snapshot');
  });
});
