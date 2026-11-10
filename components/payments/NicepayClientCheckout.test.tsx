import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { PreparedCheckoutAction } from './PreparedCheckoutAction';
import { parseNicepayPayload } from './NicepayClientCheckout';

// 형식만 맞춘 가짜 결제창 payload다.
function nicepayPayload(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'nicepay',
    GoodsName: 'ICONS 굿즈 주문',
    Amt: '31000',
    MID: 'iconst000m',
    EdiDate: '20261106101000',
    Moid: 'O30000000000040008000000000000611',
    SignData: 'b'.repeat(64),
    PayMethod: 'CARD',
    ReturnURL: 'https://iconsip.com/api/payments/goods/confirm/nicepay',
    ReqReserved: 'opaque-callback-nonce-611',
    CharSet: 'utf-8',
    ...overrides,
  };
}

function prepared(payload: unknown): PreparedCheckout {
  return {
    attemptId: '30000000-0000-4000-8000-000000000611',
    provider: 'nicepay',
    action: { kind: 'client_sdk', payload: payload as Record<string, string> },
    callbackNonce: 'opaque-callback-nonce-611',
    expiresAt: '2099-11-06T01:20:00.000Z',
  };
}

describe('NicepayClientCheckout', () => {
  it('nicepay provider면 EUC-KR 결제 폼을 confirm 라우트로 그리고 provider 분기값은 폼에 싣지 않는다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={prepared(nicepayPayload())} />);

    expect(html).toContain('accept-charset="euc-kr"');
    expect(html).toContain('action="https://iconsip.com/api/payments/goods/confirm/nicepay"');
    expect(html).toContain('name="payForm"');
    expect(html).toContain('name="SignData"');
    expect(html).toContain('<input type="hidden" name="ReqReserved" value="opaque-callback-nonce-611"/>');
    expect(html).not.toContain('name="provider"');
    expect(html).toContain('결제하기');
    expect(html).not.toContain('toss-payment-methods');
  });

  it('서버 어댑터 payload와 정확히 같은 모양만 받는다', () => {
    expect(parseNicepayPayload(nicepayPayload())).toMatchObject({ MID: 'iconst000m', PayMethod: 'CARD' });
    for (const overrides of [
      { extra: 'field' },
      { provider: 'korpay' },
      { Amt: 31000 },
      { Amt: '999' },
      { PayMethod: 'VBANK' },
      { ReturnURL: 'javascript:alert(1)' },
      { ReturnURL: 'http://iconsip.com/api/payments/goods/confirm/nicepay' },
      { ReturnURL: 'https://iconsip.com/api/payments/goods/confirm' },
      { SignData: 'not-a-hash' },
      { Moid: 'T30000000000040008000000000000611' },
      { CharSet: 'euc-kr' },
      { EdiDate: '20261306101000' },
    ]) {
      expect(parseNicepayPayload(nicepayPayload(overrides))).toBeNull();
    }
  });

  it('형식 밖 payload는 필드값을 렌더링하지 않고 오류 문구만 보인다', () => {
    const html = renderToStaticMarkup(<PreparedCheckoutAction prepared={prepared({ privateProviderShape: true })} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('결제 준비 정보를 확인하지 못했습니다.');
    expect(html).not.toContain('privateProviderShape');
    expect(html).not.toContain('<form');
  });
});
