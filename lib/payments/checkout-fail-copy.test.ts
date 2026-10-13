import { describe, expect, it } from 'vitest';
import { paymentFailNoticeCopy } from './checkout-fail-copy';

describe('paymentFailNoticeCopy', () => {
  it('같은 주문으로 다시 준비할 수 있을 때만 재시도를 약속한다', () => {
    expect(paymentFailNoticeCopy('PAY_PROCESS_CANCELED', { sameOrderRetry: true }))
      .toBe('결제를 직접 취소하셨어요. 준비되면 같은 주문에서 다시 시도할 수 있어요.');
    expect(paymentFailNoticeCopy('PAY_PROCESS_CANCELED', { sameOrderRetry: false }))
      .toBe('결제를 직접 취소하셨어요.');
  });

  it('재시도 가능 여부를 모르면 약속하지 않는다', () => {
    expect(paymentFailNoticeCopy('REJECT_CARD_COMPANY')).toBe('카드사가 결제를 거절했어요.');
  });

  it('미지 코드는 provider 문자열 없이 공통 문구로 덮는다', () => {
    expect(paymentFailNoticeCopy('SOME_UNKNOWN_CODE', { sameOrderRetry: true }))
      .toBe('결제가 완료되지 않았어요. 같은 주문에서 다시 시도해주세요.');
    expect(paymentFailNoticeCopy('SOME_UNKNOWN_CODE')).not.toContain('SOME_UNKNOWN_CODE');
  });
});
