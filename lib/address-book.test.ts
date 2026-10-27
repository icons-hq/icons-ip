import { describe, expect, it } from 'vitest';
import {
  ADDRESS_BOOK_ERROR_COPY,
  ADDRESS_BOOK_LIMIT,
  addressBookAddressLine,
  addressBookDraftErrors,
  addressBookDraftFromCheckout,
  addressBookEntryMatches,
  addressBookEntryToCheckout,
  addressBookOnboardingPath,
  addressBookSaveInput,
  checkoutAddressPrefillNotice,
  defaultAddressBookEntry,
  emptyAddressBookDraft,
  mapAddressBookError,
  maskAddressBookPhone,
  matchingAddressBookEntry,
  orderAddressBook,
  parseAddressBookDraft,
  parseAddressBookRow,
  sameCheckoutDestination,
  type AddressBookDraft,
  type AddressBookEntry,
} from './address-book';
import { checkoutAddressErrors } from './checkout';

const home: AddressBookEntry = {
  id: '7a570000-0000-4000-8000-000000000001', label: '집', recipientName: '홍길동', phone: '01012345678',
  postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동 1203호', isDefault: true,
};
const office: AddressBookEntry = { ...home, id: '7a570000-0000-4000-8000-000000000002', label: '회사', address1: '서울 강남구 테헤란로 152', address2: null, isDefault: false };

