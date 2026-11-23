import { describe, expect, it } from 'vitest';
import { adminPaymentCancelErrorLabel, adminPaymentCancelFailureMessage } from './payment-cancel-error';

describe('결제 취소 실패 안내', () => {
  it('영어 코드만 보여 주지 않고 환불 상태와 다음 행동을 말한다', () => {
    const message = adminPaymentCancelFailureMessage('provider_unavailable');
    expect(message).toContain('결제사 응답을 받지 못했습니다');
    expect(message).toContain('고객 환불이 끝났는지 아직 확인되지 않았고');
    expect(message).toContain('다시 눌러주세요');
    expect(message).toContain('provider_unavailable');
  });

  it('다시 눌러도 소용없는 코드는 담당자에게 넘기라고 한다', () => {
    expect(adminPaymentCancelFailureMessage('provider_merchant_mismatch')).toContain('결제 담당자에게 넘겨주세요');
  });

  it('모르는 코드도 빈 안내 없이 코드와 가이드 위치를 남긴다', () => {
    expect(adminPaymentCancelErrorLabel('something_new')).toBe('결제사 확인에 실패했습니다 (something_new)');
    expect(adminPaymentCancelFailureMessage('something_new')).toContain('가이드의 취소·반품·교환 관리');
  });

  /* 토스 가상계좌(ADR-0049) — 입금 뒤 환불은 고객 환불 계좌로만 나간다. 코드만 보이지 않고 다음 행동을 말한다. */
  it('가상계좌 환불·반납 코드를 운영자 말로 옮긴다', () => {
    const required = adminPaymentCancelFailureMessage('provider_refund_account_required');
    expect(required).toContain('환불 계좌가 없어');
    expect(required).toContain('주문 상세에서 환급 계좌를 입력하면');
    expect(required).toContain('토스페이먼츠 상점관리자에서 환불한 뒤');
    expect(required).toContain('provider_refund_account_required');
    for (const code of ['provider_refund_account_invalid', 'provider_refund_failed', 'provider_virtual_account_released', 'provider_deposit_expired',
      'provider_virtual_account_canceled', 'provider_virtual_account_release_pending', 'provider_deposit_window_out_of_range', 'provider_virtual_account_invalid']) {
      expect(adminPaymentCancelErrorLabel(code), code).not.toContain('결제사 확인에 실패했습니다');
    }
    expect(adminPaymentCancelFailureMessage('provider_virtual_account_invalid')).toContain('결제 담당자에게 넘겨주세요');
  });
});
