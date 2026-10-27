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
import type { CheckoutAddress } from '@/lib/checkout';

/*
 * 주문서의 배송지 선택·추가(LFS 패리티 2차 L7 · MY-11, 10/14 S3). 두 주문서(Checkout·GoodsTransactionCheckout)가
 * 같은 부품을 쓴다.
 *   · 고르기: 주소록 배송지를 고르면 주문서 폼을 그 값으로 채운다(배송 메모는 주문서에 적은 값 그대로).
 *     '새 배송지 입력'을 고르면 폼을 비운다. 선택 상태는 폼 값에서 파생한다 — 고른 뒤 칸을 고치면 '직접 입력'이 된다.
 *   · 추가: 지금 폼에 적힌 배송지를 주소록에 저장한다. 주문서 form 안이라 별도 form 을 두지 않고, 이름 칸의
 *     Enter 가 주문 제출로 새지 않게 막는다. 저장은 주소록 액션이 하고 주문·결제 경로에는 닿지 않는다.
 * 주소록을 읽지 못했으면(null) 아무것도 그리지 않는다 — 주문서는 지금처럼 직접 입력으로 주문할 수 있다.
 */

const ADDRESS_FIELDS_COPY = '받는 분, 연락처, 우편번호, 기본 주소를 먼저 확인해주세요.';

export interface CheckoutAddressBookProps {
  book: AddressBookEntry[] | null;
  address: CheckoutAddress;
  /** 주소록 배송지를 고르면 그 항목, '새 배송지 입력'이면 null. */
  onPick: (entry: AddressBookEntry | null) => void;
  disabled?: boolean;
}

export function CheckoutAddressBook({ address, book: initialBook, disabled = false, onPick }: CheckoutAddressBookProps) {
  const [book, setBook] = useState<AddressBookEntry[] | null>(initialBook);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (book === null) return null;

  const matched = matchingAddressBookEntry(book, address);
  const full = book.length >= ADDRESS_BOOK_LIMIT;
  const firstEntry = book.length === 0;

  const save = async () => {
    if (pending || disabled) return;
    const draft = addressBookDraftFromCheckout(address, label, firstEntry || makeDefault);
    const errors = addressBookDraftErrors(draft);
    const addressProblem = (['recipientName', 'phone', 'postalCode', 'address1', 'address2'] as const).some((field) => errors[field]);
    if (addressProblem) {
      setMessage({ tone: 'error', text: ADDRESS_FIELDS_COPY });
      return;
    }
    if (errors.label) {
      setMessage({ tone: 'error', text: errors.label });
      document.getElementById('checkout-address-book-label')?.focus();
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
      setSaving(false);
      setLabel('');
      setMakeDefault(false);
      setMessage({ tone: 'ok', text: '주소록에 저장했어요.' });
    } catch {
      setMessage({ tone: 'error', text: ADDRESS_BOOK_ERROR_COPY.unavailable });
    } finally {
      setPending(false);
    }
  };

  const onLabelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    /* 주문서 form 안이다 — Enter 가 주문 만들기로 제출되지 않게 저장으로 돌린다. */
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void save();
  };

  return (
    <div className="checkout-address-book">
      {book.length > 0 ? (
        <label className="checkout-address-book__pick">
          <span>주소록</span>
          <select
            disabled={disabled}
            id="checkout-address-book"
            onChange={(event) => {
              setMessage(null);
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
            onClick={() => {
              setSaving(true);
              setMessage(null);
              window.requestAnimationFrame(() => document.getElementById('checkout-address-book-label')?.focus());
            }}
            type="button"
          >
            이 배송지를 주소록에 저장
          </button>
        ) : null}
        <Link className="checkout-address-book__manage" href={ADDRESS_BOOK_PATH}>배송지 관리</Link>
      </div>

      {saving && !matched && !full ? (
        <div aria-label="주소록에 저장" className="checkout-address-book__save" id="checkout-address-book-save" role="group">
          <label className="checkout-address-book__label">
            <span>배송지 이름</span>
            <input
              disabled={disabled || pending}
              id="checkout-address-book-label"
              maxLength={ADDRESS_BOOK_LABEL_MAX}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={onLabelKeyDown}
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
            <button className="btn btn-ghost btn-sm" disabled={disabled || pending} onClick={() => { setSaving(false); setMessage(null); }} type="button">취소</button>
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
