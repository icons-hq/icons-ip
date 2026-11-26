import { describe, expect, it } from 'vitest';
import { formatOrderDateTime } from '@/lib/orders';
import {
  bankDepositConfirmRequest,
  bankDepositIgnoreRequest,
  unpaidCancelRequest,
  unpaidConfirmDepositRequest,
  unpaidDeadlineText,
  unpaidExtendDeadlineRequest,
  unpaidOrderLabel,
} from './unpaid-copy';
import type { AdminBankDepositRow, AdminUnpaidOrderRow } from './unpaid';

/* 입금 확인·기한 연장·즉시 취소는 누르는 순간 결제 상태·재고가 바뀐다. 확인창이 어느 주문인지(번호·구매자·금액)와 결과를 말하는지 본다.
   값은 화면에 이미 내려온 줄에서만 가져온다 — 줄에 없는 값을 새로 만들어 말하지 않는다. */
const ORDER: AdminUnpaidOrderRow = {
  id: '9a3f21c0-1111-4000-8000-000000000abc',
  orderNumber: '20261126140710000001',
  buyerName: '홍길동',
  buyerId: '00000000-0000-4000-8000-000000000d01',
  recipientName: '김수령',
  total: 23000,
  createdAt: '2026-11-26T05:07:00.000Z',
  expiresAt: '2026-11-27T05:07:00.000Z',
  extendedAt: null,
  depositCode: '612345',
  itemSummary: '무통장 굿즈 × 1',
  attemptState: 'prepared',
};
const lines = (message: string) => message.split('\n');

describe('unpaidOrderLabel · unpaidDeadlineText', () => {
  it('주문번호가 있으면 주문번호로, 번호가 없는 옛 주문만 입금확인코드로 가리킨다', () => {
    expect(unpaidOrderLabel(ORDER)).toBe('주문 20261126140710000001');
    expect(unpaidOrderLabel({ ...ORDER, orderNumber: undefined })).toBe('입금확인코드 612345 주문');
  });

  it('입금 기한은 KST 표기이고, 모르면 그렇게 말한다', () => {
    expect(unpaidDeadlineText('2026-11-27T05:07:00.000Z')).toBe(formatOrderDateTime('2026-11-27T05:07:00.000Z'));
    expect(unpaidDeadlineText('2026-11-27T05:07:00.000Z')).toContain('14:07');
    expect(unpaidDeadlineText(null)).toBe('기한 정보 없음');
    expect(unpaidDeadlineText('not-a-date')).toBe('기한 정보 없음');
  });
});

describe('입금 확인 확인창', () => {
  const request = unpaidConfirmDepositRequest(ORDER);

  it('주문번호·구매자·금액과 통장에서 맞춰 볼 입금자명을 말한다', () => {
    expect(lines(request.message)[0]).toBe('주문 20261126140710000001 · 홍길동 · 23,000원');
    expect(request.message).toContain('안내된 입금자명 김수령612345');
  });

  it('결제완료가 되고 고객 메일이 나가며 이 화면에서는 되돌릴 수 없다고 말한다', () => {
    expect(request.message).toContain('입금을 확인하면 주문이 결제완료(신규주문)가 되고 고객에게 주문 확인 메일을 보냅니다.');
    expect(request.message).toContain('이 화면에서는 되돌릴 수 없습니다. 잘못 확인했다면 주문을 취소하고 환불해야 합니다.');
  });

  it('버튼은 하는 일을 말하고 취소는 돌아가기다', () => {
    expect(request).toMatchObject({ title: '입금을 확인할까요?', confirmLabel: '결제완료로 확정', cancelLabel: '돌아가기' });
  });
});

describe('기한 연장 확인창', () => {
  /* 지금 기한은 11/27 14:07 KST(주문 24시간 뒤). 11/26 20:00 UTC = 11/27 05:00 KST에 누르면 새 기한은 11/28 05:00 KST다. */
  const now = Date.parse('2026-11-26T20:00:00.000Z');
  const request = unpaidExtendDeadlineRequest(ORDER, now);

  it('지금 기한에서 새 기한으로 옮겨 가는 것을 보인다(새 기한은 누른 시각부터 24시간 뒤다)', () => {
    expect(lines(request.message)[0]).toBe('주문 20261126140710000001 · 홍길동');
    expect(request.message).toContain(`입금 기한(KST) ${formatOrderDateTime('2026-11-27T05:07:00.000Z')} → ${formatOrderDateTime('2026-11-27T20:00:00.000Z')}`);
    expect(unpaidExtendDeadlineRequest(ORDER, Date.parse('2026-11-26T08:30:00.000Z')).message)
      .toContain(`→ ${formatOrderDateTime('2026-11-27T08:30:00.000Z')}`);
  });

  it('기존 기한에 더하는 것이 아니라 연장한 시각부터 24시간이라고 말한다', () => {
    expect(request.message).toContain('새 기한은 연장한 시각부터 24시간 뒤입니다.');
    expect(request.message).toContain('주문당 한 번만 연장할 수 있습니다.');
    expect(request.message).toContain('재고를 계속 잡아 두고');
  });

  it('기한을 모르는 줄도 새 기한을 말한다', () => {
    expect(unpaidExtendDeadlineRequest({ ...ORDER, expiresAt: null }, now).message).toContain('입금 기한(KST) 기한 정보 없음 → ');
  });

  it('연장 폭을 약속하지 않는다(기존 기한에 24시간을 더하는 것이 아니라서 새 기한을 나란히 보인다)', () => {
    expect(request).toMatchObject({ title: '입금 기한을 연장할까요?', confirmLabel: '기한 연장', cancelLabel: '돌아가기' });
    expect(`${request.title}${request.confirmLabel}`).not.toContain('24시간');
  });
});

