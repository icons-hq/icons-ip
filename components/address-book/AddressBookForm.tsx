'use client';

import { useRef, useState, type FormEvent } from 'react';
import { saveAddressBookEntryAction } from '@/app/my/addresses/actions';
import { PostcodeField } from '@/components/checkout/PostcodeField';
import {
  ADDRESS_BOOK_DRAFT_FIELDS,
  ADDRESS_BOOK_ERROR_COPY,
  ADDRESS_BOOK_LABEL_HINT,
  ADDRESS_BOOK_LABEL_MAX,
  addressBookDraftErrors,
  addressBookDraftFromEntry,
  addressBookSaveInput,
  emptyAddressBookDraft,
  type AddressBookDraft,
  type AddressBookDraftErrors,
  type AddressBookDraftField,
  type AddressBookEntry,
  type AddressBookSaveInput,
} from '@/lib/address-book';
import { customerConfirm } from '@/lib/customer-confirm';
import { apartmentDetailConfirmRequest, apartmentDetailMissing, type ComposedPostcodeAddress } from '@/lib/postcode';

/** 주소 검색을 열지 못했을 때 — 주문이 아니라 배송지를 저장하는 화면의 문구다(주문서 문구는 PostcodeField 기본값). */
export const ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE = '주소 검색을 열지 못했어요. 우편번호와 기본 주소를 직접 입력해도 배송지를 저장할 수 있어요.';

/*
 * 주소록 배송지 추가·수정 폼(LFS 패리티 2차 L7 · MY-11). 배송지 관리와 온보딩 안내가 같은 폼을 쓴다.
 * 우편번호 검색·검증 문장은 주문서와 같은 부품(PostcodeField·checkoutAddressErrors)이다 — 주문서에서 통과한
 * 주소가 여기서 거절되지 않는다. 배송 메모는 주문마다 다르므로 받지 않는다. 배송지 이름은 선택이다(비우면 받는 분 이름).
 * 검색한 주소가 공동주택인데 상세 주소가 비면 저장 전에 한 번 확인받는다(막지는 않는다).
 * 주문서의 배송지 선택 시트(CheckoutAddressPicker)도 이 폼을 쓴다 — 시트는 #root 밖(OverlayPortal)이라 DOM 에서 주문서
 * form 과 겹치지 않고, 제출 이벤트가 React 트리를 타고 주문서로 번지지 않게 시트가 막는다.
 */

export interface AddressBookFormSaved {
  entries: AddressBookEntry[] | null;
  savedId?: string;
  /** 저장한 값(정규화·이름 채움 뒤). 목록을 다시 읽지 못했을 때 화면이 이 값으로 이어 그린다. */
  input: AddressBookSaveInput;
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
  /* 마지막 주소 검색 결과가 공동주택인가 — 상세 주소가 비면 저장 전에 확인받는다. 저장돼 있던 주소는 모른다(false). */
  const [apartment, setApartment] = useState(false);
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
  const applySearchedAddress = ({ postalCode, address1, apartment: searchedApartment }: ComposedPostcodeAddress) => {
    setDraft((current) => ({ ...current, postalCode, address1 }));
    setApartment(searchedApartment);
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
    const input = addressBookSaveInput(value);
    if (Object.keys(errors).length > 0 || !input) {
      showErrors(errors);
      return;
    }
    inFlight.current = true;
    try {
      /* 공동주택인데 동·호수가 비었다 — 한 번 확인받는다. [상세 주소 입력]이면 그 칸으로 돌아간다. */
      if (apartmentDetailMissing(apartment, value.address2) && !(await customerConfirm(apartmentDetailConfirmRequest('저장')))) {
        focusField('address2');
        return;
      }
      setPending(true);
      setFormError(null);
      const result = await saveAddressBookEntryAction(entry?.id ?? null, value);
      if (!result.ok) {
        setFormError(result.message);
        if (result.fieldErrors) showErrors(result.fieldErrors);
        return;
      }
      onSaved({ entries: result.entries, ...(result.savedId ? { savedId: result.savedId } : {}), input });
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
          <span>배송지 이름 <em>선택</em></span>
          <input
            aria-describedby={[describedBy('label'), `${fieldId('label')}-hint`].filter(Boolean).join(' ')}
            aria-invalid={Boolean(fieldErrors.label)}
            id={fieldId('label')}
            maxLength={ADDRESS_BOOK_LABEL_MAX}
            onChange={(event) => setField('label', event.target.value)}
            placeholder="예: 집, 회사"
            value={draft.label}
          />
          <small className="wc-address-form__hint" id={`${fieldId('label')}-hint`}>{ADDRESS_BOOK_LABEL_HINT}</small>
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
          address1={draft.address1}
          errors={{ postalCode: fieldErrors.postalCode, address1: fieldErrors.address1 }}
          failedMessage={ADDRESS_BOOK_POSTCODE_FAILED_MESSAGE}
          idPrefix={idPrefix}
          onChange={setField}
          onSelect={applySearchedAddress}
          postalCode={draft.postalCode}
        />
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
