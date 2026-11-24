'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { CheckoutAddressPicker } from '@/components/checkout/CheckoutAddressPicker';
import { PostcodeField } from '@/components/checkout/PostcodeField';
import { focusCheckoutElementWhenReady, type CheckoutAddressEntryState } from '@/components/checkout/useCheckoutAddressEntry';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import {
  ADDRESS_BOOK_LABEL_HINT,
  ADDRESS_BOOK_LABEL_MAX,
  ADDRESS_BOOK_LIMIT,
  addressBookAddressLine,
  addressBookEntryToCheckout,
  matchingAddressBookEntry,
  type AddressBookEntry,
} from '@/lib/address-book';
import type { CheckoutAddress, CheckoutAddressErrors, CheckoutAddressField } from '@/lib/checkout';
import {
  checkoutAddressSaveAvailability,
  emptyCheckoutDestination,
  formatCheckoutPhone,
  visibleCheckoutAddressMode,
} from '@/lib/checkout-address-entry';
import type { ComposedPostcodeAddress } from '@/lib/postcode';

/*
 * 주문서 배송지 칸(국내 커머스 관행 맞추기 P1) — 두 주문서(Checkout·GoodsTransactionCheckout)가 같은 부품을 쓴다.
 * 규칙은 lib/checkout-address-entry.ts 가 정본이다. 요약 카드([변경] → 배송지 선택 시트) 또는 입력 칸, 그 아래 주소록 저장 체크와
 * 배송 메모. 칸 id 는 `checkout-<칸>` 그대로다 — 주문서의 첫 오류 칸 포커스가 이 id 를 찾는다.
 */

export const CHECKOUT_ADDRESS_CHANGE_ID = 'checkout-address-change';
export const CHECKOUT_ADDRESS_SAVE_ID = 'checkout-address-save';

export interface CheckoutAddressSectionProps {
  entry: CheckoutAddressEntryState;
  address: CheckoutAddress;
  setAddress: Dispatch<SetStateAction<CheckoutAddress>>;
  /** 칸 오류(주문서가 제출할 때 정한다). 없으면 칸 오류를 그리지 않는다. */
  errors?: CheckoutAddressErrors;
  /** 칸을 고치면 그 칸 오류를 지운다. */
  onErrorsChange?: Dispatch<SetStateAction<CheckoutAddressErrors>>;
  disabled?: boolean;
}

