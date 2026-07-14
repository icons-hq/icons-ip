import { describe, expect, it } from 'vitest';

import { validateVercelBuildEnvironment } from './check-vercel-build-env.mjs';

const baseEnvironment = {
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  AUTH_SIGNUP_RESEND_SECRET: 'resend-secret',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_example',
  TOSS_SECRET_KEY: 'test_gsk_example',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

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

  it('marks only live production keys as checkout-enabled', () => {
    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
    }).productionCheckoutEnabled).toBe(false);

    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      VERCEL_ENV: 'production',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_example',
      TOSS_SECRET_KEY: 'live_gsk_example',
    })).toEqual({
      checked: true,
      paymentMode: 'live',
      productionCheckoutEnabled: true,
    });
  });
});
