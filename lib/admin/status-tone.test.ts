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

  it('표에 없는 상태는 눈에 띄지 않는 neutral이다', () => {
    expect(statusTone('order', 'not-a-status')).toBe('neutral');
    expect(statusTone('claim', null)).toBe('neutral');
  });
});
