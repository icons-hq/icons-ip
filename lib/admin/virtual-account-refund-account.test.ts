import { describe, expect, it } from 'vitest';
import {
  adminVirtualAccountPartialCancelHint,
  normalizeAdminRefundAccountEntry,
  showsVirtualAccountRefundAccountEntry,
  VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS,
  virtualAccountRefundAccountEntryMessage,
} from './virtual-account-refund-account';

const CLAIM_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const entry = {
  claimId: CLAIM_ID, orderId: ORDER_ID, claimType: 'cancel', operationId: OPERATION_ID,
  bankName: '신한은행', accountNumber: '110-987-654321', accountHolder: ' 김엑스 ', reason: '11/26 고객 전화로 계좌 확인',
};

/* 운영자의 가상계좌 환급 계좌 대신 입력(2026-11-25, VAC-041·VAC-042). 판정은 DB가 하고, 화면은 형식만 거른다. */
describe('가상계좌 환급 계좌 대신 입력', () => {
  it('계좌 때문에 멈춘 결제확인필요에만 입력 칸을 보인다', () => {
    expect(showsVirtualAccountRefundAccountEntry('provider_refund_account_required')).toBe(true);
    expect(showsVirtualAccountRefundAccountEntry('provider_refund_account_invalid')).toBe(true);
    // 결과 불명 등은 결제사가 이미 앞 계좌로 환불했을 수 있어 계좌를 바꾸지 않는다(DB도 막는다).
    expect(showsVirtualAccountRefundAccountEntry('provider_unavailable')).toBe(false);
    expect(showsVirtualAccountRefundAccountEntry(null)).toBe(false);
  });

  it('입력을 좁힌다 — 앞뒤 공백을 지우고, 형식 밖이면 DB에 닿기 전에 거른다', () => {
    expect(normalizeAdminRefundAccountEntry(entry)).toEqual({ ...entry, accountHolder: '김엑스' });
    expect(normalizeAdminRefundAccountEntry({ ...entry, claimType: 'exchange' })).toBeNull();
    expect(normalizeAdminRefundAccountEntry({ ...entry, accountNumber: '110-98' })).toBeNull();
    expect(normalizeAdminRefundAccountEntry({ ...entry, accountNumber: '---------' })).toBeNull();
    expect(normalizeAdminRefundAccountEntry({ ...entry, reason: '확' })).toBeNull();
    expect(normalizeAdminRefundAccountEntry({ ...entry, accountHolder: '' })).toBeNull();
    expect(normalizeAdminRefundAccountEntry({ ...entry, operationId: 'not-uuid' })).toBeNull();
    expect(normalizeAdminRefundAccountEntry(null)).toBeNull();
  });

  it('저장 뒤 안내는 기존 재시도 규칙을 따른다 — 취소는 시스템 재시도, 반품은 운영자 버튼', () => {
    expect(virtualAccountRefundAccountEntryMessage('cancel', 'started')).toContain('환불을 다시 요청했습니다');
    expect(virtualAccountRefundAccountEntryMessage('return', 'operator_required')).toContain('[환불 완료 확정]');
    expect(virtualAccountRefundAccountEntryMessage('cancel', 'failed')).toContain('[상태 다시 확인]');
    expect(virtualAccountRefundAccountEntryMessage('cancel', 'account_invalid')).toContain('다시 확인해 입력');
  });

  it('DB 거절마다 고칠 방법을 말한다', () => {
    for (const code of ['invalid_virtual_account_refund_account', 'refund_account_refund_in_progress', 'refund_account_finance_started',
      'refund_account_not_virtual_account', 'refund_account_gift_order', 'invalid_refund_account_reason', 'operator_capability_required']) {
      expect(VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS[code], code).toBeTruthy();
    }
  });
});

/* 가상계좌 칸의 부분 취소 안내(2026-11-25) — 판정은 DB, 화면은 에스크로 근거로 안내만 고른다. */
describe('가상계좌 부분 취소 안내', () => {
  it('에스크로가 아님이 확인된 결제만 부분 취소·부분 반품을 안내한다', () => {
    expect(adminVirtualAccountPartialCancelHint({ useEscrow: false, escrow: null })).toContain('부분 취소·부분 반품·반품배송비 차감도 할 수 있습니다');
    // 선택 기록이 없어도 작업자가 결제 조회로 에스크로가 아님을 확인했으면(건너뜀·거래 상태 없음) 열린다.
    expect(adminVirtualAccountPartialCancelHint({ useEscrow: null, escrow: { deliveryState: 'skipped', escrowStatus: null } }))
      .toContain('부분 취소·부분 반품');
    expect(adminVirtualAccountPartialCancelHint({ useEscrow: true, escrow: null })).toContain('주문 전체로만 취소·반품');
    expect(adminVirtualAccountPartialCancelHint({ useEscrow: null, escrow: { deliveryState: 'waiting', escrowStatus: null } }))
      .toContain('확인하기 전에는 주문 전체로만');
    expect(adminVirtualAccountPartialCancelHint({ useEscrow: null, escrow: { deliveryState: 'skipped', escrowStatus: 'CONFIRMED' } }))
      .toContain('주문 전체로만');
  });
});
