import { describe, expect, it } from 'vitest';
import { normalizeOrderAddressRequest, orderAddressBlockerMessage, orderAddressChangeLines, orderAddressConfirmMessage, orderAddressError, orderAddressReceiptMatches, parseOrderAddressContext, parseOrderAddressReceipt } from './order-address';
import { orderAddressContextFixture as context, orderAddressReceiptFixture as receipt, orderAddressRequestFixture as request } from './order-address.fixture';
describe('배송지 수정 계약', () => {
  it('Postgres UUID·주소·연락처를 정규화하되 고객 동의와 변경 근거를 요구한다', () => {
    const parsed = normalizeOrderAddressRequest({ ...request, id: request.id.toUpperCase(), address: { ...request.address, phone: '010-0000-0000' }, reason: ` ${request.reason} ` });
    expect(parsed).toEqual({ request });
    for (const input of [{ ...request, agreed: false }, { ...request, reason: '' }, { ...request, reason: 'x'.repeat(501) }, { ...request, revision: -1 }, { ...request, address: { ...request.address, address1: '주소\n주입' } }]) expect(normalizeOrderAddressRequest(input)).toHaveProperty('error');
  });
  it('과거 주문의 빠진 선택 필드는 읽고 손상된 이력·버전·주소는 거절한다', () => {
    expect(parseOrderAddressContext({ ...context, address: { recipientName: '과거 수령자' } })?.address.phone).toBe('');
    for (const input of [{ ...context, revision: '3' }, { ...context, address: { phone: 123 } }, { ...context, history: [{}] }, { ...context, shipmentCount: -1 }]) expect(parseOrderAddressContext(input)).toBeNull();
  });
  it('저장 결과는 요청번호·주문·사유·여섯 주소 필드가 모두 일치해야 수락한다', () => {
    expect(parseOrderAddressReceipt(receipt)).toEqual(receipt); expect(orderAddressReceiptMatches(receipt, request)).toBe(true);
    expect(orderAddressReceiptMatches({ ...receipt, currentMatches: false }, request)).toBe(true);
    for (const changed of [{ ...receipt, reason: '다른 근거' }, { ...receipt, id: context.orderId }, { ...receipt, address: { ...receipt.address, deliveryNote: '다른 메모' } }]) expect(orderAddressReceiptMatches(changed, request)).toBe(false);
    expect(parseOrderAddressReceipt({ ...receipt, address: {} })).toBeNull();
  });
});

