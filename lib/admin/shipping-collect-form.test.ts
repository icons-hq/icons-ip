import { describe, expect, it } from 'vitest';
import type { ShippingCollectEvent, ShippingCollectObligation } from '@/lib/admin/shipping-collect-events';
import {
  shippingCollectAmountProblem, shippingCollectConfirmRequest, shippingCollectEventLabel, shippingCollectEventSummary, shippingCollectFixedAmount, shippingCollectFixedAmountNote,
  shippingCollectKindLock, shippingCollectKindOptions, shippingCollectNowLocal, shippingCollectServerMessage,
} from './shipping-collect-form';

const event = (overrides: Partial<ShippingCollectEvent>): ShippingCollectEvent => ({ operationId: 'c3a00000-0000-4002-8000-000000000051', event: 'collected', amount: 2250,
  recordedAt: '2026-10-14T02:00:00Z', occurredAt: '2026-10-14T01:00:00Z', party: '운송사', reversesOperationId: null, reference: 'R-1', note: '확인', ...overrides });
const obligation = (overrides: Partial<ShippingCollectObligation> = {}): ShippingCollectObligation => ({ shipmentId: 'c3a00000-0000-4002-8000-000000000052', orderId: 'c3a00000-0000-4002-8000-000000000053',
  originName: '김포', amount: 2250, state: 'planned', revision: 1, updatedAt: '2026-10-14T00:00:00Z', events: [], ...overrides });

describe('기록 종류가 정하는 금액', () => {
  it('수납 확인·환불 확인 필요·전액 환불은 주문 당시 금액, 미수납 종료는 0원, 정정은 바로 앞 기록의 금액이다', () => {
    const latest = event({ amount: 2250 });
    for (const kind of ['collected', 'refund_review', 'refunded']) expect(shippingCollectFixedAmount(kind, obligation(), latest)).toBe(2250);
    expect(shippingCollectFixedAmount('void', obligation(), undefined)).toBe(0);
    expect(shippingCollectFixedAmount('correction', obligation(), event({ amount: 1500 }))).toBe(1500);
    expect(shippingCollectFixedAmount('correction', obligation(), undefined)).toBeNull();
  });
  it('수납 금액 불일치와 아직 고르지 않은 종류는 운영자가 적는다', () => {
    expect(shippingCollectFixedAmount('mismatch', obligation(), undefined)).toBeNull();
    expect(shippingCollectFixedAmount('', obligation(), undefined)).toBeNull();
  });
  it('정해진 금액은 왜 그 금액인지 한 줄을 단다', () => {
    expect(shippingCollectFixedAmountNote('collected')).toBe('주문 당시 착불 금액입니다.');
    expect(shippingCollectFixedAmountNote('void')).toBe('미수납으로 끝내므로 0원입니다.');
    expect(shippingCollectFixedAmountNote('correction')).toBe('바로 앞 기록과 같은 금액입니다.');
  });
  it('불일치 기록은 예정 금액과 같으면 보내기 전에 막는다', () => {
    expect(shippingCollectAmountProblem('mismatch', 2250, obligation())).toBe('수납 금액 불일치는 예정 금액(2,250원)과 다른 금액이어야 합니다.');
    expect(shippingCollectAmountProblem('mismatch', 2000, obligation())).toBeNull();
    expect(shippingCollectAmountProblem('collected', 2250, obligation())).toBeNull();
  });
});

describe('고를 수 없는 기록 종류를 이유와 함께 잠근다', () => {
  it('이미 수납을 확인했으면 다시 수납 확인을 못 하고, 수납 전에는 전액 환불을 못 하며, 수납한 건은 미수납으로 끝낼 수 없다', () => {
    const collected = obligation({ state: 'collected', events: [event({})] });
    expect(shippingCollectKindLock('collected', collected)).toBe('이미 외부 수납을 확인했습니다.');
    expect(shippingCollectKindLock('refunded', collected)).toBeNull();
    expect(shippingCollectKindLock('void', collected)).toBe('수납을 확인한 기록이 있어 미수납으로 끝낼 수 없습니다.');
    expect(shippingCollectKindLock('refunded', obligation())).toBe('수납을 확인한 뒤에 고를 수 있습니다.');
    expect(shippingCollectKindLock('collected', obligation())).toBeNull();
    expect(shippingCollectKindLock('mismatch', obligation())).toBeNull();
    expect(shippingCollectKindLock('refund_review', obligation())).toBeNull();
  });
  it('수납을 확인했다가 정정으로 되돌렸다면 미수납으로 끝낼 수 있다', () => {
    const reversed = obligation({ state: 'planned', events: [event({}), event({ operationId: 'c3a00000-0000-4002-8000-000000000054', event: 'correction', reversesOperationId: 'c3a00000-0000-4002-8000-000000000051' })] });
    expect(shippingCollectKindLock('void', reversed)).toBeNull();
  });
  it('주문 상태를 알려 주면 취소된 주문에서만 고를 수 있는 종류와 결제 확인 전의 수납 확인을 잠근다', () => {
    const collected = obligation({ state: 'collected', events: [event({})] });
    expect(shippingCollectKindLock('refunded', collected, 'paid')).toBe('주문이 취소된 뒤에 고를 수 있습니다.');
    expect(shippingCollectKindLock('refunded', collected, 'canceled')).toBeNull();
    expect(shippingCollectKindLock('void', obligation(), 'confirmed')).toBe('주문이 취소된 뒤에 고를 수 있습니다.');
    expect(shippingCollectKindLock('void', obligation(), 'canceled')).toBeNull();
    expect(shippingCollectKindLock('collected', obligation(), 'pending')).toBe('결제가 확인된 뒤에 고를 수 있습니다.');
    expect(shippingCollectKindLock('collected', obligation(), 'canceled')).toBeNull();
  });
  it('끝난 기록에는 정정만 남고, 정정은 바로 앞 기록이 수납 예정·정정이 아닐 때만 있다', () => {
    const labels = (value: ShippingCollectObligation) => shippingCollectKindOptions(value).map(option => option.event);
    expect(labels(obligation())).toEqual(['collected', 'void', 'refund_review', 'refunded', 'mismatch']);
    expect(labels(obligation({ events: [event({ event: 'planned' })] }))).toEqual(['collected', 'void', 'refund_review', 'refunded', 'mismatch']);
    expect(labels(obligation({ state: 'collected', events: [event({})] }))).toEqual(['collected', 'void', 'refund_review', 'refunded', 'mismatch', 'correction']);
    expect(labels(obligation({ state: 'void', events: [event({ event: 'void', amount: 0 })] }))).toEqual(['correction']);
    expect(labels(obligation({ state: 'void', events: [event({ event: 'correction' })] }))).toEqual([]);
  });
});