describe('즉시 취소 확인창', () => {
  const request = unpaidCancelRequest(ORDER);

  it('주문번호·구매자·금액과 재고·환불·되살릴 수 없음을 말한다', () => {
    expect(lines(request.message)[0]).toBe('주문 20261126140710000001 · 홍길동 · 23,000원');
    expect(request.message).toContain('취소하면 잡아 둔 재고가 돌아가고, 쓴 쿠폰·적립금이 있으면 고객에게 돌아갑니다.');
    expect(request.message).toContain('입금 전 주문이라 환불은 없습니다.');
    expect(request.message).toContain('취소한 주문은 되살릴 수 없습니다.');
  });

  it('위험 행동이라 확인 버튼이 위험색이고, 취소는 돌아가기다', () => {
    expect(request).toMatchObject({ title: '이 주문을 취소할까요?', confirmLabel: '주문 취소', cancelLabel: '돌아가기', destructive: true });
  });
});

describe('입금 내역 확인창', () => {
  const deposit: AdminBankDepositRow = {
    id: 'd1', source: 'fake', externalId: 'dep-001', depositedAt: '2026-11-26T05:00:00.000Z', depositorName: '김수령612345',
    amount: 23000, rawReference: null, suggestedOrderId: ORDER.id, suggestedOrderCode: '612345', suggestedConfidence: 'code_amount',
  };

  it('확정: 입금액·입금자명과 연결할 주문의 입금확인코드를 말하고 되돌릴 수 없다고 말한다', () => {
    const request = bankDepositConfirmRequest(deposit);
    expect(lines(request.message)[0]).toBe('입금 23,000원 · 입금자명 김수령612345');
    expect(request.message).toContain('연결할 주문 · 입금확인코드 612345 (주문코드·금액 일치)');
    expect(request.message).toContain('확정하면 주문이 결제완료(신규주문)가 되고 고객에게 주문 확인 메일을 보냅니다. 이 화면에서는 되돌릴 수 없습니다.');
    expect(request.message).not.toContain('금액이 다릅니다');
    expect(request).toMatchObject({ title: '입금을 이 주문으로 확정할까요?', confirmLabel: '결제완료로 확정', cancelLabel: '돌아가기' });
  });

  it('금액이 다른 제안은 부분 입금인지 먼저 보라고 한 번 더 말한다', () => {
    const request = bankDepositConfirmRequest({ ...deposit, suggestedConfidence: 'code' });
    expect(request.message).toContain('(주문코드 일치 · 금액 다름)');
    expect(request.message).toContain('입금액이 주문 금액과 다릅니다. 부분 입금인지 먼저 확인해주세요.');
  });

  it('내리기: 목록에서만 사라지고 입금 기록과 보류 사유는 남는다고 말한다', () => {
    const request = bankDepositIgnoreRequest(deposit);
    expect(lines(request.message)[0]).toBe('입금 23,000원 · 입금자명 김수령612345');
    expect(request.message).toContain('내리면 이 목록에서 사라집니다. 입금 기록과 보류 사유는 남아 돈을 돌려줄 때 근거가 됩니다.');
    expect(request).toMatchObject({ title: '입금을 목록에서 내릴까요?', confirmLabel: '목록에서 내리기', cancelLabel: '돌아가기' });
  });
});

describe('확인창 문구의 말', () => {
  it('개발 용어·내부 값·번역투가 없다', () => {
    const deposit: AdminBankDepositRow = {
      id: 'd1', source: 'fake', externalId: 'dep-001', depositedAt: '2026-11-26T05:00:00.000Z', depositorName: '김수령612345',
      amount: 23000, rawReference: null, suggestedOrderId: ORDER.id, suggestedOrderCode: '612345', suggestedConfidence: 'code',
    };
    const all = [
      unpaidConfirmDepositRequest(ORDER), unpaidExtendDeadlineRequest(ORDER, 0), unpaidCancelRequest(ORDER),
      bankDepositConfirmRequest(deposit), bankDepositIgnoreRequest(deposit),
    ].flatMap((request) => [request.title ?? '', request.message, request.confirmLabel ?? '', request.cancelLabel ?? '']).join('\n');
    expect(all).not.toMatch(/\b(RPC|DB|UUID|ID)\b|9a3f21c0|needs_review|prepared|요청|경합|식별자|해당 |에 대한|을 통해|에 의해/);
    expect(all).not.toContain(ORDER.id);
  });
});