export function CheckoutAddressSection({ address, disabled = false, entry, errors = {}, onErrorsChange, setAddress }: CheckoutAddressSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const mode = visibleCheckoutAddressMode(entry.mode, address);
  const matched = matchingAddressBookEntry(entry.book, address, entry.pickedId);
  const saveAvailability = checkoutAddressSaveAvailability(entry.book, address);

  const clearErrors = (fields: readonly CheckoutAddressField[] | 'all') => {
    onErrorsChange?.((current) => {
      if (fields === 'all') {
        if (!current.deliveryNote) return {};
        return { deliveryNote: current.deliveryNote };
      }
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  };

  const setField = (field: CheckoutAddressField, value: string) => {
    setAddress((current) => ({ ...current, [field]: value }));
    clearErrors([field]);
  };

  /* 검색 결과는 우편번호와 기본 주소만 덮어쓴다. 상세 주소는 사용자 몫이라 이미 적어둔 값을 지우지 않는다. */
  const applySearchedAddress = ({ address1, apartment, postalCode }: ComposedPostcodeAddress) => {
    setAddress((current) => ({ ...current, postalCode, address1 }));
    entry.setApartment(apartment);
    clearErrors(['postalCode', 'address1']);
    focusCheckoutElementWhenReady('checkout-address2');
  };

  /* 목록에서 고른 배송지로 채우고 요약으로 접는다. 배송 메모는 주문서에 적은 값을 둔다. 포커스는 요약의 [변경]으로 —
     입력 칸에서 열었으면 연 버튼이 사라지므로 여기서 옮긴다. */
  const applyEntry = (picked: AddressBookEntry) => {
    setAddress((current) => addressBookEntryToCheckout(picked, current.deliveryNote ?? ''));
    entry.setPickedId(picked.id || null);
    entry.setMode('summary');
    entry.setApartment(false);
    clearErrors('all');
    setPickerOpen(false);
    focusCheckoutElementWhenReady(CHECKOUT_ADDRESS_CHANGE_ID);
  };

  /* 주소록에 저장하지 않고 이번 주문에만 쓸 배송지 — 빈 칸을 펼치고 받는 분 칸으로 간다. */
  const startDirectInput = () => {
    setAddress((current) => emptyCheckoutDestination(current.deliveryNote ?? ''));
    entry.setPickedId(null);
    entry.setMode('form');
    entry.setApartment(false);
    clearErrors('all');
    setPickerOpen(false);
    focusCheckoutElementWhenReady('checkout-recipientName');
  };

  /* [변경] — 주소록이 있으면 선택 시트, 주소록을 쓸 수 없으면 지금 배송지를 입력 칸으로 펼친다. */
  const change = () => {
    if (entry.book) {
      setPickerOpen(true);
      return;
    }
    entry.setMode('form');
    focusCheckoutElementWhenReady('checkout-recipientName');
  };

  const fieldError = (field: CheckoutAddressField) => (
    errors[field] ? <small id={`checkout-${field}-error`} className="checkout-field-error">{errors[field]}</small> : null
  );
  const invalid = (field: CheckoutAddressField) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `checkout-${field}-error` : undefined,
  });

  return (
    /* 문의 런처가 입력칸 오른쪽 끝을 가리지 않게, 이 칸들과 겹치는 동안은 런처를 비켜 둔다(QA2b minor 5). */
    <div className="checkout-address" data-inquiry-avoid="">
      {mode === 'summary' ? (
        <div className="checkout-address-summary">
          <div className="checkout-address-summary__body">
            <p className="checkout-address-summary__name">
              <strong>{address.recipientName}</strong>
              {matched && matched.label !== address.recipientName.trim() ? <span className="checkout-address-summary__label">{matched.label}</span> : null}
              {matched?.isDefault ? <span className="checkout-address-badge">기본 배송지</span> : null}
            </p>
            <p className="checkout-address-summary__line">{formatCheckoutPhone(address.phone)}</p>
            <p className="checkout-address-summary__line">{addressBookAddressLine({ postalCode: address.postalCode, address1: address.address1, address2: address.address2?.trim() || null })}</p>
          </div>
          <button
            aria-haspopup={entry.book ? 'dialog' : undefined}
            aria-label="배송지 변경"
            className="checkout-address-summary__change"
            disabled={disabled}
            id={CHECKOUT_ADDRESS_CHANGE_ID}
            onClick={change}
            type="button"
          >
            변경
          </button>
        </div>
      ) : (
        <>
          {entry.book && entry.book.length > 0 ? (
            <div className="checkout-address__pick-row">
              <button aria-haspopup="dialog" className="checkout-address__pick" disabled={disabled} id={CHECKOUT_ADDRESS_CHANGE_ID} onClick={() => setPickerOpen(true)} type="button">
                주소록에서 선택
              </button>
            </div>
          ) : null}
          <div className="checkout-fields">
            <label>
              <span>받는 분</span>
              <input id="checkout-recipientName" required autoComplete="name" maxLength={50} {...invalid('recipientName')} value={address.recipientName} onChange={(event) => setField('recipientName', event.target.value)} />
              {fieldError('recipientName')}
            </label>
            <label>
              <span>연락처</span>
              <input id="checkout-phone" required autoComplete="tel" inputMode="tel" maxLength={20} {...invalid('phone')} placeholder="010-1234-5678" value={address.phone} onChange={(event) => setField('phone', event.target.value)} />
              {fieldError('phone')}
            </label>
            <PostcodeField
              address1={address.address1}
              errors={{ postalCode: errors.postalCode, address1: errors.address1 }}
              onChange={setField}
              onSelect={applySearchedAddress}
              postalCode={address.postalCode}
            />
            <label className="checkout-field--wide">
              <span>상세 주소 <em>선택</em></span>
              <input id="checkout-address2" autoComplete="address-line2" maxLength={200} {...invalid('address2')} placeholder="예: 101동 1203호" value={address.address2 ?? ''} onChange={(event) => setField('address2', event.target.value)} />
              {fieldError('address2')}
            </label>
          </div>
        </>
      )}

      <CheckoutAddressSaveOption
        availability={saveAvailability}
        checked={entry.saveToBook}
        disabled={disabled}
        firstEntry={entry.book?.length === 0}
        label={entry.saveLabel}
        onCheckedChange={entry.setSaveToBook}
        onLabelChange={entry.setSaveLabel}
      />

      <div className="checkout-fields checkout-address__note">
        <label className="checkout-field--wide">
          <span>배송 메모 <em>선택</em></span>
          <input id="checkout-deliveryNote" maxLength={200} {...invalid('deliveryNote')} placeholder="예: 문 앞에 놓아주세요" value={address.deliveryNote ?? ''} onChange={(event) => setField('deliveryNote', event.target.value)} />
          {fieldError('deliveryNote')}
        </label>
      </div>

      {pickerOpen && entry.book ? (
        <OverlayPortal>
          <CheckoutAddressPicker
            book={entry.book}
            currentId={matched?.id ?? null}
            onApply={applyEntry}
            onBookChange={entry.setBook}
            onClose={() => setPickerOpen(false)}
            onDirectInput={startDirectInput}
            onEdited={(edited) => {
              /* 주문서에 채운 배송지를 고쳤으면 주문서도 새 값으로 — 요약이 옛 주소를 보이지 않게. */
              if (matched?.id === edited.id) setAddress((current) => addressBookEntryToCheckout(edited, current.deliveryNote ?? ''));
            }}
          />
        </OverlayPortal>
      ) : null}
    </div>
  );
}

