import { describe, expect, it } from 'vitest';
import { validateVercelBuildEnvironment } from './check-vercel-build-env.mjs';

const baseEnvironment = {
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  AUTH_SIGNUP_RESEND_SECRET: 'resend-secret',
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

  it('accepts a Fake-only preview and keeps checkout closed', () => {
    expect(validateVercelBuildEnvironment({ ...baseEnvironment })).toEqual({
      checked: true,
      newCheckoutEnabled: false,
      paymentReconciliationConfigured: false,
      korpayConfigured: false,
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
      korpayOrderCanaryConfigured: false,
      korpayTicketCanaryConfigured: false,
      tossConfigured: false,
      tossOrderCheckoutEnabled: false,
      tossTicketCheckoutEnabled: false,
      tossOrderCanaryConfigured: false,
      tossTicketCanaryConfigured: false,
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

  it('retired legacy Toss variables cannot open preview checkout or fail the build', () => {
    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION: 'true',
      TOSS_SECRET_KEY: 'test_gsk_retired',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_retired',
      NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: 'ICONS_REVIEW',
      TOSS_PAYMENT_KEY_PAIR_SHA256: '0'.repeat(64),
    })).toEqual({
      checked: true,
      newCheckoutEnabled: false,
      paymentReconciliationConfigured: false,
      korpayConfigured: false,
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
      korpayOrderCanaryConfigured: false,
      korpayTicketCanaryConfigured: false,
      tossConfigured: false,
      tossOrderCheckoutEnabled: false,
      tossTicketCheckoutEnabled: false,
      tossOrderCanaryConfigured: false,
      tossTicketCanaryConfigured: false,
    });
  });

  it('keeps the Toss widget key pair optional and silently unconfigured when malformed', () => {
    // 심사(#394) 전 미등록 — 통과.
    expect(validateVercelBuildEnvironment(productionEnvironment())).toMatchObject({
      tossConfigured: false,
    });
    // 구 v1 API 키 잔존·반쪽 페어 — 결제를 여는 신호가 없으면 침묵 unconfigured.
    expect(validateVercelBuildEnvironment(productionEnvironment({
      TOSS_SECRET_KEY: 'test_sk_legacyapikey000000000001',
    }))).toMatchObject({ tossConfigured: false });
    expect(validateVercelBuildEnvironment(productionEnvironment({
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
    }))).toMatchObject({ tossConfigured: false });
    // 유효 페어(모드 일치) — configured.
    expect(validateVercelBuildEnvironment(productionEnvironment({
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
    }))).toMatchObject({ tossConfigured: true, newCheckoutEnabled: false });
  });

  it('refuses to open a Toss gate or canary over a missing or misaligned key pair', () => {
    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
    }))).toThrow('Invalid Vercel production Toss configuration');

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'live_gsk_iconsdocs00000000000001',
    }))).toThrow('Invalid Vercel production Toss configuration');

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      TOSS_ORDER_CANARY_USER_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    }))).toThrow('Invalid Vercel production Toss configuration');

    expect(validateVercelBuildEnvironment(productionEnvironment({
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
    }))).toMatchObject({
      tossConfigured: true,
      tossOrderCheckoutEnabled: true,
      newCheckoutEnabled: true,
    });
  });

  it('rejects enabled Toss gates and canaries in preview while tolerating stale keys', () => {
    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
    })).toThrow('Invalid Vercel preview TOSS_ORDER_CHECKOUT_ENABLED: checkout must remain disabled');

    expect(() => validateVercelBuildEnvironment({
      ...baseEnvironment,
      TOSS_TICKET_CANARY_USER_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })).toThrow('Invalid Vercel preview TOSS_TICKET_CANARY_USER_ID: canary users are production-only');

    expect(validateVercelBuildEnvironment({
      ...baseEnvironment,
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
      TOSS_ORDER_CHECKOUT_ENABLED: 'false',
    })).toMatchObject({ tossConfigured: false, tossOrderCheckoutEnabled: false });
  });

  it('validates Toss canary UUIDs in production like the Korpay ones', () => {
    const tossEnvironment = {
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
    };
    expect(validateVercelBuildEnvironment(productionEnvironment({
      ...tossEnvironment,
      TOSS_ORDER_CANARY_USER_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    }))).toMatchObject({ tossOrderCanaryConfigured: true, newCheckoutEnabled: true });

    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      ...tossEnvironment,
      TOSS_ORDER_CANARY_USER_ID: 'not-a-uuid',
    }))).toThrow('Invalid Vercel production TOSS_ORDER_CANARY_USER_ID');
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

  it('accepts only true, false, or unset for Toss checkout gates', () => {
    expect(validateVercelBuildEnvironment(productionEnvironment({
      TOSS_TICKET_CHECKOUT_ENABLED: 'false',
    })).checked).toBe(true);
    expect(() => validateVercelBuildEnvironment(productionEnvironment({
      TOSS_TICKET_CHECKOUT_ENABLED: 'TRUE',
    }))).toThrow('Invalid Vercel production TOSS_TICKET_CHECKOUT_ENABLED');
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
