import { describe, expect, it } from 'vitest';
import {
  paymentKeyMode,
  paymentKeysMatch,
  paymentsEnabledForRuntime,
  productionTestPaymentReviewerAllowed,
} from './config';

describe('Toss payment key configuration', () => {
  it('recognizes test and live key prefixes without exposing their values', () => {
    expect(paymentKeyMode('test_gck_example', 'client')).toBe('test');
    expect(paymentKeyMode('test_gsk_example', 'secret')).toBe('test');
    expect(paymentKeyMode('live_gck_example', 'client')).toBe('live');
    expect(paymentKeyMode('live_gsk_example', 'secret')).toBe('live');
  });

  it('fails closed for missing, malformed, or mixed-mode pairs', () => {
    expect(paymentKeysMatch('', '')).toBe(false);
    expect(paymentKeysMatch('test_gck_example', 'live_gsk_example')).toBe(false);
    expect(paymentKeysMatch('test_ck_api-key', 'test_sk_api-key')).toBe(false);
    expect(paymentKeysMatch('unknown', 'unknown')).toBe(false);
    expect(paymentKeysMatch('test_gck_example', 'test_gsk_example')).toBe(true);
  });

  it('allows test keys outside production but requires a live pair on Vercel production', () => {
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'development', 'development')).toBe(true);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'preview', 'production')).toBe(true);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'production', 'production')).toBe(false);
    expect(paymentsEnabledForRuntime('live_gck_example', 'live_gsk_example', 'production', 'production')).toBe(true);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', undefined, 'production')).toBe(false);
    expect(paymentsEnabledForRuntime('live_gck_example', 'live_gsk_example', undefined, 'production')).toBe(true);
  });

  it('enables production test keys only with the exact test-payment override', () => {
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'production', 'production')).toBe(false);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'production', 'production', 'true')).toBe(true);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'production', 'production', 'TRUE')).toBe(false);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'production', 'production', ' true')).toBe(false);
    expect(paymentsEnabledForRuntime('test_gck_example', 'test_gsk_example', 'production', 'production', '1')).toBe(false);
  });

  it('allows production test payments only for an explicitly listed reviewer UUID', () => {
    const reviewerId = '00000000-0000-4000-8000-000000000001';
    const otherId = '00000000-0000-4000-8000-000000000002';

    expect(productionTestPaymentReviewerAllowed(reviewerId, reviewerId)).toBe(true);
    expect(productionTestPaymentReviewerAllowed(reviewerId, ` ${otherId}, ${reviewerId} `)).toBe(true);
    expect(productionTestPaymentReviewerAllowed(otherId, reviewerId)).toBe(false);
    expect(productionTestPaymentReviewerAllowed('', reviewerId)).toBe(false);
    expect(productionTestPaymentReviewerAllowed(reviewerId, '')).toBe(false);
    expect(productionTestPaymentReviewerAllowed('not-a-uuid', 'not-a-uuid')).toBe(false);
  });
});
