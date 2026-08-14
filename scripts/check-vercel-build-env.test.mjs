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

const validKorpayEnvironment = {
  SITE_URL: 'https://iconsip.com',
  KORPAY_MID: 'test12345m',
  KORPAY_KEY: 'A'.repeat(32),
};

function productionEnvironment(overrides = {}) {
  return {
    ...baseEnvironment,
    ...validKorpayEnvironment,
    VERCEL_ENV: 'production',
    CRON_SECRET: 'cron_secret_for_production',
    ...overrides,
  };
}

describe('validateVercelBuildEnvironment', () => {
  it('skips checks outside a Vercel preview or production build', () => {
    expect(validateVercelBuildEnvironment({})).toEqual({ checked: false });
  });

  it('accepts a Fake-only preview without a Toss credential and keeps checkout closed', () => {
    const previewEnvironment = { ...baseEnvironment };
    delete previewEnvironment.TOSS_SECRET_KEY;
    expect(validateVercelBuildEnvironment(previewEnvironment)).toEqual({
      checked: true,
      legacyTossMode: null,
      newCheckoutEnabled: false,
      paymentReconciliationConfigured: false,
      korpayConfigured: false,
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
      korpayOrderCanaryConfigured: false,
      korpayTicketCanaryConfigured: false,
    });
  });

  it('requires only production builds to have a URL-safe cron secret', () => {
    expect(validateVercelBuildEnvironment(baseEnvironment).checked).toBe(true);

    expect(() => validateVercelBuildEnvironment({
      ...productionEnvironment(),
      CRON_SECRET: undefined,
    })).toThrow('Missing Vercel production environment: CRON_SECRET');

    expect(() => validateVercelBuildEnvironment({
      ...productionEnvironment(),
      CRON_SECRET: 'too short',
    })).toThrow('Invalid Vercel production CRON_SECRET');
  });

  it('keeps the dark-deploy secret optional and validates it only when provisioned', () => {
    expect(validateVercelBuildEnvironment(baseEnvironment)).toMatchObject({
      checked: true,
      paymentReconciliationConfigured: false,
    });

    expect(validateVercelBuildEnvironment(productionEnvironment()))
      .toMatchObject({ paymentReconciliationConfigured: false });

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      PAYMENT_RECONCILIATION_SECRET: 'too short',
    }))).toThrow('Invalid Vercel production PAYMENT_RECONCILIATION_SECRET');
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
    const previewEnvironment = { ...baseEnvironment };
    delete previewEnvironment.TOSS_SECRET_KEY;
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
      paymentReconciliationConfigured: false,
      korpayConfigured: false,
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
      korpayOrderCanaryConfigured: false,
      korpayTicketCanaryConfigured: false,
    });
  });

  it('requires the known-only Toss server credential in production', () => {
    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      TOSS_SECRET_KEY: undefined,
    }))).toThrow('Missing Vercel production environment: TOSS_SECRET_KEY');
  });

  it('requires valid Korpay credentials and an HTTPS site URL in production', () => {
    expect(validateVercelBuildEnvironment(productionEnvironment())).toMatchObject({
      checked: true,
      korpayConfigured: true,
    });

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_MID: 'short',
    }))).toThrow('Invalid Vercel production KORPAY_MID');

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_KEY: 'not base64 material with spaces',
    }))).toThrow('Invalid Vercel production KORPAY_KEY');

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      SITE_URL: 'http://icons.example',
    }))).toThrow('Invalid Vercel production SITE_URL');

    for (const siteUrl of [
      'https://user:pass@iconsip.com',
      'https://iconsip.com/checkout',
      'https://iconsip.com?redirect=evil',
      'https://iconsip.com#fragment',
      'https://wrong.example',
    ]) {
      expect(() => validateVercelBuildEnvironment(productionEnvironment({
        SITE_URL: siteUrl,
      }))).toThrow('Invalid Vercel production SITE_URL');
    }
  });

  it('reports missing Korpay production variables by name without credential material', () => {
    const environment = productionEnvironment({
      KORPAY_MID: undefined,
      KORPAY_KEY: undefined,
      SITE_URL: undefined,
    });

    expect(() => validateVercelBuildEnvironment(environment)).toThrow(
      'Missing Vercel production environment: KORPAY_MID, KORPAY_KEY, SITE_URL',
    );
  });

  it.each([
    'KORPAY_ORDER_CHECKOUT_ENABLED',
    'KORPAY_TICKET_CHECKOUT_ENABLED',
  ])('accepts only true, false, or unset for %s', (name) => {
    expect(validateVercelBuildEnvironment(productionEnvironment({ [name]: 'true' })).checked)
      .toBe(true);
    expect(validateVercelBuildEnvironment(productionEnvironment({ [name]: 'false' })).checked)
      .toBe(true);
    expect(validateVercelBuildEnvironment(productionEnvironment({ [name]: undefined })).checked)
      .toBe(true);
    expect(() => validateVercelBuildEnvironment(productionEnvironment({ [name]: 'TRUE' })))
      .toThrow(`Invalid Vercel production ${name}`);
  });

  it('rejects Korpay credentials and enabled checkout gates in preview', () => {
    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      KORPAY_MID: validKorpayEnvironment.KORPAY_MID,
    })).toThrow('Invalid Vercel preview KORPAY_MID: Korpay credentials are production-only');

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      KORPAY_KEY: validKorpayEnvironment.KORPAY_KEY,
    })).toThrow('Invalid Vercel preview KORPAY_KEY: Korpay credentials are production-only');

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      KORPAY_ORDER_CHECKOUT_ENABLED: 'true',
    })).toThrow('Invalid Vercel preview KORPAY_ORDER_CHECKOUT_ENABLED: checkout must remain disabled');

    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      KORPAY_ORDER_CHECKOUT_ENABLED: 'false',
      KORPAY_TICKET_CHECKOUT_ENABLED: 'false',
    })).toMatchObject({
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
    });
  });

  it('allows strict purpose-specific canary UUIDs only in production', () => {
    const orderCanary = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    expect(validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_ORDER_CANARY_USER_ID: orderCanary,
    }))).toMatchObject({
      newCheckoutEnabled: true,
      korpayOrderCanaryConfigured: true,
      korpayTicketCanaryConfigured: false,
    });

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_TICKET_CANARY_USER_ID: 'not-a-uuid',
    }))).toThrow('Invalid Vercel production KORPAY_TICKET_CANARY_USER_ID');

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_TICKET_CANARY_USER_ID: '10000000-0000-7000-8000-000000000207',
    }))).toThrow('Invalid Vercel production KORPAY_TICKET_CANARY_USER_ID');

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      KORPAY_ORDER_CANARY_USER_ID: orderCanary,
    })).toThrow('Invalid Vercel preview KORPAY_ORDER_CANARY_USER_ID: canary users are production-only');
  });

  it('reports purpose readiness using booleans without returning credential values', () => {
    const result = validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_ORDER_CHECKOUT_ENABLED: 'true',
      KORPAY_TICKET_CHECKOUT_ENABLED: 'false',
    }));

    expect(result).toMatchObject({
      korpayConfigured: true,
      korpayOrderCheckoutEnabled: true,
      korpayTicketCheckoutEnabled: false,
      newCheckoutEnabled: true,
    });
    expect(JSON.stringify(result)).not.toContain(validKorpayEnvironment.KORPAY_MID);
    expect(JSON.stringify(result)).not.toContain(validKorpayEnvironment.KORPAY_KEY);
  });
});
