'use client';

import { useRef, useState, type FormEvent } from 'react';
import { saveAddressBookEntryAction } from '@/app/my/addresses/actions';
import { PostcodeField } from '@/components/checkout/PostcodeField';
import {
  ADDRESS_BOOK_DRAFT_FIELDS,
  ADDRESS_BOOK_ERROR_COPY,
  ADDRESS_BOOK_LABEL_MAX,
  addressBookDraftErrors,
  addressBookDraftFromEntry,
  emptyAddressBookDraft,
  type AddressBookDraft,
  type AddressBookDraftErrors,
  type AddressBookDraftField,
  type AddressBookEntry,
} from '@/lib/address-book';
import type { ComposedPostcodeAddress } from '@/lib/postcode';

/** 주소 검색을 열지 못했을 때 — 주문이 아니라 배송지를 저장하는 화면의 문구다(주문서 문구는 PostcodeField 기본값). */
export const ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE = '주소 검색을 열지 못했어요. 우편번호와 기본 주소를 직접 입력해도 배송지를 저장할 수 있어요.';

/*
 * 주소록 배송지 추가·수정 폼(LFS 패리티 2차 L7 · MY-11). 배송지 관리와 온보딩 안내가 같은 폼을 쓴다.
 * 우편번호 검색·검증 문장은 주문서와 같은 부품(PostcodeField·checkoutAddressErrors)이다 — 주문서에서 통과한
 * 주소가 여기서 거절되지 않는다. 배송 메모는 주문마다 다르므로 받지 않는다.
 * 주문서 안에서는 쓰지 않는다(폼 중첩 금지) — 주문서는 CheckoutAddressBook 이 지금 입력한 배송지를 저장한다.
 */

export interface AddressBookFormSaved {
  entries: AddressBookEntry[] | null;
  savedId?: string;
}

