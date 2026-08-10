import { describe, expect, it } from 'vitest';
import { LEGAL_WITHDRAWAL_NOTICE } from '../orders';
import { renderOrderConfirmationEmail, renderOrderShippedEmail } from './templates';

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const address = {
  recipientName: '박상우',
  phone: '01012345678',
  postalCode: '04524',
  address1: '서울시 중구 세종대로 110',
  address2: '3층',
};

function confirmationInput(overrides: Partial<Parameters<typeof renderOrderConfirmationEmail>[0]> = {}) {
  return {
    orderId: ORDER_ID,
    orderedAt: '2026-08-07T02:30:00.000Z',
    items: [
      { name: '홍실 아크릴 블록', qty: 2, unitPrice: 12_000 },
      { name: '오로라 아크릴 키링', qty: 1, unitPrice: 9_000 },
    ],
    itemsSubtotal: 33_000,
    shippingFee: 3_000,
    total: 36_000,
    address,
    orderUrl: `https://iconsip.com/orders/${ORDER_ID}`,
    ...overrides,
  };
}

function shippedInput(overrides: Partial<Parameters<typeof renderOrderShippedEmail>[0]> = {}) {
  return {
    orderId: ORDER_ID,
    items: [{ name: '홍실 아크릴 블록', qty: 1, unitPrice: 12_000 }],
    address,
    carrierName: null,
    trackingNumber: null,
    trackingUrl: null,
    orderUrl: `https://iconsip.com/orders/${ORDER_ID}`,
    ...overrides,
  };
}

describe('renderOrderConfirmationEmail', () => {
  it('제목과 본문에 주문번호 뒤 8자리를 넣는다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput());

    expect(email.subject).toContain('1F2A3B4C');
    expect(email.subject).not.toContain(ORDER_ID);
    expect(email.text).toContain('1F2A3B4C');
    expect(email.html).toContain('1F2A3B4C');
  });

  it('굿즈 내역과 배송비 포함 결제 금액을 모두 적는다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput());

    for (const surface of [email.text, email.html]) {
      expect(surface).toContain('홍실 아크릴 블록');
      expect(surface).toContain('오로라 아크릴 키링');
      expect(surface).toContain('₩33,000');
      expect(surface).toContain('₩3,000');
      expect(surface).toContain('₩36,000');
    }
  });

  it('배송비가 0이면 무료로 표기한다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput({
      itemsSubtotal: 33_000,
      shippingFee: 0,
      total: 33_000,
    }));

    expect(email.text).toContain('무료');
    expect(email.html).toContain('무료');
  });

  it('배송지를 적고 주소가 없으면 대체 문구를 넣는다', () => {
    const withAddress = renderOrderConfirmationEmail(confirmationInput());
    expect(withAddress.text).toContain('서울시 중구 세종대로 110');
    expect(withAddress.text).toContain('04524');
    expect(withAddress.text).toContain('박상우');

    const withoutAddress = renderOrderConfirmationEmail(confirmationInput({ address: null }));
    expect(withoutAddress.text).toContain('배송지 정보를 확인할 수 없습니다');
    expect(withoutAddress.html).toContain('배송지 정보를 확인할 수 없습니다');
  });

  it('전자상거래법 청약철회 고지를 인앱과 같은 문구로 넣는다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput());

    expect(email.text).toContain(LEGAL_WITHDRAWAL_NOTICE);
    expect(email.html).toContain(LEGAL_WITHDRAWAL_NOTICE);
  });

  it('굿즈 이름의 HTML 특수문자를 이스케이프한다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput({
      items: [{ name: '<script>alert(1)</script>', qty: 1, unitPrice: 1_000 }],
    }));

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('메일 클라이언트 호환을 위해 table 레이아웃과 인라인 스타일만 쓴다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput());

    expect(email.html).toContain('<table');
    expect(email.html).not.toContain('<style');
    expect(email.html).not.toContain('class=');
    expect(email.html).not.toContain('position:');
    expect(email.html).not.toContain('<script');
  });

  it('본문 링크는 전달받은 주문 상세 URL만 쓴다', () => {
    const email = renderOrderConfirmationEmail(confirmationInput());

    expect(email.html).toContain(`href="https://iconsip.com/orders/${ORDER_ID}"`);
    expect(email.text).toContain(`https://iconsip.com/orders/${ORDER_ID}`);
  });
});

describe('renderOrderShippedEmail', () => {
  it('택배사·운송장번호·조회 링크를 넣는다', () => {
    const email = renderOrderShippedEmail(shippedInput({
      carrierName: '한진택배',
      trackingNumber: '123456789012',
      trackingUrl: 'https://www.hanjin.com/tracking?number=123456789012',
    }));

    expect(email.subject).toContain('1F2A3B4C');
    for (const surface of [email.text, email.html]) {
      expect(surface).toContain('한진택배');
      expect(surface).toContain('123456789012');
      expect(surface).toContain('https://www.hanjin.com/tracking?number=123456789012');
    }
  });

  // CONTEXT.md는 canonical을 "운송장"으로 못박고 "송장"을 Avoid로 둔다.
  // 한 통의 메일 안에서 용어가 갈리지 않게 라벨을 고정한다.
  it('운송장 용어를 본문 전체에서 하나로 쓴다', () => {
    const email = renderOrderShippedEmail(shippedInput({
      carrierName: '한진택배',
      trackingNumber: '123456789012',
    }));

    for (const surface of [email.text, email.html]) {
      expect(surface).toContain('운송장번호');
      expect(surface).not.toContain('송장번호를');
      expect(surface.replaceAll('운송장', '')).not.toContain('송장');
    }
  });

  it('운송장 정보가 아직 없으면 배송 시작만 알리고 조회 안내를 대체한다', () => {
    const email = renderOrderShippedEmail(shippedInput());

    expect(email.text).toContain('운송장 정보가 등록되면');
    expect(email.html).toContain('운송장 정보가 등록되면');
    expect(email.html).not.toContain('undefined');
    expect(email.html).not.toContain('null');
  });

  it('추적 링크가 http(s)가 아니면 링크로 만들지 않는다', () => {
    const email = renderOrderShippedEmail(shippedInput({
      carrierName: '한진택배',
      trackingNumber: '123456789012',
      trackingUrl: 'javascript:alert(1)',
    }));

    expect(email.html).not.toContain('javascript:');
    expect(email.text).not.toContain('javascript:');
  });
});
