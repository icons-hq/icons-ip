'use client';

import Link from 'next/link';
import { useState, type KeyboardEvent } from 'react';
import { saveAddressBookEntryAction } from '@/app/my/addresses/actions';
import {
  ADDRESS_BOOK_ERROR_COPY,
  ADDRESS_BOOK_LABEL_MAX,
  ADDRESS_BOOK_LIMIT,
  ADDRESS_BOOK_PATH,
  addressBookAddressLine,
  addressBookDraftErrors,
  addressBookDraftFromCheckout,
  addressBookSaveInput,
  matchingAddressBookEntry,
  type AddressBookEntry,
} from '@/lib/address-book';
import type { CheckoutAddress, CheckoutAddressErrors } from '@/lib/checkout';

/*
 * 주문서의 배송지 선택·추가(LFS 패리티 2차 L7 · MY-11, 10/14 S3). 두 주문서(Checkout·GoodsTransactionCheckout)가
 * 같은 부품을 쓴다.
 *   · 고르기: 주소록 배송지를 고르면 주문서 폼을 그 값으로 채운다(배송 메모는 주문서에 적은 값 그대로).
 *     '새 배송지 입력'을 고르면 폼을 비운다. 선택 상태는 폼 값에서 파생한다 — 고른 뒤 칸을 고치면 '직접 입력'이 된다.
 *     같은 배송지를 두 이름으로 저장했으면 마지막으로 고른 항목을 우선한다.
 *   · 추가: 지금 폼에 적힌 배송지를 주소록에 저장한다. 주문서 form 안이라 별도 form 을 두지 않고, 저장 묶음 안의
 *     Enter(이름 칸·기본 지정 체크박스 — 버튼 제외)가 주문 제출로 새지 않게 저장으로 돌린다. 저장은 주소록 액션이
 *     하고 주문·결제 경로에는 닿지 않는다. 배송지 칸이 틀렸으면 그 칸 이름을 알리고 첫 칸으로 포커스를 옮긴다.
 *   · 포커스: 저장 묶음이 닫히면(저장·취소) 포커스를 주소록 select 나 저장 버튼으로 돌려 키보드 위치를 잃지 않게 한다.
 * 주소록을 읽지 못했으면(null) 아무것도 그리지 않는다 — 주문서는 지금처럼 직접 입력으로 주문할 수 있다.
 */

const ADDRESS_FIELD_ORDER = ['recipientName', 'phone', 'postalCode', 'address1', 'address2'] as const;
const ADDRESS_FIELD_NAMES: Record<(typeof ADDRESS_FIELD_ORDER)[number], string> = {
  recipientName: '받는 분',
  phone: '연락처',
  postalCode: '우편번호',
  address1: '기본 주소',
  address2: '상세 주소',
};
const SELECT_ID = 'checkout-address-book';
const LABEL_ID = 'checkout-address-book-label';
const TOGGLE_ID = 'checkout-address-book-save-toggle';

/** 저장 묶음 안의 Enter 를 주문 제출 대신 저장으로 돌릴지. 버튼(자기 클릭)·IME 조합 중 Enter 는 그대로 둔다. */
export function checkoutAddressBookEnterSaves(key: string, tagName: string, isComposing = false): boolean {
  return key === 'Enter' && !isComposing && tagName !== 'BUTTON' && tagName !== 'A' && tagName !== 'TEXTAREA';
}

/** 주소록 저장 전에 고칠 배송지 칸 — 주문서 칸 이름으로 알린다(입력값은 싣지 않는다). */
export function checkoutAddressBookFieldsCopy(errors: CheckoutAddressErrors): string {
  const names = ADDRESS_FIELD_ORDER.filter((field) => errors[field]).map((field) => ADDRESS_FIELD_NAMES[field]);
  return `주소록에 저장하기 전에 ${names.join('·')} 칸을 확인해주세요.`;
}

