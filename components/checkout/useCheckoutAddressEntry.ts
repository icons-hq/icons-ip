'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { saveAddressBookEntryAction } from '@/app/my/addresses/actions';
import type { AddressBookDraft, AddressBookEntry, CheckoutAddressPrefill } from '@/lib/address-book';
import { initialCheckoutAddressMode, type CheckoutAddressMode } from '@/lib/checkout-address-entry';

export { focusCheckoutElementWhenReady } from './focus-when-ready';

/*
 * 주문서 배송지 칸의 상태(요약/입력 모양·주소록·주소록 저장 체크·공동주택 여부). 배송지 값(CheckoutAddress)은 주문서가 들고,
 * 이 상태는 그 옆에서 CheckoutAddressSection 과 주문서 제출 경로가 함께 읽는다 — 제출은 공동주택 확인과 주문 뒤 주소록 저장을
 * 여기서 본다. useState 만 쓴다(주문서 시험이 훅을 대체해 함수로 부른다).
 */
export interface CheckoutAddressEntryState {
  /** 주소록. 읽지 못했거나 열리지 않았으면 null — 목록·저장 UI 를 그리지 않는다(빈 주소록과 구별). */
  book: AddressBookEntry[] | null;
  setBook: Dispatch<SetStateAction<AddressBookEntry[] | null>>;
  mode: CheckoutAddressMode;
  setMode: Dispatch<SetStateAction<CheckoutAddressMode>>;
  /** 목록에서 마지막으로 고른 항목 — 같은 배송지를 두 이름으로 저장했으면 이 항목을 고른 것으로 본다. */
  pickedId: string | null;
  setPickedId: Dispatch<SetStateAction<string | null>>;
  /** 주문하면서 이 배송지를 주소록에 저장 — 기본 꺼짐(선택 수집 항목이라 미리 켜 두지 않는다). */
  saveToBook: boolean;
  setSaveToBook: Dispatch<SetStateAction<boolean>>;
  /** 저장할 배송지 이름(선택 — 비우면 받는 분 이름). */
  saveLabel: string;
  setSaveLabel: Dispatch<SetStateAction<string>>;
  /** 마지막 주소 검색 결과가 공동주택인가. 주소록·미리 채운 배송지는 모른다(false) — 이미 확정한 주소다. */
  apartment: boolean;
  setApartment: Dispatch<SetStateAction<boolean>>;
}

export function useCheckoutAddressEntry(prefill: CheckoutAddressPrefill): CheckoutAddressEntryState {
  const [book, setBook] = useState<AddressBookEntry[] | null>(prefill.book);
  const [mode, setMode] = useState<CheckoutAddressMode>(() => initialCheckoutAddressMode(prefill.address));
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [saveToBook, setSaveToBook] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [apartment, setApartment] = useState(false);
  return { book, setBook, mode, setMode, pickedId, setPickedId, saveToBook, setSaveToBook, saveLabel, setSaveLabel, apartment, setApartment };
}

/**
 * 주문을 만든 뒤 체크한 배송지를 주소록에 저장한다(checkoutAddressSaveDraft 가 null 이면 아무것도 하지 않는다).
 * 주소록은 입력 보조라 실패해도 주문 흐름을 막지 않고 조용히 넘어간다 — 회원은 배송지 관리에서 다시 저장할 수 있다.
 */
export async function saveCheckoutAddressToBook(draft: AddressBookDraft | null): Promise<boolean> {
  if (!draft) return false;
  try {
    const result = await saveAddressBookEntryAction(null, draft);
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}