/**
 * 주문하면서 이 배송지를 주소록에 저장 — 체크 하나(기본 꺼짐), 켜면 배송지 이름(선택) 칸이 열린다. 주소록에 이미 있거나 쓸 수
 * 없으면 그리지 않고, 가득 찼으면 정리 안내만 한다. 저장은 주문을 만든 뒤에 한다.
 */
export function CheckoutAddressSaveOption({ availability, checked, disabled, firstEntry, label, onCheckedChange, onLabelChange }: {
  availability: ReturnType<typeof checkoutAddressSaveAvailability>;
  checked: boolean;
  disabled: boolean;
  firstEntry: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  onLabelChange: (label: string) => void;
}) {
  if (availability === 'unavailable' || availability === 'saved') return null;
  if (availability === 'full') {
    return (
      <p className="checkout-address-save__note">
        주소록이 가득 찼어요(최대 {ADDRESS_BOOK_LIMIT}개). 배송지 관리에서 쓰지 않는 배송지를 지우면 새로 저장할 수 있어요.
      </p>
    );
  }
  return (
    <div className="checkout-address-save">
      <label className="checkout-address-save__check">
        <input checked={checked} disabled={disabled} id={CHECKOUT_ADDRESS_SAVE_ID} onChange={(event) => onCheckedChange(event.target.checked)} type="checkbox" />
        <span>
          이 배송지를 주소록에 저장
          <small>주문할 때 함께 저장해요.{firstEntry ? ' 첫 배송지는 기본 배송지가 돼요.' : ''}</small>
        </span>
      </label>
      {checked ? (
        <label className="checkout-address-save__label">
          <span>배송지 이름 <em>선택</em></span>
          <input
            aria-describedby="checkout-address-save-label-hint"
            disabled={disabled}
            id="checkout-address-save-label"
            maxLength={ADDRESS_BOOK_LABEL_MAX}
            onChange={(event) => onLabelChange(event.target.value)}
            placeholder="예: 집, 회사"
            value={label}
          />
          <small id="checkout-address-save-label-hint">{ADDRESS_BOOK_LABEL_HINT}</small>
        </label>
      ) : null}
    </div>
  );
}