function focusLater(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export interface CheckoutAddressBookProps {
  book: AddressBookEntry[] | null;
  address: CheckoutAddress;
  /** 주소록 배송지를 고르면 그 항목, '새 배송지 입력'이면 null. */
  onPick: (entry: AddressBookEntry | null) => void;
  /** 저장하려는 배송지 칸이 틀렸을 때 그 칸 오류(주문서 칸에 오류를 표시하려면 받는다). 포커스는 이 부품이 옮긴다. */
  onAddressErrors?: (errors: CheckoutAddressErrors) => void;
  disabled?: boolean;
}

export function CheckoutAddressBook({ address, book: initialBook, disabled = false, onAddressErrors, onPick }: CheckoutAddressBookProps) {
  const [book, setBook] = useState<AddressBookEntry[] | null>(initialBook);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  /* 마지막으로 고른(또는 저장한) 항목 — 같은 배송지가 두 이름으로 있으면 이 항목을 고른 상태로 둔다. */
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (book === null) return null;

  const matched = matchingAddressBookEntry(book, address, pickedId);
  const full = book.length >= ADDRESS_BOOK_LIMIT;
  const firstEntry = book.length === 0;

  const save = async () => {
    if (pending || disabled) return;
    const draft = addressBookDraftFromCheckout(address, label, firstEntry || makeDefault);
    const errors = addressBookDraftErrors(draft);
    const addressErrors: CheckoutAddressErrors = {};
    for (const field of ADDRESS_FIELD_ORDER) if (errors[field]) addressErrors[field] = errors[field];
    const firstInvalid = ADDRESS_FIELD_ORDER.find((field) => addressErrors[field]);
    if (firstInvalid) {
      setMessage({ tone: 'error', text: checkoutAddressBookFieldsCopy(addressErrors) });
      onAddressErrors?.(addressErrors);
      focusLater(`checkout-${firstInvalid}`);
      return;
    }
    if (errors.label) {
      setMessage({ tone: 'error', text: errors.label });
      document.getElementById(LABEL_ID)?.focus();
      return;
    }
    const input = addressBookSaveInput(draft);
    if (!input) {
      setMessage({ tone: 'error', text: ADDRESS_BOOK_ERROR_COPY.address_book_invalid });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await saveAddressBookEntryAction(null, draft);
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.message });
        return;
      }
      /* 목록을 다시 읽지 못했으면 방금 저장한 값으로 이어 그린다(같은 주소를 두 번 저장하지 않게). */
      const next = result.entries ?? (result.savedId ? [
        ...book.map((entry) => (input.makeDefault ? { ...entry, isDefault: false } : entry)),
        { id: result.savedId, label: input.label, ...input.address, address2: input.address.address2 ?? null, isDefault: input.makeDefault || firstEntry },
      ] : book);
      setBook(next);
      setPickedId(result.savedId ?? null);
      setSaving(false);
      setLabel('');
      setMakeDefault(false);
      setMessage({ tone: 'ok', text: '주소록에 저장했어요.' });
      /* 저장 묶음이 사라진다 — 방금 저장한 배송지가 고른 상태로 보이는 select 로 포커스를 옮긴다. */
      focusLater(SELECT_ID);
    } catch {
      setMessage({ tone: 'error', text: ADDRESS_BOOK_ERROR_COPY.unavailable });
    } finally {
      setPending(false);
    }
  };

  /* 주문서 form 안이다 — 저장 묶음 안의 Enter(이름 칸·체크박스)가 주문 만들기로 제출되지 않게 저장으로 돌린다.
     Chrome 은 form 안 체크박스의 Enter 도 암묵 제출로 처리한다. */
  const onSaveKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as { tagName?: string };
    if (!checkoutAddressBookEnterSaves(event.key, target.tagName ?? '', event.nativeEvent?.isComposing === true)) return;
    event.preventDefault();
    void save();
  };

  const cancelSave = () => {
    setSaving(false);
    setMessage(null);
    focusLater(TOGGLE_ID);
  };

  return (
    <div className="checkout-address-book">
      {book.length > 0 ? (
        <label className="checkout-address-book__pick">
          <span>주소록</span>
          <select
            disabled={disabled}
            id={SELECT_ID}
            onChange={(event) => {
              setMessage(null);
              setPickedId(event.target.value || null);
              onPick(book.find((entry) => entry.id === event.target.value) ?? null);
            }}
            value={matched?.id ?? ''}
          >
            <option value="">{matched ? '새 배송지 입력' : '직접 입력한 배송지'}</option>
            {book.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}{entry.isDefault ? ' (기본)' : ''} · {addressBookAddressLine(entry)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="checkout-address-book__row">
        {!matched && !full && !saving ? (
          <button
            className="checkout-address-book__toggle"
            disabled={disabled}
            id={TOGGLE_ID}
            onClick={() => {
              setSaving(true);
              setMessage(null);
              focusLater(LABEL_ID);
            }}
            type="button"
          >
            이 배송지를 주소록에 저장
          </button>
        ) : null}
        <Link className="checkout-address-book__manage" href={ADDRESS_BOOK_PATH}>배송지 관리</Link>
      </div>

      {saving && !matched && !full ? (
        <div aria-label="주소록에 저장" className="checkout-address-book__save" id="checkout-address-book-save" onKeyDown={onSaveKeyDown} role="group">
          <label className="checkout-address-book__label">
            <span>배송지 이름</span>
            <input
              disabled={disabled || pending}
              id={LABEL_ID}
              maxLength={ADDRESS_BOOK_LABEL_MAX}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="예: 집, 회사"
              value={label}
            />
          </label>
          <label className="checkout-address-book__check">
            <input
              checked={firstEntry || makeDefault}
              disabled={disabled || pending || firstEntry}
              onChange={(event) => setMakeDefault(event.target.checked)}
              type="checkbox"
            />
            <span>기본 배송지로 지정{firstEntry ? ' (첫 배송지는 기본 배송지가 돼요)' : ''}</span>
          </label>
          <div className="checkout-address-book__save-actions">
            <button className="btn btn-ghost btn-sm" disabled={disabled || pending} onClick={cancelSave} type="button">취소</button>
            <button className="btn btn-sm" disabled={disabled || pending} onClick={() => void save()} type="button">
              {pending ? '저장 중' : '주소록에 저장'}
            </button>
          </div>
        </div>
      ) : null}

      {full && !matched ? (
        <p className="checkout-address-book__note">
          주소록이 가득 찼어요(최대 {ADDRESS_BOOK_LIMIT}개). 배송지 관리에서 쓰지 않는 배송지를 지우면 새로 저장할 수 있어요.
        </p>
      ) : null}
      {message ? (
        <p className={`checkout-address-book__message${message.tone === 'error' ? ' is-error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
