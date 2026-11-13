import { describe, expect, it } from 'vitest';
import {
  formatVercelBuildReadback,
  validateLegalRevisionDates,
  validateVercelBuildEnvironment,
} from './check-vercel-build-env.mjs';

const baseEnvironment = {
  VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_preview_test',
  AUTH_SIGNUP_RESEND_SECRET: 'resend-secret',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_preview_test',
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

const stagingEnvironment = {
  ...baseEnvironment,
  ICONS_STAGING_BUILD: 'admin-ops-v1',
  ICONS_STAGING_PROJECT_REF: 'cdefghijklmnopqrstuv',
  ICONS_STAGING_PREVIEW_PROJECT_REF: 'abcdefghijklmnopqrst',
  ICONS_STAGING_PRODUCTION_PROJECT_REF: 'bcdefghijklmnopqrstu',
  NEXT_PUBLIC_SUPABASE_URL: 'https://cdefghijklmnopqrstuv.supabase.co',
  SITE_URL: 'https://icons-ip-staging.vercel.app',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_staging00000001',
  TOSS_SECRET_KEY: 'test_gsk_staging00000001',
  KORPAY_ORDER_CHECKOUT_ENABLED: 'false',
  KORPAY_TICKET_CHECKOUT_ENABLED: 'false',
  TOSS_ORDER_CHECKOUT_ENABLED: 'false',
  TOSS_TICKET_CHECKOUT_ENABLED: 'false',
};

describe('validateVercelBuildEnvironment', () => {
  it('validates inherited staging test widget keys only inside the remote build without exposing values', () => {
    const result = validateVercelBuildEnvironment(stagingEnvironment);
    expect(result).toMatchObject({ checked: true, stagingVerified: true, newCheckoutEnabled: false });
    expect(JSON.stringify(result)).not.toContain(stagingEnvironment.TOSS_SECRET_KEY);
    for (const change of [
      { TOSS_SECRET_KEY: '' },
      { NEXT_PUBLIC_TOSS_CLIENT_KEY: '[SENSITIVE]' },
      { TOSS_SECRET_KEY: 'test_sk_legacyapikey00000001' },
      { TOSS_SECRET_KEY: 'live_gsk_staging00000001' },
      { NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_staging00000001', TOSS_SECRET_KEY: 'live_gsk_staging00000001' },
    ]) {
      expect(() => validateVercelBuildEnvironment({ ...stagingEnvironment, ...change }))
        .toThrow('Staging requires an inherited Toss test widget key pair');
    }
  });

  it('binds the staging marker to Preview, a staging alias, an isolated Supabase ref and closed gates', () => {
    expect(validateVercelBuildEnvironment({
      ...stagingEnvironment, SITE_URL: 'https://icons-ip-staging-ops.vercel.app',
    }).checked).toBe(true);
    for (const change of [
      { ICONS_STAGING_BUILD: undefined },
      { ICONS_STAGING_BUILD: '' },
      { ICONS_STAGING_BUILD: 'true' },
      { VERCEL_ENV: undefined },
      { VERCEL_ENV: 'production' },
      { SITE_URL: undefined },
      { SITE_URL: 'https://iconsip.com' },
      { SITE_URL: 'http://icons-ip-staging.vercel.app' },
      { SITE_URL: 'https://user:private@icons-ip-staging.vercel.app' },
      { SITE_URL: 'https://icons-ip-staging.vercel.app/path' },
      { SITE_URL: 'https://icons-ip-staging.vercel.app?redirect=elsewhere' },
      { SITE_URL: 'https://icons-ip-staging.vercel.app#fragment' },
      { ICONS_STAGING_PROJECT_REF: undefined },
      { ICONS_STAGING_PROJECT_REF: stagingEnvironment.ICONS_STAGING_PREVIEW_PROJECT_REF },
      { ICONS_STAGING_PROJECT_REF: stagingEnvironment.ICONS_STAGING_PRODUCTION_PROJECT_REF },
      { ICONS_STAGING_PREVIEW_PROJECT_REF: stagingEnvironment.ICONS_STAGING_PRODUCTION_PROJECT_REF },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' },
      { TOSS_ORDER_CHECKOUT_ENABLED: undefined },
      { TOSS_TICKET_CHECKOUT_ENABLED: 'true' },
      { KORPAY_ORDER_CHECKOUT_ENABLED: '' },
      { KORPAY_TICKET_CHECKOUT_ENABLED: 'TRUE' },
    ]) expect(() => validateVercelBuildEnvironment({ ...stagingEnvironment, ...change })).toThrow(/Staging/);
  });

  it('retains Preview canary and Korpay credential prohibitions for staging', () => {
    for (const name of ['TOSS_ORDER_CANARY_USER_ID', 'TOSS_TICKET_CANARY_USER_ID',
      'KORPAY_ORDER_CANARY_USER_ID', 'KORPAY_TICKET_CANARY_USER_ID', 'KORPAY_MID', 'KORPAY_KEY']) {
      expect(() => validateVercelBuildEnvironment({ ...stagingEnvironment, [name]: 'private-forbidden-value' }))
        .toThrow(`Invalid Vercel preview ${name}`);
    }
  });

  it('skips checks outside a Vercel preview or production build', () => {
    expect(validateVercelBuildEnvironment({})).toEqual({ checked: false });
  });

  it('accepts a Fake-only preview and keeps checkout closed', () => {
    expect(validateVercelBuildEnvironment({ ...baseEnvironment })).toEqual({
      checked: true,
      warnings: [],
      newCheckoutEnabled: false,
      paymentReconciliationConfigured: false,
      korpayConfigured: false,
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
      korpayOrderCanaryConfigured: false,
      korpayTicketCanaryConfigured: false,
      tossConfigured: false,
      tossMode: 'none',
      // 결제 UI 바인딩(TOSS_WIDGET_VARIANT_KEY)이 없으면 null — DEFAULT 결제 UI, MID 대조 없음.
      tossVariantKey: null,
      tossMerchantIds: [],
      tossDocsPublicKey: false,
      tossOrderCheckoutEnabled: false,
      tossTicketCheckoutEnabled: false,
      tossOrderCanaryConfigured: false,
      tossTicketCanaryConfigured: false,
      nicepayConfigured: false,
      nicepayOrderCheckoutEnabled: false,
      nicepayOrderCanaryConfigured: false,
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

  it('requires the publishable key even when a legacy anon key is present', () => {
    const environment = { ...baseEnvironment, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.anon.sig' };
    delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(() => validateVercelBuildEnvironment(environment)).toThrow(
      'Missing Vercel preview environment: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  });

  it('rejects legacy or masked Supabase API keys without echoing them', () => {
    const legacyJwt = 'eyJhbGciOiJIUzI1NiJ9.legacy.signature';
    for (const target of ['preview', 'production']) {
      const environment = target === 'production' ? productionEnvironment() : baseEnvironment;
      for (const [name, value, message] of [
        ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', legacyJwt, 'not a legacy anon JWT'],
        ['SUPABASE_SERVICE_ROLE_KEY', legacyJwt, 'not a legacy service_role JWT'],
        ['SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_abcde\u00b7\u00b7\u00b7\u00b7', 'not a legacy service_role JWT'],
        ['SUPABASE_SERVICE_ROLE_KEY', 'sb_publishable_wrong_slot', 'not a legacy service_role JWT'],
      ]) {
        let error;
        try {
          validateVercelBuildEnvironment({ ...environment, [name]: value });
        } catch (caught) {
          error = caught;
        }
        expect(error?.message).toContain(`Invalid Vercel ${target} ${name}`);
        expect(error?.message).toContain(message);
        expect(error?.message).not.toContain(value);
      }
    }
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
      warnings: [],
      newCheckoutEnabled: false,
      paymentReconciliationConfigured: false,
      korpayConfigured: false,
      korpayOrderCheckoutEnabled: false,
      korpayTicketCheckoutEnabled: false,
      korpayOrderCanaryConfigured: false,
      korpayTicketCanaryConfigured: false,
      tossConfigured: false,
      tossMode: 'none',
      // 결제 UI 바인딩(TOSS_WIDGET_VARIANT_KEY)이 없으면 null — DEFAULT 결제 UI, MID 대조 없음.
      tossVariantKey: null,
      tossMerchantIds: [],
      tossDocsPublicKey: false,
      tossOrderCheckoutEnabled: false,
      tossTicketCheckoutEnabled: false,
      tossOrderCanaryConfigured: false,
      tossTicketCanaryConfigured: false,
      nicepayConfigured: false,
      nicepayOrderCheckoutEnabled: false,
      nicepayOrderCanaryConfigured: false,
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
    // 공식문서가 게시한 키처럼 suffix에 밑줄이 섞여도 유효 페어다 — 접두사만
    // 계약이라 문자집합을 좁히면 유효한 발급 키가 침묵 차단된다.
    expect(validateVercelBuildEnvironment(productionEnvironment({
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_docs_OaPz8L5KdmQXkzRz3y47BMw6',
      TOSS_SECRET_KEY: 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6',
    }))).toMatchObject({ tossConfigured: true });
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

  /*
   * 심사 창(#398 시퀀스 ③)에는 공개 gate + 테스트 키가 계획된 정상 상태다 —
   * 외부 심사자가 비회원으로 결제창을 봐야 해서 canary로 대체할 수 없다. 막으면
   * 심사가 멈추고, 조용히 통과시키면 무과금 paid 주문이 눈에 안 띈다.
   */
  it('warns without failing when a public Toss gate is open on test-mode keys', () => {
    const result = validateVercelBuildEnvironment(productionEnvironment({
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
    }));

    expect(result).toMatchObject({ checked: true, tossOrderCheckoutEnabled: true });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('test-mode keys');
    expect(result.warnings[0]).toContain('docs/runbooks/toss-production-rollout.md');
  });

  /*
   * 문서 공개 테스트 키(test_g*k_docs_…)의 결제는 우리 상점 결제내역·웹훅에 남지 않는다. 결제 UI
   * 바인딩이 켜져 있으면 런타임 MID 대조로 전부 needs_review가 된다. 심사 창 배포를 막지 않도록
   * 빌드는 통과시키고 경고만 남긴다(키 값은 출력하지 않는다).
   */
  it('warns without failing when production carries the developer-docs public Toss keys', () => {
    const docsKeys = {
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_docs_000000000000000000000001',
      TOSS_SECRET_KEY: 'test_gsk_docs_000000000000000000000001',
    };
    const gateClosed = validateVercelBuildEnvironment(productionEnvironment(docsKeys));
    expect(gateClosed).toMatchObject({ checked: true, tossConfigured: true, tossDocsPublicKey: true });
    expect(gateClosed.warnings).toHaveLength(1);
    expect(gateClosed.warnings[0]).toContain('developer-docs public test keys');
    // 바인딩이 꺼져 있으면 런타임 MID 대조가 없으므로 그 문장은 싣지 않는다.
    expect(gateClosed.warnings[0]).not.toContain('merchant check');
    // 해결책은 계정의 상점 키로 교체하는 것이고, MID별 주문서형 키는 없다(/reference/using-api/api-keys).
    expect(gateClosed.warnings[0]).toContain("account's own payment-widget keys");
    expect(gateClosed.warnings[0]).not.toContain('keys issued for merchant');
    expect(gateClosed.warnings[0]).toContain('docs/runbooks/toss-production-rollout.md');
    expect(JSON.stringify(gateClosed)).not.toContain(docsKeys.TOSS_SECRET_KEY);
    expect(JSON.stringify(gateClosed)).not.toContain(docsKeys.NEXT_PUBLIC_TOSS_CLIENT_KEY);

    // 바인딩이 켜져 있으면 문서 공개 키는 테스트 키라 대조 MID는 테스트 모드 MID다.
    const bound = validateVercelBuildEnvironment(productionEnvironment({
      ...docsKeys,
      TOSS_WIDGET_VARIANT_KEY: 'ICONS',
    }));
    expect(bound.warnings).toHaveLength(1);
    expect(bound.warnings[0]).toContain('runtime merchant check (MID ticonsi0xvd|ticonsi8sr4)');

    // 심사 창(공개 gate + 테스트 키)이면 테스트 모드 경고와 함께 두 줄이다.
    const gateOpen = validateVercelBuildEnvironment(productionEnvironment({
      ...docsKeys,
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
    }));
    expect(gateOpen.warnings).toHaveLength(2);

    // 한쪽만 문서 키여도 경고한다(페어가 아니면 configured는 아니다).
    expect(validateVercelBuildEnvironment(productionEnvironment({
      TOSS_SECRET_KEY: docsKeys.TOSS_SECRET_KEY,
    })).warnings).toHaveLength(1);

    // 상점 키(이름에 docs가 들어가도 `_docs_` 접두가 아니면)와 Preview는 경고하지 않는다.
    expect(validateVercelBuildEnvironment(productionEnvironment({
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
    }))).toMatchObject({ tossDocsPublicKey: false, warnings: [] });
    expect(validateVercelBuildEnvironment({ ...baseEnvironment, ...docsKeys }))
      .toMatchObject({ tossDocsPublicKey: false, warnings: [] });
  });

  /*
   * 허용 MID는 키 모드별이다 — 테스트 키 결제의 mId는 `t` + 라이브 MID(2026-10-12 결제
   * 어드민 실측). 심사 창(테스트 키)에서 readback이 라이브 MID를 말하면 canary 결과와
   * 대조할 값이 틀린다. 결제 UI 바인딩이 꺼져 있으면 대조 자체가 없다고 읽힌다.
   */
  it('reads back the test-mode merchants and the bound payment UI on test keys', () => {
    const testKeys = {
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
    };
    const bound = validateVercelBuildEnvironment(productionEnvironment({
      ...testKeys,
      TOSS_WIDGET_VARIANT_KEY: 'ICONS',
    }));
    expect(bound).toMatchObject({
      tossMode: 'test',
      tossVariantKey: 'ICONS',
      tossMerchantIds: ['ticonsi0xvd', 'ticonsi8sr4'],
    });
    const line = formatVercelBuildReadback(bound, 'production');
    expect(line).toContain(
      'Toss mode=test, Toss variant=ICONS, Toss merchant=ticonsi0xvd|ticonsi8sr4, docs public key=false',
    );
    expect(line).not.toContain('test_gsk_iconsdocs00000000000001');

    // 바인딩 전(지금 상태) — DEFAULT 결제 UI, MID 대조 없음.
    const unbound = validateVercelBuildEnvironment(productionEnvironment(testKeys));
    expect(unbound).toMatchObject({ tossMode: 'test', tossVariantKey: null, tossMerchantIds: [] });
    expect(formatVercelBuildReadback(unbound, 'production')).toContain(
      'Toss mode=test, Toss variant=DEFAULT (unbound), Toss merchant check=off, docs public key=false',
    );
  });

  it('reads back the Toss key mode, merchant, and reconciliation secret presence without values', () => {
    const secret = 'reconciliation_secret_value_0001';
    const result = validateVercelBuildEnvironment(productionEnvironment({
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'live_gsk_iconsdocs00000000000001',
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
      TOSS_WIDGET_VARIANT_KEY: 'ICONS',
      PAYMENT_RECONCILIATION_SECRET: secret,
    }));
    expect(result).toMatchObject({
      tossMode: 'live',
      tossVariantKey: 'ICONS',
      tossMerchantIds: ['iconsi0xvd', 'iconsi8sr4'],
      paymentReconciliationConfigured: true,
    });

    const line = formatVercelBuildReadback(result, 'production');
    expect(line).toContain('Vercel production environment verified; ');
    expect(line).toContain('Korpay configured=true (drain only; checkout gates retired); ');
    expect(line).toContain('Toss configured=true, order checkout enabled=true');
    expect(line).toContain(
      'Toss mode=live, Toss variant=ICONS, Toss merchant=iconsi0xvd|iconsi8sr4, docs public key=false; ',
    );
    expect(line).toContain('NICEPAY configured=false, order checkout enabled=false, order canary configured=false; ');
    expect(line).toContain('payment reconciliation secret configured=true');
    expect(line).not.toContain(secret);
    expect(line).not.toContain('live_gsk_iconsdocs00000000000001');
    expect(line).not.toContain('live_gck_iconsdocs00000000000001');

    const unconfigured = formatVercelBuildReadback(
      validateVercelBuildEnvironment(productionEnvironment()),
      'production',
    );
    expect(unconfigured).toContain('Toss configured=false');
    expect(unconfigured).toContain('Toss mode=none, Toss variant=DEFAULT (unbound), Toss merchant check=off');
    expect(unconfigured).toContain('payment reconciliation secret configured=false');
  });

  it('keeps the build log quiet once the public Toss gate runs on live keys', () => {
    expect(validateVercelBuildEnvironment(productionEnvironment({
      TOSS_ORDER_CHECKOUT_ENABLED: 'true',
      TOSS_TICKET_CHECKOUT_ENABLED: 'true',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'live_gsk_iconsdocs00000000000001',
      TOSS_WIDGET_VARIANT_KEY: 'ICONS',
    }))).toMatchObject({ tossConfigured: true, warnings: [] });

    // 테스트 키라도 공개 gate가 닫혀 있으면(canary만) 경고 대상이 아니다.
    expect(validateVercelBuildEnvironment(productionEnvironment({
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
      TOSS_ORDER_CANARY_USER_ID: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    }))).toMatchObject({ warnings: [] });
  });

  describe('Toss 결제 UI 바인딩(TOSS_WIDGET_VARIANT_KEY·TOSS_ADDITIONAL_MERCHANT_IDS)', () => {
    const liveKeys = {
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'live_gsk_iconsdocs00000000000001',
    };
    const testKeys = {
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_iconsdocs00000000000001',
      TOSS_SECRET_KEY: 'test_gsk_iconsdocs00000000000001',
    };

    /*
     * 바인딩이 없으면 위젯이 SDK 기본 DEFAULT 결제 UI를 그리고, 우리 계정의 DEFAULT는 다른
     * 서비스와 함께 쓰는 구 MID에 연결돼 있다 — 라이브 키로 그 상태를 배포하면 실결제가 ICONS
     * 상점이 아닌 곳에 잡힌다. 런북 순서(결제 UI 생성 → env → 배포 → 라이브 키)를 빌드가 강제한다.
     */
    it('라이브 키는 결제 UI 바인딩 없이 production 빌드를 통과하지 못한다(gate와 무관)', () => {
      for (const gates of [{}, { TOSS_ORDER_CHECKOUT_ENABLED: 'true' }]) {
        let error;
        try {
          validateVercelBuildEnvironment(productionEnvironment({ ...liveKeys, ...gates }));
        } catch (caught) {
          error = caught;
        }
        expect(error?.message).toContain('live widget keys require TOSS_WIDGET_VARIANT_KEY');
        expect(error?.message).toContain('docs/runbooks/toss-production-rollout.md');
        expect(error?.message).not.toContain(liveKeys.TOSS_SECRET_KEY);
      }
      expect(validateVercelBuildEnvironment(productionEnvironment({
        ...liveKeys,
        TOSS_WIDGET_VARIANT_KEY: 'ICONS',
      }))).toMatchObject({ tossMode: 'live', tossVariantKey: 'ICONS' });
    });

    it('테스트 키는 바인딩 없이도 통과한다 — 바인딩 전 지금 상태다', () => {
      expect(validateVercelBuildEnvironment(productionEnvironment(testKeys))).toMatchObject({
        tossMode: 'test',
        tossVariantKey: null,
        tossMerchantIds: [],
        warnings: [],
      });
    });

    it.each([
      ['DEFAULT', 'DEFAULT'],
      ['소문자 default', 'default'],
      ['허용 밖 문자', 'ICONS UI'],
      ['너무 긴 값', 'A'.repeat(51)],
    ])('형식 밖 variantKey(%s)는 어느 target이든 빌드를 멈추고 값을 싣지 않는다', (_label, value) => {
      for (const environment of [
        productionEnvironment({ ...testKeys, TOSS_WIDGET_VARIANT_KEY: value }),
        { ...baseEnvironment, TOSS_WIDGET_VARIANT_KEY: value },
      ]) {
        let error;
        try {
          validateVercelBuildEnvironment(environment);
        } catch (caught) {
          error = caught;
        }
        expect(error?.message).toContain('TOSS_WIDGET_VARIANT_KEY');
        expect(error?.message).toContain('never DEFAULT');
        if (value.length > 8) expect(error?.message).not.toContain(value);
      }
    });

    it('빈 값·공백만 있는 variantKey는 바인딩 꺼짐으로 읽는다', () => {
      for (const value of ['', '   ']) {
        expect(validateVercelBuildEnvironment(productionEnvironment({
          ...testKeys,
          TOSS_WIDGET_VARIANT_KEY: value,
        }))).toMatchObject({ tossVariantKey: null, tossMerchantIds: [] });
      }
    });

    it('알리페이처럼 나중에 계약한 MID를 env로 더하면 키 모드별 허용 MID에 들어간다', () => {
      const result = validateVercelBuildEnvironment(productionEnvironment({
        ...testKeys,
        TOSS_WIDGET_VARIANT_KEY: 'ICONS',
        TOSS_ADDITIONAL_MERCHANT_IDS: ' iconsalipy1 , iconsi0xvd,iconsalipy1 ',
      }));
      // 중복·코드 상수에 이미 있는 MID는 걸러 내고, 테스트 키면 `t`를 붙인다.
      expect(result.tossMerchantIds).toEqual(['ticonsi0xvd', 'ticonsi8sr4', 'ticonsalipy1']);
      expect(formatVercelBuildReadback(result, 'production'))
        .toContain('Toss merchant=ticonsi0xvd|ticonsi8sr4|ticonsalipy1');
    });

    it.each([
      ['공백 낀 값', 'icons alipay'],
      ['허용 밖 문자', 'icons-alipay'],
      ['빈 항목', 'iconsalipy1,,'],
      ['너무 긴 MID', 'a'.repeat(15)],
    ])('형식 밖 추가 MID(%s)는 빌드를 멈춘다', (_label, value) => {
      expect(() => validateVercelBuildEnvironment(productionEnvironment({
        ...testKeys,
        TOSS_WIDGET_VARIANT_KEY: 'ICONS',
        TOSS_ADDITIONAL_MERCHANT_IDS: value,
      }))).toThrow('Invalid Vercel production TOSS_ADDITIONAL_MERCHANT_IDS');
    });

    it('바인딩 없이 추가 MID만 놓이면 효과가 없다고 경고한다', () => {
      const result = validateVercelBuildEnvironment(productionEnvironment({
        ...testKeys,
        TOSS_ADDITIONAL_MERCHANT_IDS: 'iconsalipy1',
      }));
      expect(result.tossMerchantIds).toEqual([]);
      expect(result.warnings).toEqual([
        expect.stringContaining('TOSS_ADDITIONAL_MERCHANT_IDS is ignored while TOSS_WIDGET_VARIANT_KEY is unset'),
      ]);
    });

    it('production에 남은 구 연동 variant env는 읽지 않고 경고만 한다(값은 싣지 않는다)', () => {
      const result = validateVercelBuildEnvironment(productionEnvironment({
        ...testKeys,
        NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY: 'LEGACY_VARIANT_VALUE',
      }));
      expect(result.tossVariantKey).toBeNull();
      expect(result.warnings).toEqual([
        expect.stringContaining('NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY is a legacy Toss variable and is ignored'),
      ]);
      expect(JSON.stringify(result)).not.toContain('LEGACY_VARIANT_VALUE');
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
    // 코페이 canary는 은퇴해 신규 결제를 열지 않는다 — 형식 검증과 경고만 남는다.
    expect(validateVercelBuildEnvironment(productionEnvironment({
      KORPAY_ORDER_CANARY_USER_ID: orderCanary,
    }))).toMatchObject({
      newCheckoutEnabled: false,
      korpayOrderCanaryConfigured: true,
      korpayTicketCanaryConfigured: false,
      warnings: [expect.stringContaining('Korpay checkout gates and canaries are retired')],
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
      newCheckoutEnabled: false,
      warnings: [expect.stringContaining('Korpay checkout gates and canaries are retired')],
    });
    expect(JSON.stringify(result)).not.toContain(validKorpayEnvironment.KORPAY_MID);
    expect(JSON.stringify(result)).not.toContain(validKorpayEnvironment.KORPAY_KEY);
  });
  describe('NICEPAY', () => {
    // 형식만 맞춘 가짜 값이다. 실제 MID·MerchantKey는 저장소에 두지 않는다.
    const nicepay = {
      NICEPAY_MID: 'iconst000m',
      NICEPAY_MERCHANT_KEY: 'c2VydmVyLW9ubHktbmljZXBheS1rZXktZml4dHVyZS0yMDI2',
    };
    const canary = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    it('MID·KEY 발급 전에는 production 빌드를 막지 않는다', () => {
      expect(validateVercelBuildEnvironment(productionEnvironment())).toMatchObject({
        checked: true,
        nicepayConfigured: false,
        nicepayOrderCheckoutEnabled: false,
        nicepayOrderCanaryConfigured: false,
      });
    });

    it('production에서 형식이 맞는 자격 증명과 단일 canary를 받되 값은 결과에 싣지 않는다', () => {
      const result = validateVercelBuildEnvironment(productionEnvironment({
        ...nicepay,
        NICEPAY_ORDER_CANARY_USER_ID: canary,
      }));
      expect(result).toMatchObject({
        nicepayConfigured: true,
        nicepayOrderCheckoutEnabled: false,
        nicepayOrderCanaryConfigured: true,
        newCheckoutEnabled: true,
      });
      expect(JSON.stringify(result)).not.toContain(nicepay.NICEPAY_MERCHANT_KEY);
      expect(JSON.stringify(result)).not.toContain(nicepay.NICEPAY_MID);
    });

    it('하나라도 놓인 자격 증명은 둘 다 형식이 맞아야 한다', () => {
      expect(() => validateVercelBuildEnvironment(productionEnvironment({ NICEPAY_MID: nicepay.NICEPAY_MID })))
        .toThrow('Invalid Vercel production NICEPAY_MERCHANT_KEY');
      expect(() => validateVercelBuildEnvironment(productionEnvironment({ ...nicepay, NICEPAY_MID: 'short' })))
        .toThrow('Invalid Vercel production NICEPAY_MID');
    });

    it('자격 증명 없이 gate나 canary를 켜면 빌드에서 멈춘다', () => {
      expect(() => validateVercelBuildEnvironment(productionEnvironment({ NICEPAY_ORDER_CHECKOUT_ENABLED: 'true' })))
        .toThrow('Invalid Vercel production NICEPAY configuration');
      expect(() => validateVercelBuildEnvironment(productionEnvironment({ NICEPAY_ORDER_CANARY_USER_ID: canary })))
        .toThrow('Invalid Vercel production NICEPAY configuration');
      expect(() => validateVercelBuildEnvironment(productionEnvironment({
        ...nicepay,
        NICEPAY_ORDER_CANARY_USER_ID: 'not-a-uuid',
      }))).toThrow('Invalid Vercel production NICEPAY_ORDER_CANARY_USER_ID');
      expect(() => validateVercelBuildEnvironment(productionEnvironment({
        ...nicepay,
        NICEPAY_ORDER_CHECKOUT_ENABLED: 'TRUE',
      }))).toThrow('Invalid Vercel production NICEPAY_ORDER_CHECKOUT_ENABLED');
    });

    it('preview에는 자격 증명·gate·canary를 두지 않는다', () => {
      expect(() => validateVercelBuildEnvironment({ ...baseEnvironment, NICEPAY_MID: nicepay.NICEPAY_MID }))
        .toThrow('Invalid Vercel preview NICEPAY_MID: NICEPAY credentials are production-only');
      expect(() => validateVercelBuildEnvironment({ ...baseEnvironment, NICEPAY_MERCHANT_KEY: nicepay.NICEPAY_MERCHANT_KEY }))
        .toThrow('Invalid Vercel preview NICEPAY_MERCHANT_KEY: NICEPAY credentials are production-only');
      expect(() => validateVercelBuildEnvironment({ ...baseEnvironment, NICEPAY_ORDER_CHECKOUT_ENABLED: 'true' }))
        .toThrow('Invalid Vercel preview NICEPAY_ORDER_CHECKOUT_ENABLED: checkout must remain disabled');
      expect(() => validateVercelBuildEnvironment({ ...baseEnvironment, NICEPAY_ORDER_CANARY_USER_ID: canary }))
        .toThrow('Invalid Vercel preview NICEPAY_ORDER_CANARY_USER_ID: canary users are production-only');
    });
  });
});

describe('legal revision date guard', () => {
  const source = (announced, effective) => JSON.stringify({ announcedDate: announced, effectiveDate: effective });
  const nullSource = source(null, null);

  it('does nothing while no revision is reserved (both null)', () => {
    expect(() => validateLegalRevisionDates(nullSource)).not.toThrow();
  });

  it('accepts valid dates on any build day - the dates stay in code after the effective date', () => {
    expect(() => validateLegalRevisionDates(source('2026-11-20', '2026-11-27'))).not.toThrow();
    for (const now of ['2026-11-20', '2026-11-21', '2026-11-30', '2027-03-01']) {
      expect(() => validateVercelBuildEnvironment(productionEnvironment(), {
        now: new Date(`${now}T03:00:00Z`), revisionSource: source('2026-11-20', '2026-11-27'),
      }), now).not.toThrow();
    }
  });

  it('fails when only one date is set or a date is malformed', () => {
    expect(() => validateLegalRevisionDates(source('2026-11-20', null))).toThrow(/null or both YYYY/);
    expect(() => validateLegalRevisionDates(source(null, '2026-11-27'))).toThrow(/null or both YYYY/);
    expect(() => validateLegalRevisionDates(source('2026-11-2', '2026-11-27'))).toThrow(/null or both YYYY/);
    expect(() => validateLegalRevisionDates(source('2026-02-30', '2026-11-27'))).toThrow(/null or both YYYY/);
    expect(() => validateLegalRevisionDates('{ not json')).toThrow(/not valid JSON/);
  });

  it('fails when the notice period is shorter than 7 days or precedes the first edition', () => {
    expect(() => validateLegalRevisionDates(source('2026-11-20', '2026-11-26'))).toThrow(/at least 7 days/);
    expect(() => validateLegalRevisionDates(source('2026-11-01', '2026-11-08'))).toThrow(/before the first edition/);
  });

  it('runs only for production builds and reads the real file by default', () => {
    expect(() => validateVercelBuildEnvironment(productionEnvironment(), { revisionSource: source('2026-11-20', '2026-11-26') }))
      .toThrow(/at least 7 days/);
    expect(() => validateVercelBuildEnvironment(baseEnvironment, { revisionSource: source('2026-11-20', '2026-11-26') })).not.toThrow();
    expect(validateVercelBuildEnvironment(productionEnvironment()).checked).toBe(true);
  });
});