function draft(patch: Partial<AddressBookDraft> = {}): AddressBookDraft {
  return { label: '집', recipientName: '홍길동', phone: '010-1234-5678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '', makeDefault: false, ...patch };
}

describe('주소록 입력 검증', () => {
  it('주문서와 같은 배송지 문장을 쓰고 배송지 이름 규칙을 더한다', () => {
    const empty = emptyAddressBookDraft();
    const errors = addressBookDraftErrors(empty);
    const checkout = checkoutAddressErrors({ recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote: '' });

    expect(errors.label).toBe('배송지 이름을 입력해주세요.');
    for (const field of ['recipientName', 'phone', 'postalCode', 'address1'] as const) expect(errors[field]).toBe(checkout[field]);
    expect(addressBookDraftErrors(draft({ label: '가'.repeat(21) })).label).toBe('배송지 이름은 20자 이하로 입력해주세요.');
    expect(addressBookDraftErrors(draft({ label: '가'.repeat(20) })).label).toBeUndefined();
    /* 서로게이트 쌍도 한 글자로 센다(DB char_length 와 같은 기준). */
    expect(addressBookDraftErrors(draft({ label: '😀'.repeat(20) })).label).toBeUndefined();
    expect(addressBookDraftErrors(draft({ label: '집\n회사' })).label).toBe('배송지 이름에 쓸 수 없는 문자가 있어요.');
    expect(addressBookDraftErrors(draft({ address1: '서울\t중구' })).address1).toBe('쓸 수 없는 문자가 있어요.');
    expect(addressBookDraftErrors(draft())).toEqual({});
  });

  it('서버로는 주문 배송지와 같은 정규화 값(연락처 숫자만·앞뒤 공백 제거·빈 상세 주소 생략)만 보낸다', () => {
    expect(addressBookSaveInput(draft({ label: '  집 ', recipientName: ' 홍길동 ', address2: '   ', makeDefault: true }))).toEqual({
      label: '집',
      address: { recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110' },
      makeDefault: true,
    });
    expect(addressBookSaveInput(draft({ address2: ' 101동 ' }))?.address.address2).toBe('101동');
    expect(addressBookSaveInput(draft({ phone: '1234' }))).toBeNull();
    expect(addressBookSaveInput(draft({ postalCode: '4524' }))).toBeNull();
    expect(addressBookSaveInput(draft({ label: '' }))).toBeNull();
  });

  it('액션 경계에서 받은 값의 모양을 좁히고 배송 메모 같은 다른 키는 버린다', () => {
    expect(parseAddressBookDraft({ ...draft(), deliveryNote: '문 앞', makeDefault: true })).toEqual({ ...draft(), makeDefault: true });
    expect(parseAddressBookDraft({ ...draft(), address2: undefined })).toEqual({ ...draft(), address2: '' });
    expect(parseAddressBookDraft({ ...draft(), phone: 1012345678 })).toBeNull();
    expect(parseAddressBookDraft({ ...draft(), makeDefault: 'yes' })).toBeNull();
    expect(parseAddressBookDraft(null)).toBeNull();
    expect(parseAddressBookDraft([draft()])).toBeNull();
  });
});

describe('주소록 읽기 모델', () => {
  it('DB 행을 화면 모델로 옮기고 모양이 틀린 행은 버린다', () => {
    expect(parseAddressBookRow({ id: home.id, label: '집', recipient_name: '홍길동', phone: '01012345678', postal_code: '04524',
      address1: '서울 중구 세종대로 110', address2: null, is_default: false, created_at: '2026-10-27T00:00:00Z' }))
      .toEqual({ ...home, address2: null, isDefault: false });
    expect(parseAddressBookRow({ id: home.id, label: '집', recipient_name: '홍길동', phone: 1, postal_code: '04524', address1: 'x', address2: null, is_default: false })).toBeNull();
    expect(parseAddressBookRow(null)).toBeNull();
  });

  it('기본 배송지를 맨 앞에 두고 나머지는 등록 순서를 지킨다', () => {
    const third = { ...office, id: '7a570000-0000-4000-8000-000000000003', label: '부모님 댁' };
    expect(orderAddressBook([office, home, third]).map((entry) => entry.label)).toEqual(['집', '회사', '부모님 댁']);
    expect(defaultAddressBookEntry([office, home])).toBe(home);
    expect(defaultAddressBookEntry([office])).toBeNull();
    expect(defaultAddressBookEntry(null)).toBeNull();
  });
});

describe('주문서와 주소록', () => {
  it('고른 배송지로 주문서 배송지를 채우되 배송 메모는 주문서 값을 둔다', () => {
    expect(addressBookEntryToCheckout(home, '문 앞')).toEqual({
      recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동 1203호', deliveryNote: '문 앞',
    });
    expect(addressBookEntryToCheckout(office).address2).toBe('');
  });

  it('같은 배송지 판정은 배송 메모를 보지 않고 연락처는 숫자만 비교한다', () => {
    const typed = { recipientName: ' 홍길동', phone: '010-1234-5678', postalCode: '04524', address1: '서울 중구 세종대로 110 ', address2: '101동 1203호', deliveryNote: '부재 시 경비실' };
    expect(addressBookEntryMatches(home, typed)).toBe(true);
    expect(matchingAddressBookEntry([office, home], typed)).toBe(home);
    expect(matchingAddressBookEntry([office, home], { ...typed, address2: '102동' })).toBeNull();
    expect(matchingAddressBookEntry(null, typed)).toBeNull();
    expect(sameCheckoutDestination(typed, { ...typed, deliveryNote: '' })).toBe(true);
    expect(sameCheckoutDestination(typed, { ...typed, phone: '01012345679' })).toBe(false);
  });

  it('같은 배송지가 두 이름으로 있으면 마지막으로 고른 항목을 우선하고, 그 항목이 달라지면 첫 일치로 돌아간다', () => {
    const typed = addressBookEntryToCheckout(home);
    const twin = { ...home, id: '7a570000-0000-4000-8000-0000000000aa', label: '본가', isDefault: false };
    expect(matchingAddressBookEntry([home, twin], typed)).toBe(home);
    expect(matchingAddressBookEntry([home, twin], typed, twin.id)).toBe(twin);
    expect(matchingAddressBookEntry([home, twin], addressBookEntryToCheckout(office), twin.id)).toBeNull();
    expect(matchingAddressBookEntry([home, office], addressBookEntryToCheckout(office), home.id)).toBe(office);
    expect(matchingAddressBookEntry([home, twin], typed, 'missing')).toBe(home);
  });

  it('주문서 폼 값을 주소록 입력으로 옮길 때 배송 메모를 담지 않는다', () => {
    const value = addressBookDraftFromCheckout({ ...addressBookEntryToCheckout(home), deliveryNote: '문 앞' }, '집', true);
    expect(value).toEqual({ label: '집', recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울 중구 세종대로 110', address2: '101동 1203호', makeDefault: true });
    expect(Object.keys(value)).not.toContain('deliveryNote');
  });

  it('무엇으로 미리 채웠는지 사실대로 안내한다(S6a)', () => {
    expect(checkoutAddressPrefillNotice('address_book')).toBe('주소록의 기본 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.');
    expect(checkoutAddressPrefillNotice('recent_order')).toBe('최근 결제한 주문의 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.');
    expect(checkoutAddressPrefillNotice(null)).toBeNull();
  });
});

describe('표시·오류·경로', () => {
  it('목록의 연락처는 가운데를 가리고 주소는 우편번호와 한 줄로 보인다', () => {
    expect(maskAddressBookPhone('01012345678')).toBe('010-****-5678');
    expect(maskAddressBookPhone('0212345678')).toBe('02-****-5678');
    expect(maskAddressBookPhone('123')).toBe('****');
    /* 짧은 번호도 4자리 이상을 가린다(8자리 대표번호·9자리 02 번호). */
    expect(maskAddressBookPhone('15881234')).toBe('****-1234');
    expect(maskAddressBookPhone('1588-1234')).toBe('****-1234');
    expect(maskAddressBookPhone('021234567')).toBe('****-4567');
    /* 10자리 비-02 번호(경기 031·옛 011)는 앞자리를 자르면 다른 번호로 읽힌다 — 앞자리를 감추고 끝 4자리만 남긴다. */
    expect(maskAddressBookPhone('0311234567')).toBe('****-4567');
    expect(maskAddressBookPhone('031-123-4567')).toBe('****-4567');
    expect(maskAddressBookPhone('0111234567')).toBe('****-4567');
    expect(maskAddressBookPhone('03112345678')).toBe('031-****-5678');
    expect(maskAddressBookPhone('010123456789012')).toBe('010-****-9012');
    for (const phone of ['15881234', '021234567', '0212345678', '0311234567', '0111234567', '01012345678', '010123456789012']) {
      /* 보이는 앞자리는 잘리지 않은 지역·통신 번호(02·3자리) 그대로다. */
      const masked = maskAddressBookPhone(phone);
      if (masked.includes('-****-')) expect(masked.split('-****-')[0]).toBe(phone.startsWith('02') ? '02' : phone.slice(0, 3));
      const shown = maskAddressBookPhone(phone).replace(/[^0-9]/g, '');
      expect(phone.length - shown.length).toBeGreaterThanOrEqual(4);
    }
    expect(addressBookAddressLine(home)).toBe('(04524) 서울 중구 세종대로 110 101동 1203호');
    expect(addressBookAddressLine(office)).toBe('(04524) 서울 강남구 테헤란로 152');
  });

  it('RPC 오류를 화면 코드로 옮기고 원문·입력값을 문구에 싣지 않는다', () => {
    expect(mapAddressBookError('address_book_full')).toBe('address_book_full');
    expect(mapAddressBookError('account_deletion_write_fenced')).toBe('account_deletion_write_fenced');
    expect(mapAddressBookError('address_book_entry_missing')).toBe('address_book_entry_missing');
    expect(mapAddressBookError('address_book_invalid')).toBe('address_book_invalid');
    expect(mapAddressBookError('auth_required')).toBe('auth_required');
    expect(mapAddressBookError('duplicate key value violates unique constraint "address_book_entries_one_default"')).toBe('unavailable');
    expect(mapAddressBookError(undefined)).toBe('unavailable');
    expect(ADDRESS_BOOK_ERROR_COPY.address_book_full).toContain(`최대 ${ADDRESS_BOOK_LIMIT}개`);
    for (const copy of Object.values(ADDRESS_BOOK_ERROR_COPY)) expect(copy).not.toMatch(/\d{4}/);
  });

  it('온보딩 뒤 배송지 안내 경로는 안전한 next 만 싣는다', () => {
    expect(addressBookOnboardingPath('/checkout')).toBe('/onboarding/address?next=%2Fcheckout');
    expect(addressBookOnboardingPath('//evil.example')).toBe('/onboarding/address?next=%2F');
    expect(addressBookOnboardingPath('https://evil.example/x')).toBe('/onboarding/address?next=%2F');
  });
});
