import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTossWidgetPaymentRequest,
  resolveTossPaymentMethodVariantKey,
  TossPaymentWidget,
} from './TossPaymentWidget';

vi.mock('@/lib/payments/toss', async () => await import('../../lib/payments/toss'));

const referenceId = '7ad4c967-3d48-44da-a665-64731ac33f62';
const requestBase = {
  customerEmail: 'fan@icons.gg',
  customerName: '아이콘즈 팬',
  orderId: referenceId,
  orderName: '메이플스토리 팝업 1회차',
  origin: 'https://icons.test',
};

describe('buildTossWidgetPaymentRequest', () => {
  it('keeps the existing order provider ID and checkout callbacks', () => {
    expect(buildTossWidgetPaymentRequest({
      ...requestBase,
      callbackBasePath: '/checkout',
      purpose: 'order',
    })).toMatchObject({
      orderId: `order_${referenceId}`,
      successUrl: `https://icons.test/checkout/success?ref=${referenceId}`,
      failUrl: `https://icons.test/checkout/fail?ref=${referenceId}`,
    });
  });

  it('builds a ticket provider ID with ticket checkout callbacks', () => {
    expect(buildTossWidgetPaymentRequest({
      ...requestBase,
      callbackBasePath: '/ticket-checkout',
      purpose: 'ticket',
    })).toMatchObject({
      orderId: `ticket_${referenceId}`,
      successUrl: `https://icons.test/ticket-checkout/success?ref=${referenceId}`,
      failUrl: `https://icons.test/ticket-checkout/fail?ref=${referenceId}`,
    });
  });
});

describe('resolveTossPaymentMethodVariantKey', () => {
  it('uses the review-only payment-method variant when configured', () => {
    expect(resolveTossPaymentMethodVariantKey('test_gck_example', ' ICONS_REVIEW '))
      .toBe('ICONS_REVIEW');
  });

  it('falls back to the provider default outside the review environment', () => {
    expect(resolveTossPaymentMethodVariantKey('test_gck_example', undefined)).toBe('DEFAULT');
    expect(resolveTossPaymentMethodVariantKey('live_gck_example', 'ICONS_REVIEW')).toBe('DEFAULT');
  });
});

describe('TossPaymentWidget', () => {
  type PaymentTarget =
    | { callbackBasePath: '/checkout'; purpose: 'order' }
    | { callbackBasePath: '/ticket-checkout'; purpose: 'ticket' };

  function render(target: PaymentTarget) {
    return renderToStaticMarkup(
      <TossPaymentWidget
        {...target}
        clientKey="test_gck_example"
        customerEmail="fan@icons.gg"
        customerKey="user-1"
        customerName="아이콘즈 팬"
        orderId={referenceId}
        orderName="메이플스토리 팝업 1회차"
        total={25000}
      />,
    );
  }

  it('preserves the order confirmation copy', () => {
    expect(render({ callbackBasePath: '/checkout', purpose: 'order' }))
      .toContain('주문은 ‘결제 확인 중’으로 표시됩니다.');
  });

  it('uses booking-specific confirmation copy for tickets', () => {
    expect(render({ callbackBasePath: '/ticket-checkout', purpose: 'ticket' }))
      .toContain('예매는 ‘결제 확인 중’으로 표시됩니다.');
  });
});
