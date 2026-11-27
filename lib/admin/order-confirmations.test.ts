import { describe, expect, it } from 'vitest';
import { claimCancelApprovalConfirm, claimCancelApprovalMoneyConfirm, claimPanelConfirmRequest } from './claim-approval-confirm';
import {
  ADMIN_CANCEL_AMOUNT_RETRY,
  ADMIN_CANCEL_AMOUNT_UNREAD,
  ADMIN_CANCEL_APPROVE_MANUAL_NOTE,
  ADMIN_CONFIRM_BACK,
  ADMIN_ORDER_CONFIRM_CONSEQUENCE,
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
}) as Parameters<typeof adminStaffCancelRequest>[0] & Parameters<typeof adminOrderIdentityLine>[0];

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

  const CONSEQUENCE = '되돌릴 수 없고, 재고·쿠폰·적립금이 돌아가며 구매자에게 취소 알림이 갑니다.';

  it('전액 취소: 누르는 시점에 읽은 취소 금액·결제사·되돌릴 수 없음을 말한다', () => {
    const request = adminStaffCancelRequest(order(), { amount: 32000, paidAmount: 32000 });
    expect(request.message).toBe([
      '주문 2026102710000042 · maple_fan · ₩32,000',
      `토스 결제를 전액 취소합니다. ${CONSEQUENCE}`,
    ].join('\n'));
    expect(request).toMatchObject({ title: '이 주문을 전액 취소할까요?', confirmLabel: '전액 취소', cancelLabel: ADMIN_CONFIRM_BACK, destructive: true });
  });

  /* 40,000 결제 · 9,500 부분 취소 → 실제 취소는 30,500이다. 확인창이 결제 금액(40,000)을 취소 금액처럼 말하지 않는다. */
  it('전액 취소: 앞서 부분 취소한 주문은 남은 결제 금액과 결제 금액을 함께 말한다', () => {
    const request = adminStaffCancelRequest(order({ total: 40000, payments: [payment({ amount: 40000 })] }), { amount: 30500, paidAmount: 40000 });
    expect(request.message).toBe([
      '주문 2026102710000042 · maple_fan · ₩30,500',
      `토스 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 ₩30,500을 취소합니다(결제 금액 ₩40,000). ${CONSEQUENCE}`,
    ].join('\n'));
    expect(adminStaffCancelRequest(order(), { amount: 0, paidAmount: 32000 }).message).toBe([
      '주문 2026102710000042 · maple_fan · ₩0',
      `토스 결제는 앞서 모두 취소해 더 취소할 금액이 없습니다. 결제사 취소 없이 주문을 취소합니다. ${CONSEQUENCE}`,
    ].join('\n'));
  });

  it('전액 취소: 금액을 읽지 못했으면 금액을 지어내지 않고, 읽지 못했다고 말한 뒤 진행할지 묻는다', () => {
    const request = adminStaffCancelRequest(order(), null);
    expect(request.message).toBe([
      '주문 2026102710000042 · maple_fan',
      `${ADMIN_CANCEL_AMOUNT_UNREAD} 그대로 진행하면 토스 결제에 남아 있는 금액을 모두 취소합니다. ${CONSEQUENCE}`,
      ADMIN_CANCEL_AMOUNT_RETRY,
    ].join('\n'));
    expect(ADMIN_CANCEL_AMOUNT_UNREAD).toBe('지금 취소 금액을 읽지 못했습니다.');
    expect(request.message).not.toContain('₩');
    expect(request).toMatchObject({ confirmLabel: '금액 확인 없이 전액 취소', cancelLabel: ADMIN_CONFIRM_BACK, destructive: true });
  });

  it('화면이 받은 결제 금액은 결제완료 결제의 합이고, 실패한 결제는 더하지 않는다(취소 금액은 누르는 시점에 따로 읽는다)', () => {
    const multi = order({ total: 50000, payments: [payment({ id: 'a', amount: 18000 }), payment({ id: 'b', amount: 12000 }), payment({ id: 'c', amount: 99000, status: 'failed' })] });
    expect(adminOrderCancelAmount(multi)).toBe(30000);
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
    const full = { amount: 32000, paidAmount: 32000 };
    expect(adminStaffCancelRequest(order({ payments: [payment({ provider: 'nicepay' })] }), full).message).toContain('\n나이스페이 결제를 전액 취소합니다.');
    expect(adminStaffCancelRequest(order({ payments: [payment({ provider: 'korpay' })] }), full).message).toContain('\n결제를 전액 취소합니다.');
  });

  it('가상계좌 결제는 환불이 고객 환불 계좌로 나가고 계좌가 없으면 멈춘다는 사실을 덧붙인다', () => {
    const request = adminStaffCancelRequest(order({ virtualAccount: { state: 'deposited' } }), { amount: 32000, paidAmount: 32000 });
    expect(request.message.split('\n')).toEqual([
      '주문 2026102710000042 · maple_fan · ₩32,000',
      `토스 가상계좌 결제를 전액 취소합니다. ${CONSEQUENCE}`,
      ADMIN_VIRTUAL_ACCOUNT_REFUND_NOTE,
    ]);
    expect(adminStaffCancelRequest(order({ virtualAccount: { state: 'deposited' } }), null).message.split('\n')[2]).toBe(ADMIN_VIRTUAL_ACCOUNT_REFUND_NOTE);
    expect(adminStaffCancelRequest(order(), { amount: 32000, paidAmount: 32000 }).message).not.toContain('환불 계좌');
  });

  /*
   * 주문 처리 패널의 취소 승인은 취소·반품·교환 관리의 취소 승인과 같은 문구 함수를 쓴다(lib/admin/claim-approval-confirm).
   * 같은 요청을 어느 화면에서 승인해도 같은 금액·같은 말을 본다.
   */
  describe('취소 승인', () => {
    const target = { orderReference: '2026102710000042', buyerName: 'maple_fan' };

    it('토스·나이스페이: 누르는 시점에 읽은 금액을 말한다 — 앞서 부분 취소한 주문은 남은 결제 금액과 결제 금액을 함께', () => {
      const partial = order({ total: 40000, payments: [payment({ amount: 40000 })] });
      const request = adminCancelApproveRequest(partial, { amount: 30500, paymentProvider: 'toss' });
      expect(request).toEqual(claimPanelConfirmRequest(claimCancelApprovalMoneyConfirm({ autoCancelLabel: '토스', amount: 30500, paidAmount: 40000, target })));
      expect(request).toEqual({
        title: '취소 승인', confirmLabel: '30,500원 취소', cancelLabel: '돌아가기', destructive: true,
        message: [
          '주문 2026102710000042 · 구매자 maple_fan',
          '토스 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 30,500원을 취소합니다(결제 금액 40,000원).',
          '승인하면 바로 결제사에 취소를 요청합니다. 되돌릴 수 없고, 취소가 확인되면 주문 취소·재고 복원까지 함께 끝납니다.',
        ].join('\n'),
      });
      const full = adminCancelApproveRequest(order({ payments: [payment({ provider: 'nicepay' })] }), { amount: 32000, paymentProvider: 'nicepay' });
      expect(full.message.split('\n')[1]).toBe('나이스페이 결제 전액 32,000원을 취소합니다.');
      expect(full.message).not.toContain('반품 물건');
    });

    it('결제 금액의 기준은 실패하지 않은 가장 최근 결제다', () => {
      const retried = order({ payments: [payment({ id: 'old', amount: 99000, status: 'failed' }), payment({ id: 'new', amount: 40000 })] });
      expect(adminCancelApproveRequest(retried, { amount: 30500, paymentProvider: 'toss' }).message).toContain('(결제 금액 40,000원)');
    });

    it('결제 전 주문: 바로 주문이 취소된다고 말한다(취소 관리와 같은 문장)', () => {
      const request = adminCancelApproveRequest(order({ payments: [] }), { amount: null, paymentProvider: null });
      expect(request).toEqual(claimPanelConfirmRequest(claimCancelApprovalConfirm(null, target)));
      expect(request.message).toBe('주문 2026102710000042 · 구매자 maple_fan\n취소를 승인할까요? 결제 전 주문은 바로 주문이 취소되고 되돌릴 수 없습니다.');
      expect(request).toMatchObject({ confirmLabel: '승인하고 주문 취소', destructive: true });
    });

    /* 이 화면의 승인은 결제와 관계없이 결제 취소 확정까지 시도한다. 결제사 취소가 없는 결제는 확정되지 않아 요청이 결제확인필요로 남는다. */
    it.each([
      ['bank_transfer', '취소를 승인할까요? 승인 뒤 환불계좌 송금 절차로 진행합니다.'],
      ['korpay', '취소를 승인할까요? 승인 뒤 코페이 취소 접수와 환불 완료 확정으로 진행합니다.'],
    ])('%s: 취소 관리와 같은 문장에, 이 화면에서 승인하면 생기는 일을 덧붙인다', (provider, sentence) => {
      const request = adminCancelApproveRequest(order({ payments: [payment({ provider })] }), { amount: 32000, paymentProvider: provider });
      expect(request.message.split('\n')).toEqual(['주문 2026102710000042 · 구매자 maple_fan', sentence, ADMIN_CANCEL_APPROVE_MANUAL_NOTE]);
      expect(request.message).toContain(claimCancelApprovalConfirm(provider, target).message);
      expect(request).toMatchObject({ title: '취소 승인', confirmLabel: '승인하고 환불 처리 시작', cancelLabel: '돌아가기' });
      expect(request.destructive).toBeUndefined();
      expect(request.message).not.toContain('원을 취소');
    });

    it('이 화면에서 승인하면 생기는 일은 화면에 보이는 이름으로 말한다', () => {
      expect(ADMIN_CANCEL_APPROVE_MANUAL_NOTE).toBe("이 화면에서 승인하면 요청이 '결제확인필요'로 바뀝니다. 승인만으로는 주문이 취소되지 않고 재고도 그대로입니다. 환불은 취소·반품·교환 관리에서 이 요청을 열어 이어서 합니다.");
    });

    it.each([
      ['읽지 못함', null],
      ['결제사 취소인데 금액이 없음', { amount: null, paymentProvider: 'toss' }],
    ])('금액을 읽지 못했으면(%s) 금액을 지어내지 않고, 읽지 못했다고 말한 뒤 진행할지 묻는다', (_label, approval) => {
      const request = adminCancelApproveRequest(order(), approval);
      expect(request.message).toBe([
        '주문 2026102710000042 · 구매자 maple_fan',
        `${ADMIN_CANCEL_AMOUNT_UNREAD} 그대로 승인하면 토스 결제는 남은 결제 금액을 모두 바로 취소하고 되돌릴 수 없습니다.`,
        ADMIN_CANCEL_AMOUNT_RETRY,
      ].join('\n'));
      expect(request.message).not.toMatch(/₩|\d원/);
      expect(request).toMatchObject({ title: '취소 승인', confirmLabel: '금액 확인 없이 승인', cancelLabel: '돌아가기', destructive: true });
      /* 화면이 결제사를 모르면 결제사 이름을 단정하지 않는다. */
      expect(adminCancelApproveRequest(order({ payments: [payment({ provider: 'bank_transfer' })] }), null).message)
        .toContain('그대로 승인하면 결제사에서 바로 취소되는 결제(토스·나이스페이)는 남은 결제 금액을 모두 바로 취소하고 되돌릴 수 없습니다.');
    });
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
      adminStaffCancelRequest(order(), { amount: 30500, paidAmount: 40000 }), adminStaffCancelRequest(order(), null),
      adminCancelApproveRequest(order(), { amount: 30500, paymentProvider: 'toss' }), adminCancelApproveRequest(order(), null),
      adminCancelApproveRequest(order(), { amount: 32000, paymentProvider: 'bank_transfer' }), adminCancelApproveRequest(order(), { amount: null, paymentProvider: null }),
      adminCancelRejectRequest(order()), adminOrderConfirmRequest(order()),
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