export interface AddressBookFormProps {
  /** 필드 id 접두 — 같은 문서 안에서 주문서·다른 폼과 겹치지 않게 한다. */
  idPrefix: string;
  /** 수정할 배송지. 없으면 추가. */
  entry?: AddressBookEntry | null;
  /** 주소록이 비어 있어 이 주소가 첫 배송지(= 기본 배송지)가 되는가. */
  firstEntry: boolean;
  submitLabel: string;
  onSaved: (saved: AddressBookFormSaved) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function AddressBookForm({
  cancelLabel = '취소',
  entry = null,
  firstEntry,
  idPrefix,
  onCancel,
  onSaved,
  submitLabel,
}: AddressBookFormProps) {
  const [draft, setDraft] = useState<AddressBookDraft>(() => (entry ? addressBookDraftFromEntry(entry) : emptyAddressBookDraft(firstEntry)));
  const [fieldErrors, setFieldErrors] = useState<AddressBookDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /* 저장 요청이 나가 있는 동안 true. pending 은 다음 렌더에야 보이므로, 같은 태스크 안에서 제출이 두 번 불리면
     (같은 클로저) 둘 다 통과한다 — 이 ref 가 동기로 두 번째 요청을 막는다. */
  const inFlight = useRef(false);
  const fieldId = (field: AddressBookDraftField) => `${idPrefix}-${field}`;
  /* 첫 배송지와 이미 기본인 배송지는 기본 지정을 끌 수 없다 — 주소가 있으면 기본 배송지는 늘 1개다. */
  const defaultLocked = firstEntry || entry?.isDefault === true;

  const focusField = (field: AddressBookDraftField) => {
    window.requestAnimationFrame(() => document.getElementById(fieldId(field))?.focus());
  };

  const setField = (field: AddressBookDraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  /* 검색 결과는 우편번호와 기본 주소만 덮어쓴다 — 상세 주소는 사용자 몫이다(주문서와 같은 규칙). */
  const applySearchedAddress = ({ postalCode, address1 }: ComposedPostcodeAddress) => {
    setDraft((current) => ({ ...current, postalCode, address1 }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.postalCode;
      delete next.address1;
      return next;
    });
    focusField('address2');
  };

  const showErrors = (errors: AddressBookDraftErrors) => {
    setFieldErrors(errors);
    const first = ADDRESS_BOOK_DRAFT_FIELDS.find((field) => errors[field]);
    if (first) focusField(first);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || inFlight.current) return;
    const value = { ...draft, makeDefault: defaultLocked || draft.makeDefault };
    const errors = addressBookDraftErrors(value);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    inFlight.current = true;
    setPending(true);
    setFormError(null);
    try {
      const result = await saveAddressBookEntryAction(entry?.id ?? null, value);
      if (!result.ok) {
        setFormError(result.message);
        if (result.fieldErrors) showErrors(result.fieldErrors);
        return;
      }
      onSaved({ entries: result.entries, ...(result.savedId ? { savedId: result.savedId } : {}) });
    } catch {
      setFormError(ADDRESS_BOOK_ERROR_COPY.unavailable);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const describedBy = (field: AddressBookDraftField) => (fieldErrors[field] ? `${fieldId(field)}-error` : undefined);
  const fieldError = (field: AddressBookDraftField) => (
    fieldErrors[field] ? <small className="wc-address-form__error" id={`${fieldId(field)}-error`}>{fieldErrors[field]}</small> : null
  );

  return (
    <form aria-busy={pending} className="wc-address-form" noValidate onSubmit={submit}>
      <div className="wc-address-form__fields">
        <label className="wc-address-form__field wc-address-form__field--wide">
          <span>배송지 이름</span>
          <input
            aria-describedby={describedBy('label')}
            aria-invalid={Boolean(fieldErrors.label)}
            id={fieldId('label')}
            maxLength={ADDRESS_BOOK_LABEL_MAX}
            onChange={(event) => setField('label', event.target.value)}
            placeholder="예: 집, 회사"
            required
            value={draft.label}
          />
          {fieldError('label')}
        </label>
        <label className="wc-address-form__field">
          <span>받는 분</span>
          <input
            aria-describedby={describedBy('recipientName')}
            aria-invalid={Boolean(fieldErrors.recipientName)}
            autoComplete="name"
            id={fieldId('recipientName')}
            maxLength={50}
            onChange={(event) => setField('recipientName', event.target.value)}
            required
            value={draft.recipientName}
          />
          {fieldError('recipientName')}
        </label>
        <label className="wc-address-form__field">
          <span>연락처</span>
          <input
            aria-describedby={describedBy('phone')}
            aria-invalid={Boolean(fieldErrors.phone)}
            autoComplete="tel"
            id={fieldId('phone')}
            inputMode="tel"
            maxLength={20}
            onChange={(event) => setField('phone', event.target.value)}
            placeholder="010-1234-5678"
            required
            value={draft.phone}
          />
          {fieldError('phone')}
        </label>
        <PostcodeField
          error={fieldErrors.postalCode}
          failedMessage={ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE}
          id={fieldId('postalCode')}
          onChange={(postalCode) => setField('postalCode', postalCode)}
          onSelect={applySearchedAddress}
          value={draft.postalCode}
        />
        <label className="wc-address-form__field wc-address-form__field--wide">
          <span>기본 주소</span>
          <input
            aria-describedby={describedBy('address1')}
            aria-invalid={Boolean(fieldErrors.address1)}
            autoComplete="address-line1"
            id={fieldId('address1')}
            maxLength={200}
            onChange={(event) => setField('address1', event.target.value)}
            required
            value={draft.address1}
          />
          {fieldError('address1')}
        </label>
        <label className="wc-address-form__field wc-address-form__field--wide">
          <span>상세 주소 <em>선택</em></span>
          <input
            aria-describedby={describedBy('address2')}
            aria-invalid={Boolean(fieldErrors.address2)}
            autoComplete="address-line2"
            id={fieldId('address2')}
            maxLength={200}
            onChange={(event) => setField('address2', event.target.value)}
            placeholder="예: 101동 1203호"
            value={draft.address2}
          />
          {fieldError('address2')}
        </label>
        <label className="wc-address-form__check wc-address-form__field--wide">
          <input
            checked={defaultLocked || draft.makeDefault}
            disabled={defaultLocked}
            id={`${idPrefix}-makeDefault`}
            onChange={(event) => setDraft((current) => ({ ...current, makeDefault: event.target.checked }))}
            type="checkbox"
          />
          <span>
            기본 배송지로 지정
            {firstEntry ? <small>첫 배송지는 기본 배송지가 돼요.</small> : null}
            {!firstEntry && entry?.isDefault ? <small>다른 배송지를 기본으로 지정하면 바뀌어요.</small> : null}
          </span>
        </label>
      </div>
      {formError ? <p className="wc-address-form__alert" role="alert">{formError}</p> : null}
      <div className="wc-address-form__actions">
        {onCancel ? (
          <button className="wc-btn" disabled={pending} onClick={onCancel} type="button">{cancelLabel}</button>
        ) : null}
        <button aria-disabled={pending ? 'true' : undefined} className="wc-btn primary" type="submit">
          {pending ? '저장 중' : submitLabel}
        </button>
      </div>
    </form>
  );
}
