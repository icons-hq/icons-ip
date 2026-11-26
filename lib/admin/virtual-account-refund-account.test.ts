import { describe, expect, it } from 'vitest';
import {
  ADMIN_REFUND_ACCOUNT_NUMBER_RULE,
  adminRefundAccountEntryProblem,
  adminVirtualAccountPartialCancelHint,
  normalizeAdminRefundAccountEntry,
  showsVirtualAccountRefundAccountEntry,
  VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS,
  VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS,
  virtualAccountRefundAccountEntryConfirm,
  virtualAccountRefundAccountEntryMessage,
} from './virtual-account-refund-account';

const CLAIM_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const entry = {
  claimId: CLAIM_ID, orderId: ORDER_ID, claimType: 'cancel', operationId: OPERATION_ID,
  bankName: '신한은행', accountNumber: '000-000-123456', accountHolder: ' 김엑스 ', reason: '11/26 고객 전화로 계좌 확인',
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
    expect(normalizeAdminRefundAccountEntry({ ...entry, accountNumber: '000-12' })).toBeNull();
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
    /* 반품은 저장만으로 환불되지 않는다고 말하고, 화면 낱말 '요청 상세'를 쓴다(D-37). */
    expect(virtualAccountRefundAccountEntryMessage('return', 'operator_required')).toContain('아직 환불하지 않았습니다. 요청 상세의 [환불 완료 확정]');
    for (const retry of ['started', 'operator_required', 'account_missing', 'account_invalid', 'not_applicable', 'failed'] as const) {
      for (const claimType of ['cancel', 'return'] as const) {
        const message = virtualAccountRefundAccountEntryMessage(claimType, retry);
        expect(message, `${claimType}:${retry}`).not.toMatch(/클레임|결제대행사|시스템이/);
      }
    }
  });

  /* D-35: 칸 아래 안내·오류 문구·입력 검사가 한 규칙을 말한다. 안내대로 적으면 형식(8~30자)과 결제사 판정(숫자 6~20자리)을 모두 지난다. */
  it('계좌번호 안내는 하나이고, 안내대로 적은 값은 저장 전 검사를 지난다', () => {
    expect(ADMIN_REFUND_ACCOUNT_NUMBER_RULE).toBe('숫자 8~20자리. 하이픈(-)은 넣어도 됩니다.');
    for (const code of ['invalid_entry', 'invalid_claim_refund_account', 'invalid_virtual_account_refund_account']) {
      expect(VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS[code], code).toContain(ADMIN_REFUND_ACCOUNT_NUMBER_RULE);
      expect(VIRTUAL_ACCOUNT_REFUND_ACCOUNT_ENTRY_ERRORS[code], code).not.toMatch(/6~20|8~30/);
    }
    for (const accountNumber of ['00000000', '0'.repeat(20), '000-000-123456', '0000-0000-0000-0000-0000']) {
      expect(adminRefundAccountEntryProblem({ ...entry, accountNumber }), accountNumber).toBeNull();
      expect(normalizeAdminRefundAccountEntry({ ...entry, accountNumber }), accountNumber).not.toBeNull();
    }
    /* 형식은 맞아도 결제사가 받지 않는 자릿수(숫자 21자리 이상·5자리 이하)는 저장 전에 알린다. */
    for (const accountNumber of ['0000000', '0'.repeat(21), '00-00-0--', '--------', '0000 0000', '']) {
      expect(adminRefundAccountEntryProblem({ ...entry, accountNumber }), accountNumber).toContain(`계좌번호를 다시 확인해주세요. ${ADMIN_REFUND_ACCOUNT_NUMBER_RULE}`);
    }
  });

  it('저장 전 검사는 어느 칸을 고칠지 말한다', () => {
    expect(adminRefundAccountEntryProblem(entry)).toBeNull();
    expect(adminRefundAccountEntryProblem({ ...entry, bankName: '' })).toBe('은행을 목록에서 골라 주세요.');
    expect(adminRefundAccountEntryProblem({ ...entry, accountHolder: '  ' })).toBe('예금주를 40자 안으로 적어 주세요.');
    expect(adminRefundAccountEntryProblem({ ...entry, reason: '확' })).toContain('입력 사유를 2자 이상 200자 이하로');
    expect(adminRefundAccountEntryProblem(null)).toBe('은행을 목록에서 골라 주세요.');
  });

  /* D-34: 취소는 저장이 곧 그 계좌로 가는 환불 요청이다 — 적은 계좌를 가리지 않고 되읽는다. */
  it('취소 건 확인창은 계좌를 전부 되읽고, 저장하면 바로 환불을 다시 요청한다고 말한다', () => {
    const asked = virtualAccountRefundAccountEntryConfirm({ claimType: 'cancel', bankName: '신한은행', accountNumber: ' 000-000-123456 ', accountHolder: ' 김엑스 ', refundAmount: 31000 });
    expect(asked).toMatchObject({ title: '이 계좌로 환불을 다시 요청할까요?', confirmLabel: '저장하고 환불 다시 요청', cancelLabel: '돌아가기', destructive: true });
    expect(asked.message.split('\n').slice(0, 4)).toEqual(['은행: 신한은행', '계좌번호: 000-000-123456', '예금주: 김엑스', '환불 금액: 31,000원']);
    for (const part of ['저장하면 이 계좌로 환불을 바로 다시 요청합니다.', '결제한 분 본인 계좌인지', '되돌릴 수 없습니다']) expect(asked.message, part).toContain(part);
    expect(asked.confirmLabel).toBe(VIRTUAL_ACCOUNT_REFUND_ACCOUNT_SAVE_LABELS.cancel);
  });

  it('반품 건 확인창은 저장만 하고 환불은 버튼을 눌러야 나간다고 말한다 — 금액을 모르면 적지 않는다', () => {
    const asked = virtualAccountRefundAccountEntryConfirm({ claimType: 'return', bankName: '신한은행', accountNumber: '000-000-123456', accountHolder: '김엑스' });
    expect(asked).toMatchObject({ title: '환불 계좌를 저장할까요?', confirmLabel: '환불 계좌 저장', cancelLabel: '돌아가기' });
    expect(asked.destructive).toBeUndefined();
    expect(asked.message).toContain('저장만 하고 환불은 아직 하지 않습니다.');
    expect(asked.message).toContain('[환불 완료 확정](주문 처리 패널에서는 [상태 다시 확인])');
    expect(asked.message).not.toContain('바로 다시 요청');
    expect(asked.message).not.toContain('환불 금액');
    expect(virtualAccountRefundAccountEntryConfirm({ claimType: 'return', bankName: 'a', accountNumber: 'b', accountHolder: 'c', refundAmount: 0 }).message).not.toContain('환불 금액');
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
