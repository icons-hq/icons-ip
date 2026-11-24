'use client';

import { useState } from 'react';
import { focusCheckoutElementWhenReady } from '@/components/checkout/focus-when-ready';
import { checkoutAddressErrors, type CheckoutAddress, type CheckoutAddressErrors, type CheckoutAddressField } from '@/lib/checkout';
import { customerConfirm } from '@/lib/customer-confirm';
import { apartmentDetailConfirmRequest, apartmentDetailMissing } from '@/lib/postcode';

/*
 * 주문서 밖 배송지 폼(선물 받기·선물 배송지 변경·정기구독 신청·배송지 변경)의 제출 전 검사. 주소 칸은 PostcodeField 가 검색 결과로
 * 잠그므로(읽기 전용 칸은 브라우저 필수 검사에서 빠진다) 제출할 때 주문서와 같은 문장(checkoutAddressErrors)으로 직접 검사하고,
 * 검색한 주소가 공동주택인데 상세 주소가 비면 한 번 확인받는다(막지는 않는다).
 */

const FIELD_ORDER: readonly CheckoutAddressField[] = ['recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'];

export interface AddressFormFieldProps {
  value: CheckoutAddress;
  onChange: (value: CheckoutAddress) => void;
  errors: CheckoutAddressErrors;
  /** 주소 검색 결과가 공동주택인지 알린다. */
  onSearched: (apartment: boolean) => void;
}

export function useAddressFormGuard(idPrefix: string) {
  const [errors, setErrors] = useState<CheckoutAddressErrors>({});
  const [apartment, setApartment] = useState(false);

  /** 칸 부품에 넘길 값 — 고친 칸의 오류는 바로 지운다. */
  const fieldProps = (value: CheckoutAddress, onChange: (value: CheckoutAddress) => void): AddressFormFieldProps => ({
    value,
    errors,
    onSearched: setApartment,
    onChange: (next) => {
      const changed = FIELD_ORDER.filter((field) => (next[field] ?? '') !== (value[field] ?? ''));
      if (changed.some((field) => errors[field])) {
        setErrors((current) => {
          const rest = { ...current };
          for (const field of changed) delete rest[field];
          return rest;
        });
      }
      onChange(next);
    },
  });

  /** 제출해도 되는가. 틀린 칸이 있으면 오류를 보이고 첫 칸으로, 공동주택 확인을 취소하면 상세 주소 칸으로 포커스를 옮긴다. */
  const check = async (value: CheckoutAddress, action: string): Promise<boolean> => {
    const next = checkoutAddressErrors(value);
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    if (first) {
      focusCheckoutElementWhenReady(`${idPrefix}-${first}`);
      return false;
    }
    if (apartmentDetailMissing(apartment, value.address2) && !(await customerConfirm(apartmentDetailConfirmRequest(action)))) {
      focusCheckoutElementWhenReady(`${idPrefix}-address2`);
      return false;
    }
    return true;
  };

  return { fieldProps, check };
}
