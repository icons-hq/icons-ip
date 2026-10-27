import { safeNextPath } from './auth/onboarding';
import { checkoutAddressErrors, normalizeCheckoutAddress, type CheckoutAddress } from './checkout';
import { PRIVACY_ADDRESS_BOOK_REVISION, koreanLegalDate, kstToday } from './legal/privacy-address-book-revision';

/*
 * 주소록(LFS 패리티 2차 L7 · MY-11, 10/14 S6b·S3·S6a) — CONTEXT.md **주소록**.
 *
 * 회원이 저장해 두는 배송지 목록이다. 주문서에서 골라 채우는 입력 보조일 뿐이고, 주문에 저장되는 배송지는
 * 주문할 때 폼에 적힌 사본이다(주문 주소 JSON 계약 그대로). 선물 수령인 주소는 담지 않는다.
 * DB 계약(본인만 읽기·RPC 쓰기·온보딩 회원만 저장·회원당 10개·기본 배송지 1개·탈퇴 시 삭제)은
 * supabase/migrations/20261027160000_address_book.sql 이 정본이다. 이 모듈은 화면·액션이 함께 쓰는
 * 순수 규칙(검증·정규화·표시·오류 문구)만 둔다.
 */

export const ADDRESS_BOOK_PATH = '/my/addresses';
/** 회원당 최대 개수 — DB RPC(save_my_address_book_entry)와 같은 값이다. */
export const ADDRESS_BOOK_LIMIT = 10;
/** 배송지 이름(별칭) 최대 글자 수 — DB 제약과 같은 값이다. */
export const ADDRESS_BOOK_LABEL_MAX = 20;
/** 온보딩 직후 배송지 등록 안내(건너뛸 수 있음) 경로. */
export const ADDRESS_BOOK_ONBOARDING_PATH = '/onboarding/address';

/**
 * 주소록을 여는 날(KST) — 개인정보처리방침 주소록 개정의 시행일과 같다. 그 전에는 방침이 주소록 수집을 아직 고지하지
 * 않으므로(사전 공지 기간) 회원의 배송지를 주소록에 받지 않는다. 날짜는 lib/legal/privacy-address-book-revision.ts 가 정본이다.
 */
export const ADDRESS_BOOK_OPENS_ON: string = PRIVACY_ADDRESS_BOOK_REVISION.effectiveDate;

/**
 * 이 사람에게 주소록(배송지 관리 화면·주문서 고르기·저장·온보딩 안내)이 열려 있는가. 여는 날부터 모두에게, 그 전에는
 * 정지되지 않은 staff/admin 미리보기만(auth.isStaff — 커뮤니티 스태프 프리뷰와 같은 경계). 서버(화면·액션)가 판정한다.
 */
export function addressBookOpenFor(viewer: { isStaff: boolean }, today: string = kstToday()): boolean {
  return today >= ADDRESS_BOOK_OPENS_ON || viewer.isStaff === true;
}

/** '2026년 11월 6일' — 여는 날 안내 문구용. */
export const ADDRESS_BOOK_OPENS_ON_LABEL = koreanLegalDate(ADDRESS_BOOK_OPENS_ON);

export interface AddressBookEntry {
  id: string;
  /** 배송지 이름(별칭) — '집', '회사'처럼 회원이 붙인 이름. */
  label: string;
  recipientName: string;
  /** 숫자만 저장한다(주문 배송지와 같은 정규화). 화면은 maskAddressBookPhone 으로 가린다. */
  phone: string;
  postalCode: string;
  address1: string;
  address2: string | null;
  isDefault: boolean;
}

/** 폼이 들고 있는 입력값. 서버로 보내기 전에 addressBookSaveInput 으로 정규화한다. */
export interface AddressBookDraft {
  label: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string;
  makeDefault: boolean;
}

export type AddressBookDraftField = 'label' | 'recipientName' | 'phone' | 'postalCode' | 'address1' | 'address2';
export type AddressBookDraftErrors = Partial<Record<AddressBookDraftField, string>>;

/** 화면 입력 순서 — 첫 오류 칸으로 포커스를 옮길 때 쓴다. */
export const ADDRESS_BOOK_DRAFT_FIELDS: readonly AddressBookDraftField[] = [
  'label', 'recipientName', 'phone', 'postalCode', 'address1', 'address2',
];

