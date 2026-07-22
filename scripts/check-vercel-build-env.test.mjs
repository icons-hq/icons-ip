import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { validateVercelBuildEnvironment } from './check-vercel-build-env.mjs';

const baseEnvironment = {
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  AUTH_SIGNUP_RESEND_SECRET: 'resend-secret',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_example',
  NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: 'ICONS_REVIEW',
  TOSS_SECRET_KEY: 'test_gsk_example',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const testPairFingerprint = createHash('sha256')
  .update(`${baseEnvironment.NEXT_PUBLIC_TOSS_CLIENT_KEY}\0${baseEnvironment.TOSS_SECRET_KEY}`)
  .digest('hex');

describe('validateVercelBuildEnvironment', () => {
  it('skips checks outside a Vercel preview or production build', () => {
    expect(validateVercelBuildEnvironment({})).toEqual({ checked: false });
  });

  it('accepts a complete preview environment with matching widget keys', () => {
    expect(validateVercelBuildEnvironment(baseEnvironment)).toEqual({
      checked: true,
      paymentMode: 'test',
      productionCheckoutEnabled: false,
    });
  });

  it('requires only production builds to have a URL-safe cron secret', () => {
    expect(validateVercelBuildEnvironment(baseEnvironment).checked).toBe(true);

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
    })).toThrow('Missing Vercel production environment: CRON_SECRET');

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'too short',
    })).toThrow('Invalid Vercel production CRON_SECRET');
  });

  it('accepts the legacy Supabase anon key name', () => {
    const environment = { ...baseEnvironment };
    delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(validateVercelBuildEnvironment({
      ...environment,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }).checked).toBe(true);
  });

  it('reports required variables by name without including their values', () => {
    const environment = { ...baseEnvironment, TOSS_SECRET_KEY: '' };

    expect(() => validateVercelBuildEnvironment(environment)).toThrow(
      'Missing Vercel preview environment: TOSS_SECRET_KEY',
    );
  });

  it('rejects mismatched or non-widget Toss keys', () => {
    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      TOSS_SECRET_KEY: 'live_gsk_example',
    })).toThrow('Invalid Vercel preview payment keys');

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_example',
      TOSS_SECRET_KEY: 'test_sk_example',
    })).toThrow('Invalid Vercel preview payment keys');
  });

  it('requires a valid payment-method variant for test widget keys', () => {
    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: '',
    })).toThrow(
      'Missing Vercel preview test-payment environment: NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY',
    );

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: 'DEFAULT',
    })).toThrow('Invalid Vercel preview Toss test payment-method variant key');
  });

  it('rejects the test-only payment-method variant with live widget keys', () => {
    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_example',
      TOSS_SECRET_KEY: 'live_gsk_example',
    })).toThrow('Invalid Vercel production Toss live payment-method variant key');
  });

  it('enables production test keys only with the exact test-payment override', () => {
    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
      TOSS_PAYMENT_KEY_PAIR_SHA256: testPairFingerprint,
    }).productionCheckoutEnabled).toBe(false);

    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_example',
      NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: undefined,
      TOSS_SECRET_KEY: 'live_gsk_example',
      TOSS_PAYMENT_KEY_PAIR_SHA256: createHash('sha256')
        .update('live_gck_example\0live_gsk_example')
        .digest('hex'),
    })).toEqual({
      checked: true,
      paymentMode: 'live',
      productionCheckoutEnabled: true,
    });

    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
      ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION: 'true',
      TOSS_PAYMENT_KEY_PAIR_SHA256: testPairFingerprint,
    })).toEqual({
      checked: true,
      paymentMode: 'test',
      productionCheckoutEnabled: true,
    });

    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
      ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION: 'TRUE',
      TOSS_PAYMENT_KEY_PAIR_SHA256: testPairFingerprint,
    }).productionCheckoutEnabled).toBe(false);
  });

  it('rejects production test mode without the approved key-pair fingerprint', () => {
    const productionTestEnvironment = {
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
      ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION: 'true',
    };

    expect(() => validateVercelBuildEnvironment(productionTestEnvironment))
      .toThrow('Missing Vercel production test-payment environment: TOSS_PAYMENT_KEY_PAIR_SHA256');

    expect(() => validateVercelBuildEnvironment({
      ...productionTestEnvironment,
      TOSS_PAYMENT_KEY_PAIR_SHA256: '0'.repeat(64),
    })).toThrow('Invalid Vercel production payment key-pair fingerprint');
  });
});
