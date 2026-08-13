import { describe, expect, it } from 'vitest';
import { validateVercelBuildEnvironment } from './check-vercel-build-env.mjs';

const baseEnvironment = {
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  AUTH_SIGNUP_RESEND_SECRET: 'resend-secret',
  TOSS_SECRET_KEY: 'test_gsk_example',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('validateVercelBuildEnvironment', () => {
  it('skips checks outside a Vercel preview or production build', () => {
    expect(validateVercelBuildEnvironment({})).toEqual({ checked: false });
  });

  it('accepts a Fake-only preview without a Toss credential and keeps checkout closed', () => {
    const { TOSS_SECRET_KEY: _retired, ...previewEnvironment } = baseEnvironment;
    expect(validateVercelBuildEnvironment(previewEnvironment)).toEqual({
      checked: true,
      legacyTossMode: null,
      newCheckoutEnabled: false,
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
    const environment = { ...baseEnvironment, AUTH_SIGNUP_RESEND_SECRET: '' };

    expect(() => validateVercelBuildEnvironment(environment)).toThrow(
      'Missing Vercel preview environment: AUTH_SIGNUP_RESEND_SECRET',
    );
  });

  it('rejects a non-widget Toss server credential when one is present', () => {
    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      TOSS_SECRET_KEY: 'test_sk_example',
    })).toThrow('Invalid Vercel preview Toss legacy server key');
  });

  it('retired public widget flags cannot open preview checkout without a server credential', () => {
    const { TOSS_SECRET_KEY: _retired, ...previewEnvironment } = baseEnvironment;
    expect(validateVercelBuildEnvironment({
      ...previewEnvironment,
      ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION: 'true',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_retired',
      NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: 'ICONS_REVIEW',
      TOSS_PAYMENT_KEY_PAIR_SHA256: '0'.repeat(64),
    })).toEqual({
      checked: true,
      legacyTossMode: null,
      newCheckoutEnabled: false,
    });
  });

  it('requires the known-only Toss server credential in production', () => {
    const { TOSS_SECRET_KEY: _retired, ...productionEnvironment } = baseEnvironment;
    expect(() => validateVercelBuildEnvironment({
      ...productionEnvironment,
      VERCEL_ENV: 'production',
      CRON_SECRET: 'cron_secret_for_production',
    })).toThrow('Missing Vercel production environment: TOSS_SECRET_KEY');
  });
});