describe('이름과 기록 한 줄', () => {
  it('정정은 바로 앞 기록 정정이라 부르고, 기록은 종류·금액·발생 시각으로 읽는다', () => {
    expect(shippingCollectEventLabel('correction')).toBe('바로 앞 기록 정정');
    expect(shippingCollectEventLabel('collected')).toBe('외부 수납 확인');
    expect(shippingCollectEventSummary(event({}))).toMatch(/^외부 수납 확인 · 2,250원 · /);
    expect(shippingCollectEventSummary(event({ occurredAt: null }))).toMatch(/^외부 수납 확인 · 2,250원 · /);
  });
  it('지금 시각(KST)은 분 단위 datetime-local 값이다', () => {
    expect(shippingCollectNowLocal(new Date('2026-11-26T01:23:45Z'))).toBe('2026-11-26T10:23');
  });
});

describe('기록하기 확인창', () => {
  it('출고지·착불 금액·기록 종류·금액과 지울 수 없다는 사실, 결제 금액이 바뀌지 않는다는 사실을 말한다', () => {
    const request = shippingCollectConfirmRequest({ obligation: obligation(), event: 'collected', amount: 2250, latest: undefined });
    expect(request).toEqual({
      title: '착불 수납을 기록할까요?',
      message: '김포 · 착불 배송비 2,250원\n기록 종류: 외부 수납 확인\n금액: 2,250원\n기록은 지울 수 없습니다. 잘못 적었다면 기록 종류에서 ‘바로 앞 기록 정정’을 골라 되돌린 뒤 다시 기록하세요.\n온라인 결제·환불 금액은 바뀌지 않습니다.',
      confirmLabel: '기록하기', cancelLabel: '돌아가기',
    });
  });
  it('정정은 되돌리는 기록을 내부 번호 없이 종류·금액·시각으로 가리킨다', () => {
    const request = shippingCollectConfirmRequest({ obligation: obligation(), event: 'correction', amount: 2250, latest: event({}) });
    expect(request.title).toBe('바로 앞 기록을 정정할까요?');
    expect(request.confirmLabel).toBe('정정하기');
    expect(request.message).toContain('바로 앞 기록(외부 수납 확인 · 2,250원 · ');
    expect(request.message).toContain('을 없던 것으로 되돌립니다. 맞는 내용은 되돌린 뒤 새로 기록해야 합니다.');
    expect(request.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe('서버 안내의 옛 버튼 이름', () => {
  it('화면에 없는 옛 버튼 이름을 지금 이름으로(조사까지) 바꿔 보이고, 새 이름이면 그대로 둔다', () => {
    expect(shippingCollectServerMessage('저장됐는지 확인하지 못했습니다. 입력은 그대로 두고 [이전 결과 확인 후 같은 요청 재시도]를 눌러주세요.')).toBe('저장됐는지 확인하지 못했습니다. 입력은 그대로 두고 [저장됐는지 확인]을 눌러주세요.');
    expect(shippingCollectServerMessage('잠시 뒤 [이전 결과 확인]을 다시 눌러주세요.')).toBe('잠시 뒤 [저장됐는지 확인]을 다시 눌러주세요.');
    expect(shippingCollectServerMessage('잠시 뒤 [이전 요청 무효 처리 후 다시 입력]을 다시 눌러주세요.')).toBe('잠시 뒤 [그만두고 다시 하기]를 다시 눌러주세요.');
    expect(shippingCollectServerMessage('다른 사람이 수납 기록을 먼저 저장했습니다. [최신 내역 불러오기]로 이력을 확인한 뒤 다시 입력해주세요.')).toContain('[최신 내역 불러오기]');
    expect(shippingCollectServerMessage('잠시 뒤 [저장됐는지 확인]을 다시 눌러주세요.')).toBe('잠시 뒤 [저장됐는지 확인]을 다시 눌러주세요.');
  });
});
