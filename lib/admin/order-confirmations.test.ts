import { describe, expect, it } from 'vitest';
import {
  ADMIN_CONFIRM_BACK,
  ADMIN_ORDER_CONFIRM_CONSEQUENCE,
  ADMIN_PARTIAL_REFUND_NOTE,
  ADMIN_VIRTUAL_ACCOUNT_REFUND_NOTE,
  adminBulkOrderConfirmRequest,
  adminCancelApproveRequest,
  adminCancelRecheckRequest,
  adminCancelRejectRequest,
  adminKorpayRecoveryRequest,
  adminOrderCancelAmount,
  adminOrderCancelPaymentLabel,
  adminOrderCancelProviderLabel,
  adminOrderConfirmRequest,
  adminOrderIdentityLine,
  adminStaffCancelRequest,
} from './order-confirmations';

const payment = (overrides: Partial<{ id: string; provider: string | null; amount: number; status: string }> = {}) => ({
  id: 'p', provider: 'toss', amount: 32000, status: 'paid', createdAt: '2026-07-14T06:01:00.000Z', ...overrides,
});
const order = (overrides: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', orderNumber: '2026102710000042', buyerName: 'maple_fan', total: 32000, payments: [payment()], ...overrides,
}) as Parameters<typeof adminStaffCancelRequest>[0];

/*
 * 돈·재고·출고가 움직이는 버튼의 확인창은 누르기 전에 어느 주문인지(번호·구매자)와 얼마인지를 말한다.
 * 주문 처리 패널이 다른 주문을 가리키고 있어도 확인창에서 한 번 더 알아볼 수 있어야 한다.
 */
