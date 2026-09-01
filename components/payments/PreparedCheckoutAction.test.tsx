import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { PreparedCheckoutAction } from './PreparedCheckoutAction';
import {
  KORPAY_SDK_BASE_URL,
  launchKorpayPayment,
} from './KorpayClientCheckout';

const payment = vi.hoisted(() => vi.fn());
const loadTossPayments = vi.hoisted(() => vi.fn());

vi.mock('@korpay/sdk', () => ({
  default: { payment },
}));

vi.mock('@tosspayments/tosspayments-sdk', () => ({
  ANONYMOUS: '@@ANONYMOUS',
  loadTossPayments,
}));

function checkout(
  action: PreparedCheckout['action'],
  provider: PreparedCheckout['provider'] = 'korpay',
): PreparedCheckout {
  return {
    attemptId: '30000000-0000-4000-8000-000000000205',
    provider,
    action,
    callbackNonce: 'opaque-callback-nonce-205',
    expiresAt: '2099-08-13T10:10:00.000Z',
  };
}

function tossPayload() {
  return {
    provider: 'toss',
    clientKey: 'test_gck_iconsdocs00000000000001',
    customerKey: 'ANONYMOUS',
    orderId: 'O0123456789abcdef0123456789abcdef',
    orderName: 'ICONS 굿즈 주문',
    amount: 31000,
    currency: 'KRW',
    successUrl: 'https://iconsip.com/api/payments/goods/confirm/toss/opaque-callback-nonce-205',
    failUrl: 'https://iconsip.com/checkout',
  } as const;
}

function korpayPayload() {
  return {
    merchantId: 'test12345m',
    productName: 'P30000000000040008000000000000205',
    orderNumber: 'O30000000000040008000000000000205',
    amount: 31000,
    payMethod: 'card',
    returnUrl: 'https://iconsip.com/api/payments/goods/confirm',
    ediDate: '20260814121530',
    hashKey: 'a'.repeat(64),
    reserved: 'opaque-callback-nonce-205',
    language: 'ko',
  } as const;
}

describe('PreparedCheckoutAction', () => {
  beforeEach(() => {
    payment.mockReset();
    loadTossPayments.mockReset();
  });

  it('form_post action을 provider URL과 숨은 필드로 제출한다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'form_post',
      url: 'https://payments.example.test/authenticate',
      fields: { orderNumber: 'O205', amount: '31000' },
    })} />);

    expect(html).toContain('method="post"');
    expect(html).toContain('action="https://payments.example.test/authenticate"');
    expect(html).toContain('name="orderNumber"');
    expect(html).toContain('value="O205"');
    expect(html).toContain('name="amount"');
    expect(html).toContain('value="31000"');
  });

  it('redirect action은 안전한 anchor로 외부 URL을 연다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'redirect',
      url: 'https://payments.example.test/redirect',
    })} />);

    expect(html).toContain('href="https://payments.example.test/redirect"');
    expect(html).toContain('결제 계속하기');
  });

  it('client_sdk action은 결제를 자동 시작하지 않고 명시적 버튼만 렌더링한다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'client_sdk',
      payload: korpayPayload(),
    })} />);

    expect(html).toContain('type="button"');
    expect(html).toContain('결제하기');
    expect(html).not.toContain('test12345m');
    expect(html).not.toContain('hashKey');
    expect(payment).not.toHaveBeenCalled();
  });

  it('provider가 toss인 client_sdk action은 주문서형 위젯 컨테이너를 렌더링한다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'client_sdk',
      payload: tossPayload(),
    }, 'toss')} />);

    expect(html).toContain('id="toss-payment-methods"');
    expect(html).toContain('id="toss-agreement"');
    expect(html).toContain('type="button"');
    expect(html).toContain('결제하기');
    // 클라이언트 키는 SDK 인자로만 쓰이고 마크업으로 새지 않는다.
    expect(html).not.toContain('test_gck_');
    expect(loadTossPayments).not.toHaveBeenCalled();
    expect(payment).not.toHaveBeenCalled();
  });

  it('provider가 korpay인 client_sdk action은 토스 위젯을 렌더링하지 않는다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'client_sdk',
      payload: korpayPayload(),
    })} />);

    expect(html).not.toContain('toss-payment-methods');
    expect(html).not.toContain('toss-agreement');
    expect(html).toContain('결제하기');
    expect(loadTossPayments).not.toHaveBeenCalled();
  });

  it('client_sdk를 지원하지 않는 provider는 SDK를 고르지 않고 오류 문구만 렌더링한다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'client_sdk',
      payload: tossPayload(),
    }, 'bank_transfer')} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('지원하지 않는 결제 준비 방식입니다.');
    expect(html).not.toContain('toss-payment-methods');
    expect(html).not.toContain('test_gck_');
    expect(loadTossPayments).not.toHaveBeenCalled();
    expect(payment).not.toHaveBeenCalled();
  });

  it('client_sdk action은 엄격한 Korpay payload가 아니면 필드값을 렌더링하지 않는다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'client_sdk',
      payload: { privateProviderShape: true },
    })} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('결제 준비 정보를 확인하지 못했습니다.');
    expect(html).not.toContain('privateProviderShape');
    expect(payment).not.toHaveBeenCalled();
  });

  it('HTTPS 또는 local HTTP가 아닌 provider 주소는 form field까지 렌더링하지 않는다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'form_post',
      url: 'javascript:alert(1)',
      fields: { mustNotLeak: 'provider-field' },
    })} />);

    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('mustNotLeak');
    expect(html).not.toContain('provider-field');
  });
});

