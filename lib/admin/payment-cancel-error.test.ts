import { describe, expect, it } from 'vitest';
import { adminPaymentCancelErrorCopy, adminPaymentCancelErrorLabel, adminPaymentCancelFailureMessage, splitAdminSupportCode, withAdminSupportCode } from './payment-cancel-error';

describe('결제 취소 실패 안내', () => {
  it('영어 코드만 보여 주지 않고 환불 상태와 다음 행동을 말한다', () => {
    const message = adminPaymentCancelFailureMessage('provider_unavailable');
    expect(message).toContain('결제사 응답을 받지 못했습니다');
    expect(message).toContain('고객 환불이 끝났는지 아직 확인되지 않았고');
    expect(message).toContain('다시 눌러주세요');
    expect(message).toContain('provider_unavailable');
  });

  /* L-12: 코드는 문장 끝 괄호에 섞지 않고 '문의할 때 알려 줄 코드'로 한 번만 붙인다. 화면은 그 코드를 떼어 작은 글로 그린다. */
  it('코드는 문장에 섞지 않고 끝에 한 번만 붙이고, 화면이 떼어 낼 수 있다', () => {
    const message = adminPaymentCancelFailureMessage('provider_unavailable');
    expect(message).not.toContain('(provider_unavailable)');
    expect(message.split('provider_unavailable')).toHaveLength(2);
    expect(message.endsWith(' 문의할 때 알려 줄 코드: provider_unavailable')).toBe(true);
    expect(splitAdminSupportCode(message)).toEqual({
      text: '결제 취소를 확정하지 못했습니다 — 결제사 응답을 받지 못했습니다. 고객 환불이 끝났는지 아직 확인되지 않았고, 주문과 재고는 그대로입니다. 잠시 뒤 [환불 완료 확정]을 다시 눌러주세요.',
      code: 'provider_unavailable',
    });
    expect(splitAdminSupportCode('환불 접수를 기록했습니다.')).toEqual({ text: '환불 접수를 기록했습니다.', code: null });
    expect(splitAdminSupportCode(withAdminSupportCode('취소는 승인했습니다.', 'local_finalize_failed'))).toEqual({ text: '취소는 승인했습니다.', code: 'local_finalize_failed' });
    expect(adminPaymentCancelErrorLabel('provider_unavailable')).toBe('결제사 응답을 받지 못했습니다 · 문의할 때 알려 줄 코드: provider_unavailable');
  });

  it('결제사가 거절하거나 실패한 취소는 누구에게 무엇을 알리고 무엇을 다시 누르는지 말한다', () => {
    for (const code of ['provider_cancel_rejected', 'provider_cancel_failed']) {
      const { next } = adminPaymentCancelErrorCopy(code);
      expect(next, code).toContain('결제 담당자에게 요청번호와 코드를 알려');
      expect(next, code).toContain('[환불 완료 확정]을 다시');
    }
  });

  it('다시 눌러도 소용없는 코드는 담당자에게 넘기라고 한다', () => {
    expect(adminPaymentCancelFailureMessage('provider_merchant_mismatch')).toContain('결제 담당자에게 넘겨주세요');
  });

  it('모르는 코드는 가이드를 찾아보라고 하지 않고 지금 할 일과 코드를 남긴다', () => {
    expect(adminPaymentCancelErrorLabel('something_new')).toBe('결제사 확인에 실패했습니다 · 문의할 때 알려 줄 코드: something_new');
    const message = adminPaymentCancelFailureMessage('something_new');
    expect(message).toContain('[환불 완료 확정]을 한 번 더 눌러주세요. 같은 안내가 다시 나오면 결제 담당자에게 요청번호와 코드를 알려주세요.');
    expect(message).not.toContain('가이드');
    expect(splitAdminSupportCode(message).code).toBe('something_new');
  });

  /* 토스 가상계좌(ADR-0049) — 입금 뒤 환불은 고객 환불 계좌로만 나간다. 코드만 보이지 않고 다음 행동을 말한다. */
  it('가상계좌 환불·반납 코드를 운영자 말로 옮긴다', () => {
    const required = adminPaymentCancelFailureMessage('provider_refund_account_required');
    expect(required).toContain('환불 계좌가 없어');
    expect(required).toContain('주문 상세에서 환불 계좌를 입력하면');
    expect(required).toContain('토스페이먼츠 상점관리자에서 환불한 뒤');
    // 2026-11-25: 고객에게 알림·메일이 자동으로 가고, 운영자가 받은 계좌를 대신 입력할 수 있다(VAC-041·VAC-042).
    expect(required).toContain('앱 알림과 메일');
    expect(required).toContain('대신 입력');
    expect(adminPaymentCancelFailureMessage('provider_refund_account_invalid')).toContain('대신 입력');
    expect(required).toContain('provider_refund_account_required');
    for (const code of ['provider_refund_account_invalid', 'provider_refund_failed', 'provider_virtual_account_released', 'provider_deposit_expired',
      'provider_virtual_account_canceled', 'provider_virtual_account_release_pending', 'provider_deposit_window_out_of_range', 'provider_virtual_account_invalid']) {
      expect(adminPaymentCancelErrorLabel(code), code).not.toContain('결제사 확인에 실패했습니다');
    }
    expect(adminPaymentCancelFailureMessage('provider_virtual_account_invalid')).toContain('결제 담당자에게 넘겨주세요');
  });
});