/* 어드민 화면 규칙 PR 3: 확인 체크를 없애고 저장 전 확인창이 바뀌는 내용을 말한다. 문구만 다루고 저장 계약은 위 시험이 지킨다. */
describe('배송지 수정 문구', () => {
  const before = context.address;
  it('바뀌는 칸만 이전 → 새 값으로 적고 같은 값이면 줄이 없다', () => {
    expect(orderAddressChangeLines(before, before)).toEqual([]);
    expect(orderAddressChangeLines(before, { ...before, recipientName: '새 수령인', phone: '01099998888' })).toEqual(['수령인: 합성 고객 → 새 수령인', '연락처: 01000000000 → 01099998888']);
    /* 우편번호·기본 주소·상세 주소 어느 것이 바뀌어도 주소 한 줄이고, 비어 있던 칸은 '없음'이다. */
    expect(orderAddressChangeLines(before, { ...before, address2: '' })).toEqual(['주소: (12345) 합성시 검증로 1 101호 → (12345) 합성시 검증로 1']);
    expect(orderAddressChangeLines(before, { ...before, postalCode: '54321' })).toEqual(['주소: (12345) 합성시 검증로 1 101호 → (54321) 합성시 검증로 1 101호']);
    expect(orderAddressChangeLines(before, { ...before, deliveryNote: '문 앞' })).toEqual(['배송 메모: 없음 → 문 앞']);
    /* 저장된 값에 키가 빠진 옛 주문도 빈 값과 같게 비교한다. */
    expect(orderAddressChangeLines({ recipientName: '가', phone: '01011112222', postalCode: '', address1: '옛 주소' }, { recipientName: '가', phone: '01011112222', postalCode: '', address1: '옛 주소', address2: '', deliveryNote: '' })).toEqual([]);
  });
  it('확인창 본문은 주문·적용 범위·요청한 사람·돈이 그대로인 것을 말하고 내부 번호를 쓰지 않는다', () => {
    const after = { ...before, recipientName: '새 수령인' };
    expect(orderAddressConfirmMessage({ orderNumber: '20261126140010000034', shipmentCount: 2 }, before, after)).toBe([
      '주문 20261126140010000034의 배송지를 바꿉니다. 배송 건 2개 모두에 적용됩니다.', '', '수령인: 합성 고객 → 새 수령인', '',
      '구매자가 요청한 변경으로 기록됩니다. 결제금액과 배송비는 그대로입니다.',
    ].join('\n'));
    /* 배송 건이 하나면 범위를 말하지 않고, 번호 없는 옛 주문은 번호 자리를 말로 쓰며, 선물이면 받는 분의 요청으로 적는다. */
    const gift = orderAddressConfirmMessage({ isGift: true, shipmentCount: 1 }, before, after);
    expect(gift).toContain('이 주문의 배송지를 바꿉니다.\n'); expect(gift).not.toContain('배송 건 1개'); expect(gift).toContain('선물 받는 분이 요청한 변경으로 기록됩니다.');
    expect(gift).not.toContain(context.orderId);
  });
  it('바꿀 수 없는 이유와 저장 오류는 운영자 낱말로 말하고 모르는 값은 영문을 그대로 보이지 않는다', () => {
    for (const [blocker, expected] of [['order_not_ready', '신규주문이나 발주확인'], ['order_dispatched', '출고지시를 이미 보냈거나'], ['shipments_missing', '배송 건이 없어'], ['order_claim_open', '취소·반품·교환 요청']] as const) {
      expect(orderAddressBlockerMessage(blocker)).toContain(expected); expect(orderAddressError(undefined, blocker)).toBe(orderAddressBlockerMessage(blocker));
    }
    expect(orderAddressBlockerMessage('brand_new_code')).toBe('지금은 배송지를 바꿀 수 없습니다.'); expect(orderAddressBlockerMessage(null)).toBe('지금은 배송지를 바꿀 수 없습니다.');
    expect(orderAddressError('PT409', undefined)).toBe('다른 사람이 먼저 바꿨습니다. 적은 내용은 그대로 있습니다. [최신 배송지 불러오기]를 누르면 지금 배송지를 다시 불러옵니다.');
    expect(orderAddressError('42501', undefined)).toContain('판매 관리 권한');
    /* 저장 결과를 모를 때는 다른 어드민 화면과 같은 버튼 이름으로 안내한다. */
    expect(orderAddressError(undefined, 'unknown_code')).toContain('[저장됐는지 확인]');
    expect(orderAddressError('23505', 'order_address_request_conflict')).toContain('지금 저장된 내용을 확인한 뒤 다시 저장해 주세요.');
    for (const message of ['order_address_quote_unavailable', 'order_address_region_unavailable', 'order_address_shipping_fee_changed', 'order_address_unchanged', 'invalid_order_address', 'invalid_order_address_change', 'order_not_found']) {
      expect(orderAddressError(undefined, message), message).not.toMatch(/order_|invalid_|수령자|같은 요청|동의 확인란/);
    }
  });
  it('저장 요청의 안내 문구는 화면의 칸 이름과 고칠 방법을 말한다', () => {
    const invalid = normalizeOrderAddressRequest({ ...request, address: { ...request.address, postalCode: '12' } });
    expect(invalid).toEqual({ error: expect.stringContaining('수령인·연락처·우편번호·기본 주소') }); expect(JSON.stringify(invalid)).toContain('우편번호는 숫자 5자리');
    expect(normalizeOrderAddressRequest({ ...request, reason: ' ' })).toEqual({ error: '변경 사유를 1~500자로 적어 주세요.' });
  });
});
