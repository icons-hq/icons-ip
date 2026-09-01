import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt } from './gateway';
import {
  PaymentGatewayUnavailableError,
  getPaymentGateway,
  newPaymentCheckoutEnabled,
  paymentProviderConfigured,
} from './runtime-gateway';

const tossAttempt: PaymentAttempt = {
  id: '30000000-0000-4000-8000-000000000388',
  provider: 'toss',
  purpose: 'order',
  refId: '20000000-0000-4000-8000-000000000388',
  amount: 31_000,
  currency: 'KRW',
  idempotencyKey: 'goods:20000000-0000-4000-8000-000000000388',
  providerOrderId: 'O30000000000040008000000000000388',
  providerProductCode: 'P30000000000040008000000000000388',
  expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
};

const korpayAttempt: PaymentAttempt = {
  ...tossAttempt,
  provider: 'korpay',
  providerOrderId: 'O30000000000040008000000000000205',
  providerProductCode: 'P30000000000040008000000000000205',
};

const CANARY_USER_ID = '10000000-0000-4000-8000-000000000207';

function configureToss(siteUrl = 'https://iconsip.com') {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_iconsdocs00000000000001');
  vi.stubEnv('TOSS_SECRET_KEY', 'test_gsk_iconsdocs00000000000001');
  vi.stubEnv('SITE_URL', siteUrl);
}

function configureKorpay(siteUrl = 'https://iconsip.com') {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('KORPAY_MID', 'test12345m');
  vi.stubEnv('KORPAY_KEY', 'c2VydmVyLW9ubHkta29ycGF5LWtleS0yMDc=');
  vi.stubEnv('SITE_URL', siteUrl);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('payment runtime gateway', () => {
  it('자격 증명이 없거나 일부만 있으면 기본 provider(toss)는 fail closed한다', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_iconsdocs00000000000001');

    expect(paymentProviderConfigured()).toBe(false);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    await expect(getPaymentGateway().prepare(tossAttempt))
      .rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
  });

  it('테스트/라이브 키 모드가 어긋난 페어는 configured로 인정하지 않는다', () => {
    configureToss();
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_iconsdocs00000000000001');
    expect(paymentProviderConfigured()).toBe(false);
  });

  it('구 API 개별연동 키 형식(sk_)은 위젯 키로 인정하지 않는다', () => {
    configureToss();
    vi.stubEnv('TOSS_SECRET_KEY', 'test_sk_legacyapikey000000000001');
    expect(paymentProviderConfigured()).toBe(false);
  });

  it('유효한 Production server config로 toss adapter를 구성하되 목적 gate는 기본 OFF다', async () => {
    configureToss();

    expect(paymentProviderConfigured()).toBe(true);
    expect(paymentProviderConfigured('toss')).toBe(true);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    expect(newPaymentCheckoutEnabled('ticket')).toBe(false);
    await expect(getPaymentGateway().prepare(tossAttempt)).resolves.toMatchObject({
      provider: 'toss',
      action: { kind: 'client_sdk' },
    });
  });

  it('실자격 증명이 잘못 놓여도 Production 밖에서는 live adapter를 열지 않는다', async () => {
    configureToss();
    vi.stubEnv('VERCEL_ENV', 'preview');

    expect(paymentProviderConfigured()).toBe(false);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    await expect(getPaymentGateway().prepare(tossAttempt))
      .rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
  });

  it('order와 ticket public rollout gate는 exact true에서만 독립적으로 열린다', () => {
    configureToss();
    vi.stubEnv('TOSS_ORDER_CHECKOUT_ENABLED', 'true');
    vi.stubEnv('TOSS_TICKET_CHECKOUT_ENABLED', 'TRUE');

    expect(newPaymentCheckoutEnabled('order')).toBe(true);
    expect(newPaymentCheckoutEnabled('ticket')).toBe(false);
  });

  it('public gate OFF에서도 목적별 단일 canary user만 통과시킨다', () => {
    configureToss();
    vi.stubEnv('TOSS_ORDER_CANARY_USER_ID', CANARY_USER_ID);
    vi.stubEnv('TOSS_TICKET_CANARY_USER_ID', 'not-a-uuid');

    expect(newPaymentCheckoutEnabled('order', CANARY_USER_ID)).toBe(true);
    expect(newPaymentCheckoutEnabled('order', '10000000-0000-4000-8000-000000000208')).toBe(false);
    expect(newPaymentCheckoutEnabled('order')).toBe(false);
    expect(newPaymentCheckoutEnabled('ticket', 'not-a-uuid')).toBe(false);
  });

  it('provider별 gate와 자격 증명은 서로 새지 않는다', () => {
    // toss 자격 증명 + korpay gate 'true' — korpay는 자격 증명이 없으니 닫힘.
    configureToss();
    vi.stubEnv('KORPAY_ORDER_CHECKOUT_ENABLED', 'true');
    expect(newPaymentCheckoutEnabled('order', undefined, 'korpay')).toBe(false);
    // toss gate 'true'는 korpay 경로를 열지 않는다.
    vi.stubEnv('TOSS_ORDER_CHECKOUT_ENABLED', 'true');
    expect(newPaymentCheckoutEnabled('order', undefined, 'korpay')).toBe(false);
    expect(newPaymentCheckoutEnabled('order', undefined, 'toss')).toBe(true);
  });

  it('korpay는 명시 인자로 여전히 구성·개방된다(콜백 drain·판매 제한 분기 경로)', async () => {
    configureKorpay();
    vi.stubEnv('KORPAY_ORDER_CHECKOUT_ENABLED', 'true');

    expect(paymentProviderConfigured('korpay')).toBe(true);
    expect(paymentProviderConfigured('toss')).toBe(false);
    expect(newPaymentCheckoutEnabled('order', undefined, 'korpay')).toBe(true);
    await expect(getPaymentGateway('korpay').prepare(korpayAttempt)).resolves.toMatchObject({
      provider: 'korpay',
      action: { kind: 'client_sdk' },
    });
    // 기본(toss) 게이트웨이는 korpay 자격 증명만으로 열리지 않는다.
    await expect(getPaymentGateway().prepare(tossAttempt))
      .rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
  });

  it('Production은 canonical origin과 UUID v1-5만 build guard와 동일하게 허용한다', () => {
    configureToss('https://iconsip.com?redirect=evil');
    expect(paymentProviderConfigured()).toBe(false);

    configureToss('https://iconsip.com');
    vi.stubEnv('TOSS_ORDER_CANARY_USER_ID', '10000000-0000-7000-8000-000000000207');
    expect(paymentProviderConfigured()).toBe(true);
    expect(newPaymentCheckoutEnabled('order', '10000000-0000-7000-8000-000000000207')).toBe(false);
  });
});
