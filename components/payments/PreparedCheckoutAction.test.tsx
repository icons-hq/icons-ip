import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { PreparedCheckoutAction } from './PreparedCheckoutAction';

function checkout(action: PreparedCheckout['action']): PreparedCheckout {
  return {
    attemptId: '30000000-0000-4000-8000-000000000205',
    provider: 'korpay',
    action,
    callbackNonce: 'opaque-callback-nonce-205',
    expiresAt: '2099-08-13T10:10:00.000Z',
  };
}

describe('PreparedCheckoutAction', () => {
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

  it('client_sdk action은 adapter 전용 renderer가 없으면 결제를 시작하지 않는다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={checkout({
      kind: 'client_sdk',
      payload: { privateProviderShape: true },
    })} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('지원하지 않는 결제 준비 방식');
    expect(html).not.toContain('privateProviderShape');
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
