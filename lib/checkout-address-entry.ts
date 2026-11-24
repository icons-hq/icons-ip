import {
  ADDRESS_BOOK_LIMIT,
  addressBookDraftErrors,
  addressBookDraftFromCheckout,
  matchingAddressBookEntry,
  type AddressBookDraft,
  type AddressBookEntry,
} from './address-book';
import { checkoutAddressErrors, type CheckoutAddress, type CheckoutAddressErrors } from './checkout';

/*
 * 주문서 배송지 칸의 순수 규칙(국내 커머스 관행 맞추기 P1, 2026-11-24). 두 주문서(Checkout·GoodsTransactionCheckout)가 같은
 * 부품(CheckoutAddressSection)을 쓰고, 그 부품과 제출 경로가 이 규칙을 함께 읽는다.
 *
 *   · 요약(summary): 미리 채운 배송지(주소록 기본 배송지 → 결제를 마친 직전 주문)나 주소록에서 고른 배송지는 받는 분·연락처·주소
 *     요약 카드로만 보이고 [변경]으로 주소록 목록(시트)을 연다. 배송 메모 칸은 요약 아래에 그대로 둔다.
 *   · 입력(form): 미리 채울 배송지가 없거나, 목록에서 '직접 입력'을 고르거나, 요약 배송지가 지금 규칙을 통과하지 못하면
 *     입력 칸을 펼친다.
 *   · 주소록 저장: 주소록에 없는 배송지면 체크 하나로 저장한다(배송지 이름은 선택 — 비우면 받는 분 이름). 체크는 기본 꺼짐이다 —
 *     처리방침이 주소록을 선택 수집 항목('주소록 (선택)')으로 고지하므로 미리 켜 두지 않는다. 저장은 주문을 만든 뒤에 하고,
 *     실패해도 주문에는 영향이 없다(주소록은 입력 보조다).
 */

export type CheckoutAddressMode = 'summary' | 'form';

/** 받는 분·연락처·우편번호·기본 주소·상세 주소 칸의 오류(배송 메모는 요약 아래에 늘 보이므로 빼고 본다). */
export function checkoutDestinationErrors(address: CheckoutAddress): CheckoutAddressErrors {
  const errors = checkoutAddressErrors(address);
  delete errors.deliveryNote;
  return errors;
}

/** 첫 모양 — 미리 채운 배송지가 있고 지금 규칙을 통과하면 요약, 아니면 입력 칸. */
export function initialCheckoutAddressMode(prefilled: CheckoutAddress | null): CheckoutAddressMode {
  return prefilled && Object.keys(checkoutDestinationErrors(prefilled)).length === 0 ? 'summary' : 'form';
}

/** 지금 그릴 모양 — 요약을 골랐어도 배송지가 규칙을 통과하지 못하면 칸을 펼쳐 고치게 한다. */
export function visibleCheckoutAddressMode(mode: CheckoutAddressMode, address: CheckoutAddress): CheckoutAddressMode {
  return mode === 'summary' && Object.keys(checkoutDestinationErrors(address)).length === 0 ? 'summary' : 'form';
}

/** 요약 카드의 연락처 — 숫자만 저장된 번호를 지역·통신 번호 길이에 맞춰 하이픈으로 나눈다. 모르는 길이는 적은 그대로. */
export function formatCheckoutPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('02')) {
    if (digits.length === 9) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
    if (digits.length === 10) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  } else {
    if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone.trim();
}

/** 빈 배송지(배송 메모는 주문서에 적은 값을 둔다) — 목록에서 '직접 입력'을 고를 때. */
export function emptyCheckoutDestination(deliveryNote = ''): CheckoutAddress {
  return { recipientName: '', phone: '', postalCode: '', address1: '', address2: '', deliveryNote };
}

/**
 * 주소록 저장 체크를 보일 수 있는가.
 *   unavailable — 주소록을 읽지 못했거나 열리지 않았다(체크 없음, 직접 입력으로 주문).
 *   saved — 이미 주소록에 있는 배송지다.
 *   full — 주소록이 가득 찼다(정리 안내).
 *   available — 체크를 보인다.
 */
export type CheckoutAddressSaveAvailability = 'unavailable' | 'saved' | 'full' | 'available';

export function checkoutAddressSaveAvailability(
  book: readonly AddressBookEntry[] | null,
  address: CheckoutAddress,
): CheckoutAddressSaveAvailability {
  if (book === null) return 'unavailable';
  if (matchingAddressBookEntry(book, address)) return 'saved';
  return book.length >= ADDRESS_BOOK_LIMIT ? 'full' : 'available';
}

/**
 * 주문을 만든 뒤 주소록에 저장할 입력. 체크하지 않았거나, 저장할 수 없거나(주소록 없음·가득 참·이미 있음), 입력이 규칙을
 * 통과하지 못하면 null — 저장하지 않는다. 첫 배송지는 기본 배송지가 된다(DB 도 같은 규칙).
 */
export function checkoutAddressSaveDraft(input: {
  book: readonly AddressBookEntry[] | null;
  address: CheckoutAddress;
  save: boolean;
  label: string;
}): AddressBookDraft | null {
  if (!input.save || checkoutAddressSaveAvailability(input.book, input.address) !== 'available') return null;
  const draft = addressBookDraftFromCheckout(input.address, input.label, (input.book?.length ?? 0) === 0);
  return Object.keys(addressBookDraftErrors(draft)).length === 0 ? draft : null;
}