describe('launchKorpayPayment', () => {
  beforeEach(() => {
    payment.mockReset();
  });

  it('고정된 production SDK base URL과 검증된 payload로만 SDK를 시작한다', () => {
    const onStarted = vi.fn();
    const onFailed = vi.fn();
    const onClosed = vi.fn();

    expect(launchKorpayPayment(korpayPayload(), {
      onStarted,
      onFailed,
      onClosed,
    })).toBe(true);

    expect(payment).toHaveBeenCalledOnce();
    expect(payment).toHaveBeenCalledWith(
      KORPAY_SDK_BASE_URL,
      korpayPayload(),
      expect.objectContaining({
        onStart: expect.any(Function),
        onError: expect.any(Function),
        onClose: expect.any(Function),
      }),
    );
    expect(KORPAY_SDK_BASE_URL).toBe('https://payments.korpay.com/v1');
  });

  it.each([
    ['알 수 없는 필드', { ...korpayPayload(), privateProviderShape: true }],
    ['중첩 객체', { ...korpayPayload(), card: { direct: true } }],
    ['비 HTTPS return URL', { ...korpayPayload(), returnUrl: 'javascript:alert(1)' }],
    ['잘못된 hash', { ...korpayPayload(), hashKey: 'not-a-hash' }],
    ['예약 nonce 누락', { ...korpayPayload(), reserved: '' }],
  ])('%s payload는 SDK에 전달하지 않는다', (_label, payload) => {
    const onFailed = vi.fn();

    expect(launchKorpayPayment(payload, { onFailed })).toBe(false);
    expect(payment).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onFailed).toHaveBeenCalledWith();
  });

  it('provider 원문 오류를 UI callback에 전달하지 않는다', () => {
    const onFailed = vi.fn();
    launchKorpayPayment(korpayPayload(), { onFailed });
    const callbacks = payment.mock.calls[0]?.[2] as { onError?: (error: string) => void };

    callbacks.onError?.('provider raw error with sensitive values');

    expect(onFailed).toHaveBeenCalledOnce();
    expect(onFailed).toHaveBeenCalledWith();
  });

  it('SDK의 동기 예외도 일반 실패로만 변환한다', () => {
    payment.mockImplementationOnce(() => {
      throw new Error('provider raw synchronous error');
    });
    const onFailed = vi.fn();

    expect(launchKorpayPayment(korpayPayload(), { onFailed })).toBe(false);
    expect(onFailed).toHaveBeenCalledOnce();
    expect(onFailed).toHaveBeenCalledWith();
  });
});