/** 배송지 JSON 의 키(배송 메모 제외) — DB 정규화(private.normalize_order_address_change)가 받는 모양이다. */
export interface AddressBookAddressInput {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
}

export interface AddressBookSaveInput {
  label: string;
  address: AddressBookAddressInput;
  makeDefault: boolean;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function emptyAddressBookDraft(makeDefault = false): AddressBookDraft {
  return { label: '', recipientName: '', phone: '', postalCode: '', address1: '', address2: '', makeDefault };
}

export function addressBookDraftFromEntry(entry: AddressBookEntry): AddressBookDraft {
  return {
    label: entry.label,
    recipientName: entry.recipientName,
    phone: entry.phone,
    postalCode: entry.postalCode,
    address1: entry.address1,
    address2: entry.address2 ?? '',
    makeDefault: entry.isDefault,
  };
}

/** 주문서 폼의 배송지를 주소록 입력으로 옮긴다(배송 메모는 주문마다 다르므로 담지 않는다). */
export function addressBookDraftFromCheckout(address: CheckoutAddress, label: string, makeDefault: boolean): AddressBookDraft {
  return {
    label,
    recipientName: address.recipientName,
    phone: address.phone,
    postalCode: address.postalCode,
    address1: address.address1,
    address2: address.address2 ?? '',
    makeDefault,
  };
}

/**
 * 폼 검증 — 주문서와 같은 배송지 규칙(checkoutAddressErrors)에 배송지 이름 규칙을 더한다.
 * 같은 문장을 써야 주문서에서 통과한 주소가 주소록에서 거절되지 않는다.
 */
export function addressBookDraftErrors(draft: AddressBookDraft): AddressBookDraftErrors {
  const errors: AddressBookDraftErrors = {};
  const label = draft.label.trim();
  if (!label) errors.label = '배송지 이름을 입력해주세요.';
  else if ([...label].length > ADDRESS_BOOK_LABEL_MAX) errors.label = `배송지 이름은 ${ADDRESS_BOOK_LABEL_MAX}자 이하로 입력해주세요.`;
  else if (CONTROL_CHARACTERS.test(label)) errors.label = '배송지 이름에 쓸 수 없는 문자가 있어요.';

  const address = checkoutAddressErrors({
    recipientName: draft.recipientName,
    phone: draft.phone,
    postalCode: draft.postalCode,
    address1: draft.address1,
    address2: draft.address2,
    deliveryNote: '',
  });
  for (const field of ['recipientName', 'phone', 'postalCode', 'address1', 'address2'] as const) {
    if (address[field]) errors[field] = address[field];
  }
  for (const field of ['recipientName', 'address1', 'address2'] as const) {
    if (!errors[field] && CONTROL_CHARACTERS.test(draft[field])) errors[field] = '쓸 수 없는 문자가 있어요.';
  }
  return errors;
}

/** 서버로 보낼 정규화된 입력. 검증을 통과하지 못하면 null — 액션은 RPC 를 부르지 않는다. */
export function addressBookSaveInput(draft: AddressBookDraft): AddressBookSaveInput | null {
  if (Object.keys(addressBookDraftErrors(draft)).length > 0) return null;
  const address2 = draft.address2.trim();
  const normalized = normalizeCheckoutAddress({
    recipientName: draft.recipientName,
    phone: draft.phone,
    postalCode: draft.postalCode,
    address1: draft.address1,
    ...(address2 ? { address2 } : {}),
  });
  if (!normalized) return null;
  return {
    label: draft.label.trim(),
    address: {
      recipientName: normalized.recipientName,
      phone: normalized.phone,
      postalCode: normalized.postalCode,
      address1: normalized.address1,
      ...(normalized.address2 ? { address2: normalized.address2 } : {}),
    },
    makeDefault: draft.makeDefault === true,
  };
}

/** 액션 경계에서 받은 값(unknown)을 폼 입력으로 좁힌다. 모양이 틀리면 null. */
export function parseAddressBookDraft(value: unknown): AddressBookDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string, optional = false) => {
    const field = record[key];
    if (field === undefined && optional) return '';
    return typeof field === 'string' ? field : null;
  };
  const draft = {
    label: text('label'),
    recipientName: text('recipientName'),
    phone: text('phone'),
    postalCode: text('postalCode'),
    address1: text('address1'),
    address2: text('address2', true),
  };
  if (Object.values(draft).some((field) => field === null)) return null;
  if (record.makeDefault !== undefined && typeof record.makeDefault !== 'boolean') return null;
  return { ...(draft as Omit<AddressBookDraft, 'makeDefault'>), makeDefault: record.makeDefault === true };
}