describe('주문 처리 확인창', () => {
  it('맨 윗줄은 주문번호 · 구매자 · 금액이다(번호가 없는 옛 주문은 끝 8자)', () => {
    expect(adminOrderIdentityLine(order())).toBe('주문 2026102710000042 · maple_fan · ₩32,000');
    expect(adminOrderIdentityLine(order({ orderNumber: undefined }))).toBe('주문 11111111 · maple_fan · ₩32,000');
    expect(adminOrderIdentityLine(order(), 1234567)).toBe('주문 2026102710000042 · maple_fan · ₩1,234,567');
  });

  it('전액 취소: 취소되는 금액·결제사·되돌릴 수 없음과, 부분 취소로 금액이 줄 수 있다는 사실을 말한다', () => {
    const request = adminStaffCancelRequest(order());
    expect(request.message).toBe([
      '주문 2026102710000042 · maple_fan · ₩32,000',
      '토스 결제를 전액 취소합니다. 되돌릴 수 없고, 재고·쿠폰·적립금이 돌아가며 구매자에게 취소 알림이 갑니다.',
      '재고 부족 부분 취소로 이미 환불한 금액이 있으면 그만큼 뺀 나머지만 취소합니다.',
    ].join('\n'));
    expect(request).toMatchObject({ confirmLabel: '전액 취소', cancelLabel: ADMIN_CONFIRM_BACK, destructive: true });
    expect(request.message).toContain(ADMIN_PARTIAL_REFUND_NOTE);
  });

  it('취소 금액은 결제완료 결제의 합이고, 실패한 결제는 더하지 않는다(처리 쪽 환불 계산과 같은 기준)', () => {
    const multi = order({ total: 50000, payments: [payment({ id: 'a', amount: 18000 }), payment({ id: 'b', amount: 12000 }), payment({ id: 'c', amount: 99000, status: 'failed' })] });
    expect(adminOrderCancelAmount(multi)).toBe(30000);
    expect(adminStaffCancelRequest(multi).message).toContain('maple_fan · ₩30,000');
    /* 결제완료 결제가 없으면 주문 금액이다. */
    expect(adminOrderCancelAmount(order({ payments: [] }))).toBe(32000);
  });

  it('결제사 이름은 결제완료 결제가 하나의 취소 가능한 결제사일 때만 말하고, 아니면 말하지 않는다', () => {
    expect(adminOrderCancelProviderLabel(order({ payments: [payment({ provider: 'nicepay' })] }))).toBe('나이스페이');
    expect(adminOrderCancelProviderLabel(order({ payments: [payment({ provider: 'toss' }), payment({ id: 'x', provider: 'toss' })] }))).toBe('토스');
    expect(adminOrderCancelProviderLabel(order({ payments: [payment({ provider: 'toss' }), payment({ id: 'x', provider: 'nicepay' })] }))).toBeNull();
    expect(adminOrderCancelProviderLabel(order({ payments: [payment({ provider: 'korpay' })] }))).toBeNull();
    expect(adminOrderCancelProviderLabel(order({ payments: [] }))).toBeNull();
  });

  it('결제수단은 가상계좌·계좌이체 정보가 함께 실려 온 주문만 구분해 말한다(카드라고 단정하지 않는다)', () => {
    expect(adminOrderCancelPaymentLabel(order())).toBe('토스');
    expect(adminOrderCancelPaymentLabel(order({ virtualAccount: { state: 'deposited' } }))).toBe('토스 가상계좌');
    expect(adminOrderCancelPaymentLabel(order({ transferEscrow: { useEscrow: null, job: {} } }))).toBe('토스 계좌이체');
    expect(adminOrderCancelPaymentLabel(order({ payments: [payment({ provider: 'korpay' })], virtualAccount: { state: 'deposited' } }))).toBeNull();
    expect(adminStaffCancelRequest(order({ payments: [payment({ provider: 'nicepay' })] })).message).toContain('\n나이스페이 결제를 전액 취소합니다.');
    expect(adminStaffCancelRequest(order({ payments: [payment({ provider: 'korpay' })] })).message).toContain('\n결제를 전액 취소합니다.');
  });

  it('가상계좌 결제는 환불이 고객 환불 계좌로 나가고 계좌가 없으면 멈춘다는 사실을 덧붙인다', () => {
    const request = adminStaffCancelRequest(order({ virtualAccount: { state: 'deposited' } }));
    expect(request.message.split('\n')).toEqual([
      '주문 2026102710000042 · maple_fan · ₩32,000',
      '토스 가상계좌 결제를 전액 취소합니다. 되돌릴 수 없고, 재고·쿠폰·적립금이 돌아가며 구매자에게 취소 알림이 갑니다.',
      ADMIN_PARTIAL_REFUND_NOTE,
      ADMIN_VIRTUAL_ACCOUNT_REFUND_NOTE,
    ]);
    expect(adminStaffCancelRequest(order()).message).not.toContain('환불 계좌');
  });

  it('취소 승인: 승인하면 일어나는 일과 금액을 말하고, 발송 뒤 반품 입고 확인은 묻지 않는다', () => {
    const request = adminCancelApproveRequest(order());
    expect(request.message).toBe([
      '주문 2026102710000042 · maple_fan · ₩32,000',
      '승인하면 결제 취소를 시작합니다. 결제 취소가 확인되면 주문이 취소되고 재고가 돌아갑니다.',
      ADMIN_PARTIAL_REFUND_NOTE,
    ].join('\n'));
    expect(request.message).not.toContain('반품 물건');
    expect(request).toMatchObject({ confirmLabel: '취소 승인', cancelLabel: '돌아가기', destructive: true });
  });

  it('취소 거부: 입력한 사유가 구매자 화면에 보인다고 알린다', () => {
    const request = adminCancelRejectRequest(order());
    expect(request.message).toBe('주문 2026102710000042 · maple_fan · ₩32,000\n구매자의 취소 요청을 거부합니다. 입력한 사유가 구매자 화면에 그대로 보입니다.');
    expect(request).toMatchObject({ confirmLabel: '취소 거부', cancelLabel: '돌아가기' });
  });

  it('발주확인: 번호·구매자·금액과, 발주확인 뒤에는 고객이 직접 취소할 수 없다는 결과를 말한다', () => {
    const request = adminOrderConfirmRequest(order());
    expect(request.message).toBe(`주문 2026102710000042 · maple_fan · ₩32,000\n${ADMIN_ORDER_CONFIRM_CONSEQUENCE}`);
    expect(ADMIN_ORDER_CONFIRM_CONSEQUENCE).toBe('발주확인 뒤에는 고객이 직접 취소할 수 없습니다.');
    expect(request).toMatchObject({ confirmLabel: '발주확인', cancelLabel: '돌아가기' });
  });

  it('일괄 발주확인: 건수를 제목과 버튼에 말하고, 화면마다 한 문장을 덧붙인다', () => {
    expect(adminBulkOrderConfirmRequest(3)).toMatchObject({ title: '신규주문 3건을 발주확인할까요?', message: ADMIN_ORDER_CONFIRM_CONSEQUENCE, confirmLabel: '3건 발주확인', cancelLabel: '돌아가기' });
    expect(adminBulkOrderConfirmRequest(1200, '선택하지 않은 같은 주문의 품목도 함께 처리됩니다.')).toMatchObject({
      title: '신규주문 1,200건을 발주확인할까요?',
      message: `선택하지 않은 같은 주문의 품목도 함께 처리됩니다. ${ADMIN_ORDER_CONFIRM_CONSEQUENCE}`,
    });
  });

  it('결제 취소 상태 다시 확인: 버튼 이름 그대로 확인하고 주문을 말한다', () => {
    const request = adminCancelRecheckRequest(order(), '상태 다시 확인');
    expect(request).toMatchObject({ confirmLabel: '상태 다시 확인', cancelLabel: '돌아가기' });
    expect(request.message.split('\n')[0]).toBe('주문 2026102710000042 · maple_fan · ₩32,000');
  });

  it('Korpay 전액 취소 반영: 확인란 대신 원장에서 직접 확인했는지를 묻는다', () => {
    const request = adminKorpayRecoveryRequest({ providerOrderId: 'O0123456789ABCDEF', amount: 32000, currency: 'KRW' });
    expect(request.title).toBe('코페이 원장에서 전액 취소를 확인하셨나요?');
    expect(request.message).toBe('코페이 주문 O0123456789ABCDEF · ₩32,000 KRW\n이 결제가 코페이 원장에서 전액 취소된 것을 직접 확인한 경우에만 반영합니다. 반영하면 확인된 결제에는 환불 원장을 남기고, 주문 취소와 재고 복원을 바로 끝냅니다.');
    expect(request).toMatchObject({ confirmLabel: '전액 취소 반영', cancelLabel: '돌아가기', destructive: true });
  });

  it('확인창 글에 쓰지 않는 표현이 없다(번역투·개발 용어)', () => {
    const texts = [
      adminStaffCancelRequest(order()), adminCancelApproveRequest(order()), adminCancelRejectRequest(order()), adminOrderConfirmRequest(order()),
      adminBulkOrderConfirmRequest(2), adminCancelRecheckRequest(order(), '상태 다시 확인'), adminKorpayRecoveryRequest({ providerOrderId: 'O1', amount: 1, currency: 'KRW' }),
    ].flatMap(request => [request.title ?? '', request.message, request.confirmLabel ?? '']);
    for (const text of texts) {
      expect(text).not.toMatch(/에 대한|을 통해|를 통해|에 의해|것이 가능|해당 |상기 |의 경우[ ,]|RPC|\bDB\b|UUID|\bID\b/);
    }
  });
});

