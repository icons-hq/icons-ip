import { describe, expect, it } from 'vitest';
import type { AddressBookEntry } from './address-book';
import type { CheckoutAddress } from './checkout';
import {
  checkoutAddressSaveAvailability,
  checkoutAddressSaveDraft,
  checkoutDestinationErrors,
  emptyCheckoutDestination,
  formatCheckoutPhone,
  initialCheckoutAddressMode,
  visibleCheckoutAddressMode,
} from './checkout-address-entry';

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', isDefault: true,
};
const address: CheckoutAddress = { recipientName: '김팬', phone: '010-9999-8888', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', deliveryNote: '문 앞' };
const homeAddress: CheckoutAddress = { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동', deliveryNote: '' };
const ten = Array.from({ length: 10 }, (_, index) => ({ ...home, id: `7a570000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`, isDefault: index === 0, address1: `서울 ${index}` }));

/* 주문서 배송지(국내 커머스 관행 맞추기 P1): 미리 채운 배송지는 요약 카드, 없거나 틀리면 입력 칸. */
describe('주문서 배송지 모양', () => {
  it('미리 채운 배송지가 규칙을 통과하면 요약, 없거나 틀리면 입력 칸으로 시작한다', () => {
    expect(initialCheckoutAddressMode(address)).toBe('summary');
    expect(initialCheckoutAddressMode(null)).toBe('form');
    expect(initialCheckoutAddressMode({ ...address, postalCode: '123' })).toBe('form');
    /* 배송 메모는 요약 아래에 늘 보이므로 요약을 펼칠 까닭이 아니다. */
    expect(initialCheckoutAddressMode({ ...address, deliveryNote: '가'.repeat(201) })).toBe('summary');
  });

  it('요약을 골랐어도 배송지가 틀리면 칸을 펼쳐 고치게 한다(제출 오류의 첫 칸이 보이게)', () => {
    expect(visibleCheckoutAddressMode('summary', address)).toBe('summary');
    expect(visibleCheckoutAddressMode('summary', { ...address, phone: '1' })).toBe('form');
    expect(visibleCheckoutAddressMode('form', address)).toBe('form');
    expect(checkoutDestinationErrors({ ...address, deliveryNote: '가'.repeat(201) })).toEqual({});
  });

  it('요약 카드 연락처는 지역·통신 번호 길이대로 하이픈을 넣고, 모르는 길이는 적은 그대로 둔다', () => {
    expect(formatCheckoutPhone('01012345678')).toBe('010-1234-5678');
    expect(formatCheckoutPhone('010-1234-5678')).toBe('010-1234-5678');
    expect(formatCheckoutPhone('0311234567')).toBe('031-123-4567');
    expect(formatCheckoutPhone('0212345678')).toBe('02-1234-5678');
    expect(formatCheckoutPhone('021234567')).toBe('02-123-4567');
    expect(formatCheckoutPhone(' 15881234 ')).toBe('15881234');
  });

  it('직접 입력은 빈 칸에서 시작하고 배송 메모는 둔다', () => {
    expect(emptyCheckoutDestination('문 앞')).toEqual({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '문 앞' });
  });
});

/* 체크 하나로 주소록에 저장 — 기본 꺼짐(처리방침의 '주소록 (선택)' 수집), 주문을 만든 뒤에 저장한다. */
describe('주문서에서 주소록 저장', () => {
  it('주소록을 쓸 수 없으면 체크가 없고, 이미 있으면 다시 권하지 않고, 가득 차면 정리 안내를 한다', () => {
    expect(checkoutAddressSaveAvailability(null, address)).toBe('unavailable');
    expect(checkoutAddressSaveAvailability([home], { ...homeAddress, phone: '010-1234-5678', deliveryNote: '다른 메모' })).toBe('saved');
    expect(checkoutAddressSaveAvailability([home], address)).toBe('available');
    expect(checkoutAddressSaveAvailability([], address)).toBe('available');
    expect(checkoutAddressSaveAvailability(ten, address)).toBe('full');
  });

  it('체크했을 때만 저장할 입력을 만들고, 이름은 선택이며 첫 배송지는 기본 배송지가 된다', () => {
    expect(checkoutAddressSaveDraft({ book: [home], address, save: false, label: '' })).toBeNull();
    expect(checkoutAddressSaveDraft({ book: [home], address, save: true, label: '' })).toEqual({
      label: '', recipientName: '김팬', phone: '010-9999-8888', postalCode: '06236', address1: '서울 강남구 테헤란로 152', address2: '', makeDefault: false,
    });
    expect(checkoutAddressSaveDraft({ book: [], address, save: true, label: '회사' })).toMatchObject({ label: '회사', makeDefault: true });
  });

  it('저장할 수 없는 경우(주소록 없음·가득 참·이미 있음·틀린 입력)에는 체크가 켜져 있어도 저장하지 않는다', () => {
    expect(checkoutAddressSaveDraft({ book: null, address, save: true, label: '' })).toBeNull();
    expect(checkoutAddressSaveDraft({ book: ten, address, save: true, label: '' })).toBeNull();
    expect(checkoutAddressSaveDraft({ book: [home], address: homeAddress, save: true, label: '' })).toBeNull();
    expect(checkoutAddressSaveDraft({ book: [home], address, save: true, label: '집\n회사' })).toBeNull();
  });
});
