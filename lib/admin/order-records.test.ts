import { describe, expect, it } from 'vitest';
import {
  describeStatusEvent,
  normalizeOrderExternalRefInput,
  normalizeOrderNoteInput,
  ORDER_NOTE_MAX_LENGTH,
  type AdminOrderStatusEvent,
} from './order-records';

const ORDER_ID = '2b1f0d3c-1111-4222-8333-444455556666';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe('주문 메모 입력', () => {
  it('내용과 종류를 받아 정규화한다', () => {
    const result = normalizeOrderNoteInput(form({ orderId: ORDER_ID, body: '  고객 통화 완료  ', kind: 'cs', pinned: 'on' }));
    expect(result).toEqual({ ok: true, value: { orderId: ORDER_ID, kind: 'cs', body: '고객 통화 완료', pinned: true } });
  });

  it('종류를 안 고르면 내부 메모다', () => {
    const result = normalizeOrderNoteInput(form({ orderId: ORDER_ID, body: '메모' }));
    expect(result.ok && result.value.kind).toBe('memo');
    expect(result.ok && result.value.pinned).toBe(false);
  });

  it('빈 메모·너무 긴 메모·모르는 종류는 거른다', () => {
    expect(normalizeOrderNoteInput(form({ orderId: ORDER_ID, body: '   ' }))).toEqual({
      ok: false, errors: { body: '메모를 적어주세요.' },
    });
    const long = normalizeOrderNoteInput(form({ orderId: ORDER_ID, body: 'ㄱ'.repeat(ORDER_NOTE_MAX_LENGTH + 1) }));
    expect(long.ok).toBe(false);
    /* 시스템이 남기는 종류(status·system)를 사람이 입을 수 없다 — RPC 도 같은 자리에서 막는다. */
    const spoofed = normalizeOrderNoteInput(form({ orderId: ORDER_ID, body: '메모', kind: 'system' }));
    expect(spoofed).toEqual({ ok: false, errors: { kind: '메모 종류를 골라주세요.' } });
  });

  it('주문 id 가 uuid 가 아니면 폼 오류다', () => {
    expect(normalizeOrderNoteInput(form({ orderId: 'ABCD1234', body: '메모' }))).toEqual({
      ok: false, errors: { form: '주문을 찾을 수 없습니다.' },
    });
  });
});

describe('외부 참조 입력', () => {
  it('종류와 번호를 받고 메모는 선택이다', () => {
    const result = normalizeOrderExternalRefInput(form({
      orderId: ORDER_ID, kind: 'sabangnet_order', value: ' SBN-20260904-1 ', note: '',
    }));
    expect(result).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, kind: 'sabangnet_order', value: 'SBN-20260904-1', note: null },
    });
  });

  it('모르는 종류와 빈 번호는 거른다', () => {
    expect(normalizeOrderExternalRefInput(form({ orderId: ORDER_ID, kind: 'guess', value: '1' })).ok).toBe(false);
    expect(normalizeOrderExternalRefInput(form({ orderId: ORDER_ID, kind: 'other', value: '' }))).toEqual({
      ok: false, errors: { value: '번호를 적어주세요.' },
    });
  });
});

describe('상태 이력 한 줄', () => {
  const labels = { pending: '입금전', paid: '결제완료', shipping: '배송중' };
  const base: AdminOrderStatusEvent = {
    id: 'e1', fromStatus: null, toStatus: 'pending', actorId: null,
    actorName: '(시스템)', note: null, source: 'backfill', occurredAt: '2026-09-04T00:00:00Z',
  };

  it('첫 사건은 주문 접수로 읽는다', () => {
    expect(describeStatusEvent(base, labels)).toBe('입금전 (주문 접수)');
  });

  it('나머지는 무엇에서 무엇으로 읽는다', () => {
    expect(describeStatusEvent({ ...base, fromStatus: 'paid', toStatus: 'shipping' }, labels))
      .toBe('결제완료 → 배송중');
  });

  it('라벨을 모르는 상태는 값을 그대로 보여준다 — 조용히 지어내지 않는다', () => {
    expect(describeStatusEvent({ ...base, fromStatus: 'paid', toStatus: 'unknown' }, labels))
      .toBe('결제완료 → unknown');
  });
});