interface AddressBookRow {
  id: unknown;
  label: unknown;
  recipient_name: unknown;
  phone: unknown;
  postal_code: unknown;
  address1: unknown;
  address2: unknown;
  is_default: unknown;
}

/** DB 행 → 화면 모델. 모양이 틀린 행은 null(목록에서 뺀다). */
export function parseAddressBookRow(row: unknown): AddressBookEntry | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = row as AddressBookRow;
  if (typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.recipient_name !== 'string'
    || typeof value.phone !== 'string' || typeof value.postal_code !== 'string' || typeof value.address1 !== 'string'
    || (value.address2 !== null && typeof value.address2 !== 'string') || typeof value.is_default !== 'boolean') return null;
  return {
    id: value.id,
    label: value.label,
    recipientName: value.recipient_name,
    phone: value.phone,
    postalCode: value.postal_code,
    address1: value.address1,
    address2: value.address2 || null,
    isDefault: value.is_default,
  };
}

/** 기본 배송지 먼저, 나머지는 받은 순서(등록 순) 그대로. */
export function orderAddressBook(entries: readonly AddressBookEntry[]): AddressBookEntry[] {
  return [...entries.filter((entry) => entry.isDefault), ...entries.filter((entry) => !entry.isDefault)];
}

export function defaultAddressBookEntry(entries: readonly AddressBookEntry[] | null): AddressBookEntry | null {
  return entries?.find((entry) => entry.isDefault) ?? null;
}

/** 주소록 항목을 주문서 배송지로 옮긴다. 배송 메모는 주문서에 적어 둔 값을 그대로 둔다. */
export function addressBookEntryToCheckout(entry: AddressBookEntry, deliveryNote = ''): CheckoutAddress {
  return {
    recipientName: entry.recipientName,
    phone: entry.phone,
    postalCode: entry.postalCode,
    address1: entry.address1,
    address2: entry.address2 ?? '',
    deliveryNote,
  };
}

/** 두 배송지가 같은 곳인가 — 받는 분·연락처(숫자만)·우편번호·주소. 배송 메모는 보지 않는다. */
export function sameCheckoutDestination(left: CheckoutAddress, right: CheckoutAddress): boolean {
  return left.recipientName.trim() === right.recipientName.trim()
    && left.phone.replace(/\D/g, '') === right.phone.replace(/\D/g, '')
    && left.postalCode.trim() === right.postalCode.trim()
    && left.address1.trim() === right.address1.trim()
    && (left.address2 ?? '').trim() === (right.address2 ?? '').trim();
}

/** 주문서 폼의 배송지가 이 주소록 항목과 같은 곳인가. */
export function addressBookEntryMatches(entry: AddressBookEntry, address: CheckoutAddress): boolean {
  return sameCheckoutDestination(addressBookEntryToCheckout(entry), address);
}

/**
 * 폼 배송지와 같은 주소록 항목. 같은 배송지를 두 이름으로 저장했을 수 있으니, 회원이 마지막으로 고른 항목(preferredId)이
 * 여전히 같으면 그 항목을 우선하고, 아니면 목록 순서(기본 배송지 먼저)의 첫 항목이다.
 */
export function matchingAddressBookEntry(
  entries: readonly AddressBookEntry[] | null,
  address: CheckoutAddress,
  preferredId: string | null = null,
): AddressBookEntry | null {
  if (!entries) return null;
  const preferred = preferredId ? entries.find((entry) => entry.id === preferredId) : undefined;
  if (preferred && addressBookEntryMatches(preferred, address)) return preferred;
  return entries.find((entry) => addressBookEntryMatches(entry, address)) ?? null;
}

/**
 * 목록·선택지에 보이는 연락처 — 가운데를 가린다(전체 번호는 수정 폼에서만 보인다).
 * 개인정보를 화면에 불필요하게 늘어놓지 않기 위해서다. 언제나 4자리 이상을 가린다: 앞자리(지역·통신 번호 — 02 는 2자리,
 * 나머지는 3자리)는 그 자리를 통째로 보이고도 가운데 4자리 이상이 남을 때만(010·02 의 표준 길이) 보인다. 앞자리를
 * 잘라 보이면 다른 번호처럼 읽히므로(031 → '03', 011 → '01') 그때와 짧은 번호(8~9자리)는 끝 4자리만 남긴다.
 * '****'는 자릿수를 드러내지 않는 고정 표시다.
 */