/* 운송장 확인창: 고객 주문 상세의 배송조회가 바뀌므로 어느 배송 건의 어느 번호가 어떻게 바뀌는지를 말한다. */
describe('운송장 확인창', () => {
  it('운송장 수정: 어느 배송 건인지와 고객 배송조회가 바뀐다는 결과를 말한다', async () => {
    const { adminTrackingEditRequest } = await import('./order-confirmations');
    expect(adminTrackingEditRequest('2026111830000001')).toEqual({
      title: '운송장을 수정할까요?',
      message: '배송 건 2026111830000001의 운송장을 바꿉니다. 고객 주문 상세의 배송조회가 바뀐 번호로 열리고, 바꾼 내용이 감사 기록에 남습니다.',
      confirmLabel: '운송장 수정',
      cancelLabel: '돌아가기',
    });
  });

  it('맞바꾸기: 두 배송 건의 번호가 어떻게 바뀌는지 줄마다 보인다', async () => {
    const { adminTrackingSwapRequest } = await import('./order-confirmations');
    const request = adminTrackingSwapRequest({ reference: '2026111830000001', trackingNumber: '100000000001', otherReference: '2026111830000002', otherTrackingNumber: '200000000002' });
    expect(request.message.split('\n')).toEqual([
      '두 배송 건의 운송장을 서로 바꿉니다.',
      '이 배송 건 2026111830000001: 100000000001 → 200000000002',
      '상대 배송 건 2026111830000002: 200000000002 → 100000000001',
      '고객 주문 상세의 배송조회가 바뀐 번호로 열리고, 두 배송 건 모두 감사 기록에 사유가 남습니다.',
    ]);
    expect(request).toMatchObject({ title: '운송장을 맞바꿀까요?', confirmLabel: '맞바꾸기', cancelLabel: '돌아가기' });
  });

  it('중복 확인 후 등록: 숫자 끝소리로 조사를 고르고 창고에서 같은 상자로 확인한 경우에만 하라고 말한다', async () => {
    const { adminTrackingDuplicateRequest } = await import('./order-confirmations');
    const request = adminTrackingDuplicateRequest({ reference: '2026111830000001', carrierLabel: '한진택배', trackingNumber: '100000000002' });
    expect(request.message.split('\n')[0]).toBe('배송 건 2026111830000001에 한진택배 100000000002를 등록합니다.');
    expect(request.message).toContain('창고에 같은 상자로 확인한 경우에만 진행하세요.');
    expect(request).toMatchObject({ confirmLabel: '중복 확인 후 등록', cancelLabel: '돌아가기' });
    expect(request.message).not.toContain('을(를)');
  });

  it('추가 운송장 지우기: 지울 번호와, 고객 주문 상세에서도 빠진다는 결과를 말한다', async () => {
    const { adminExtraTrackingRemoveRequest } = await import('./order-confirmations');
    const request = adminExtraTrackingRemoveRequest({ reference: '2026111230000001', label: '우체국택배 XT10000001' });
    expect(request.message).toBe('배송 건 2026111230000001의 추가 운송장 우체국택배 XT10000001을 지웁니다.\n고객 주문 상세에서도 이 번호가 빠지고, 지운 사유가 감사 기록에 남습니다.');
    expect(request).toMatchObject({ title: '추가 운송장을 지울까요?', confirmLabel: '추가 운송장 지우기', cancelLabel: '돌아가기', destructive: true });
  });
});
