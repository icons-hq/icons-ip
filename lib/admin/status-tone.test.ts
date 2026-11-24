import { describe, expect, it } from 'vitest';
import { statusTone } from './status-tone';

describe('상태 → tone 단일 표 (ADR-0029)', () => {
  it('처리해야 할 상태는 주의, 끝난 상태는 조용히, 문제는 위험으로 말한다', () => {
    expect(statusTone('order', 'paid')).toBe('warning');
    expect(statusTone('order', 'pending')).toBe('neutral');
    expect(statusTone('order', 'shipping')).toBe('info');
    expect(statusTone('order', 'delivered')).toBe('success');
    expect(statusTone('order', 'done')).toBe('neutral');
    expect(statusTone('order', 'canceled')).toBe('danger');
    expect(statusTone('claim', 'requested')).toBe('warning');
    expect(statusTone('claim', 'needs_review')).toBe('danger');
    expect(statusTone('claim', 'rejected')).toBe('neutral');
    expect(statusTone('inquiry', 'open')).toBe('warning');
    expect(statusTone('inquiry', 'answered')).toBe('success');
    expect(statusTone('stock', 'soldout')).toBe('danger');
    expect(statusTone('stock', 'low')).toBe('warning');
  });

  it('이벤트는 아직 안 연 것(예정)과 지금 열려 있는 것(예매중·진행중)을 다른 색으로 구분한다', () => {
    expect(statusTone('event', '예정')).toBe('info');
    expect(statusTone('event', '예매중')).toBe('success');
    expect(statusTone('event', '진행중')).toBe('success');
    expect(statusTone('event', '종료')).toBe('neutral');
  });

  /* QA1 MD: 전시에 담았지만 고객 화면에 안 보이는 상품(비공개 등)과 한도를 넘어 못 담은 줄은 확인을 부른다 — 담기를 막은 줄(추가 안 함)은 조용하다. */
  it('전시 상품 고르기의 줄 상태와 고객 화면 공개 표시', () => {
    expect(statusTone('goodReference', 'ready')).toBe('success');
    expect(statusTone('goodReference', 'blocked')).toBe('neutral');
    expect(statusTone('goodReference', 'overLimit')).toBe('warning');
    expect(statusTone('goodReference', 'notVisible')).toBe('warning');
  });

  it('출고 보류는 아직 나가지 않은 배송 건이면 위험, 이미 발송된 주문이면 경고다', () => {
    expect(statusTone('fulfillmentHold', 'test_payment')).toBe('danger');
    expect(statusTone('fulfillmentHold', 'provider_canceled')).toBe('danger');
    expect(statusTone('fulfillmentHold', 'blocked')).toBe('danger');
    expect(statusTone('fulfillmentHold', 'shipped')).toBe('warning');
  });

  it('자동 작업은 실패 중·멈춤만 위험이고, 미종결 결제는 불일치 확인 필요만 위험이다', () => {
    expect(statusTone('systemJob', 'failing')).toBe('danger');
    expect(statusTone('systemJob', 'stalled')).toBe('danger');
    expect(statusTone('systemJob', 'ok')).toBe('success');
    expect(statusTone('systemJob', 'unrecorded')).toBe('neutral');
    expect(statusTone('unresolvedPayment', 'needs_review')).toBe('danger');
    expect(statusTone('unresolvedPayment', 'unknown')).toBe('warning');
    expect(statusTone('unresolvedPayment', 'confirming_stalled')).toBe('warning');
  });

  /* 토스 가상계좌(ADR-0049): 고객의 입금을 기다리는 상태는 조용히, 은행이 되돌린 입금은 위험, 구매자 에스크로 취소 신청은 처리할 일이다. */
  it('가상계좌 입금 대기·입금 상태·새 출고 보류 사유·기한 지난 입금 대기', () => {
    expect(statusTone('paymentAttempt', 'awaiting_deposit')).toBe('neutral');
    expect(statusTone('paymentAttempt', 'needs_review')).toBe('danger');
    expect(statusTone('unpaid', 'awaiting_deposit')).toBe('neutral');
    expect(statusTone('virtualAccount', 'awaiting')).toBe('neutral');
    expect(statusTone('virtualAccount', 'deposited')).toBe('success');
    expect(statusTone('virtualAccount', 'checking')).toBe('warning');
    expect(statusTone('virtualAccount', 'closed')).toBe('neutral');
    expect(statusTone('fulfillmentHold', 'deposit_reversed')).toBe('danger');
    expect(statusTone('fulfillmentHold', 'escrow_cancel_requested')).toBe('warning');
    expect(statusTone('unresolvedPayment', 'awaiting_deposit')).toBe('warning');
    expect(statusTone('escrowDelivery', 'manual_required')).toBe('danger');
    expect(statusTone('escrowDelivery', 'registered')).toBe('success');
    expect(statusTone('escrowStatus', 'CANCEL_REQUESTED')).toBe('warning');
    expect(statusTone('escrowStatus', 'CONFIRMED')).toBe('success');
    expect(statusTone('virtualAccountRefund', 'failed')).toBe('danger');
    expect(statusTone('virtualAccountRefund', 'pending')).toBe('info');
    expect(statusTone('virtualAccountRefund', 'completed')).toBe('success');
    expect(statusTone('virtualAccountRefund', 'resolved')).toBe('neutral');
  });

  it('표에 없는 상태는 눈에 띄지 않는 neutral이다', () => {
    expect(statusTone('order', 'not-a-status')).toBe('neutral');
    expect(statusTone('claim', null)).toBe('neutral');
  });
});