export function maskAddressBookPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '****';
  const tail = digits.slice(-4);
  const prefix = digits.startsWith('02') ? 2 : 3;
  return digits.length - prefix >= 8 ? `${digits.slice(0, prefix)}-****-${tail}` : `****-${tail}`;
}

/** '(04524) 서울 중구 세종대로 110 101동' — 우편번호와 주소 한 줄. */
export function addressBookAddressLine(entry: Pick<AddressBookEntry, 'postalCode' | 'address1' | 'address2'>): string {
  return `(${entry.postalCode}) ${entry.address1}${entry.address2 ? ` ${entry.address2}` : ''}`;
}

export type AddressBookErrorCode =
  | 'auth_required'
  | 'onboarding_required'
  | 'account_suspended'
  | 'account_deletion_write_fenced'
  | 'address_book_full'
  | 'address_book_invalid'
  | 'address_book_entry_missing'
  | 'address_book_not_open'
  | 'unavailable';

/* 연락처·주소 같은 입력값은 오류 문구에 싣지 않는다. */
export const ADDRESS_BOOK_ERROR_COPY: Record<AddressBookErrorCode, string> = {
  auth_required: '로그인이 만료됐어요. 다시 로그인해주세요.',
  onboarding_required: '프로필 설정을 먼저 완료해주세요.',
  account_suspended: '정지된 계정은 배송지를 저장하거나 바꿀 수 없어요.',
  account_deletion_write_fenced: '탈퇴 처리 중인 계정에서는 이용할 수 없어요.',
  address_book_full: `배송지는 최대 ${ADDRESS_BOOK_LIMIT}개까지 저장할 수 있어요. 쓰지 않는 배송지를 지운 뒤 다시 시도해주세요.`,
  address_book_invalid: '배송지 정보를 다시 확인해주세요.',
  address_book_entry_missing: '배송지를 찾지 못했어요. 새로고침한 뒤 다시 시도해주세요.',
  address_book_not_open: `배송지 저장은 ${ADDRESS_BOOK_OPENS_ON_LABEL}부터 이용할 수 있어요.`,
  unavailable: '배송지를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.',
};

/** RPC 오류 메시지 → 화면 코드. 모르는 오류는 unavailable(원문을 노출하지 않는다). */
export function mapAddressBookError(message: unknown): AddressBookErrorCode {
  const text = typeof message === 'string' ? message : '';
  for (const code of ['auth_required', 'onboarding_required', 'account_suspended', 'account_deletion_write_fenced', 'address_book_full', 'address_book_invalid', 'address_book_entry_missing'] as const) {
    if (text.includes(code)) return code;
  }
  return 'unavailable';
}

/** 주문서 배송지를 무엇으로 미리 채웠는지(S6a — 사실대로 안내한다). */
export type CheckoutAddressPrefillSource = 'address_book' | 'recent_order' | null;

export interface CheckoutAddressPrefill {
  /** 주문서 첫 화면의 배송지. 없으면 빈 폼. */
  address: CheckoutAddress | null;
  source: CheckoutAddressPrefillSource;
  /** 주소록. 읽지 못했으면 null — 고르기·저장 UI 를 그리지 않는다(빈 주소록과 구별). */
  book: AddressBookEntry[] | null;
}

export const EMPTY_CHECKOUT_ADDRESS_PREFILL: CheckoutAddressPrefill = { address: null, source: null, book: null };

export function checkoutAddressPrefillNotice(source: CheckoutAddressPrefillSource): string | null {
  if (source === 'address_book') return '주소록의 기본 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.';
  if (source === 'recent_order') return '최근 결제한 주문의 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.';
  return null;
}

/** 온보딩을 마친 뒤 들르는 배송지 등록 안내 — 건너뛰면 원래 가려던 곳(next)으로 간다. */
export function addressBookOnboardingPath(next: string): string {
  return `${ADDRESS_BOOK_ONBOARDING_PATH}?next=${encodeURIComponent(safeNextPath(next))}`;
}
