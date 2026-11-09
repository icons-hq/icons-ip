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

  it('이벤트는 열리기 전(예정·예매중)과 진행중을 다른 색으로 구분한다', () => {
    expect(statusTone('event', '예정')).toBe('info');
    expect(statusTone('event', '예매중')).toBe('info');
    expect(statusTone('event', '진행중')).toBe('success');
    expect(statusTone('event', '종료')).toBe('neutral');
  });

  it('표에 없는 상태는 눈에 띄지 않는 neutral이다', () => {
    expect(statusTone('order', 'not-a-status')).toBe('neutral');
    expect(statusTone('claim', null)).toBe('neutral');
  });
});
