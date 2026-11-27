'use client';

import { useState } from 'react';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';

/*
 * 운영자가 고객 계좌로 직접 송금하는 환불의 은행 칸(계좌 송금 부분 환불 전환·반품↔교환 전환의 환불계좌).
 *
 * 은행 이름은 목록에서 고른다 — 고객 화면의 환불계좌 입력과 같은 이름이라 같은 은행이 다른 이름으로 남지 않는다.
 * 다만 이 길은 결제사에 은행 코드를 보내지 않고 운영자가 직접 송금하므로 서버·DB가 받는 은행 이름은 1~40자 자유 글이다.
 * 목록에는 증권사·일부 외국계 은행이 없어서, 고객이 그런 계좌를 주면 '목록에 없는 은행·증권사'를 골라 직접 적는다.
 * 결제사에 은행 코드를 보내는 칸(가상계좌 환불 계좌 입력)은 이 부품을 쓰지 않는다 — 코드가 필요해 목록에서만 고른다.
 *
 * 제출되는 값은 늘 `name` 이름의 문자열 하나다: 목록에서 골랐으면 그 은행 이름(고른 칸이 이름을 갖고),
 * 직접 적으면 적은 글(적는 칸이 이름을 갖는다).
 */
export const CLAIM_TRANSFER_BANK_PLACEHOLDER = '은행 선택';
export const CLAIM_TRANSFER_BANK_OTHER_LABEL = '목록에 없는 은행·증권사';
/** 직접 적는 칸의 이름표. 서버·DB가 받는 은행 이름의 글자 수 한도(40자)와 같다. */
export const CLAIM_TRANSFER_BANK_CUSTOM_LABEL = '은행·증권사 이름';
export const CLAIM_TRANSFER_BANK_MAX_LENGTH = 40;
/** '목록에 없는 은행·증권사' 항목의 값. 제출되지 않는다(이 항목을 고르면 고르는 칸은 이름을 잃고 직접 적는 칸이 이름을 갖는다). */
export const CLAIM_TRANSFER_BANK_OTHER_VALUE = '__claim_transfer_bank_other__';

const LISTED = new Set(TOSS_REFUND_BANKS.map(bank => bank.name));
/** 적힌 은행 이름이 목록에 없는 글이면 직접 적는 상태로 시작한다(미리 채운 값이 있을 때). */
const isCustomBank = (value: string) => value.trim() !== '' && !LISTED.has(value);

export function ClaimTransferBankField({ id, name, value, onChange, disabled, required }: {
  /** 고르는 칸의 id. 칸 이름표(label htmlFor)가 가리킨다. */
  id: string;
  /** 제출되는 이름(폼 필드 이름). 값을 폼 대신 상태로 읽는 곳은 생략한다. */
  name?: string;
  /** 지금 정해진 은행 이름. 직접 적는 중이면 적은 글이다. */
  value: string;
  onChange: (bankName: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const [custom, setCustom] = useState(() => isCustomBank(value));
  return <>
    <NativeSelect className="w-full" disabled={disabled} id={id} name={custom ? undefined : name} required={required}
      onChange={event => {
        const next = event.target.value;
        if (next === CLAIM_TRANSFER_BANK_OTHER_VALUE) { setCustom(true); onChange(''); return; }
        setCustom(false); onChange(next);
      }}
      value={custom ? CLAIM_TRANSFER_BANK_OTHER_VALUE : value}>
      <NativeSelectOption value="">{CLAIM_TRANSFER_BANK_PLACEHOLDER}</NativeSelectOption>
      {TOSS_REFUND_BANKS.map(bank => <NativeSelectOption key={bank.code} value={bank.name}>{bank.name}</NativeSelectOption>)}
      <NativeSelectOption value={CLAIM_TRANSFER_BANK_OTHER_VALUE}>{CLAIM_TRANSFER_BANK_OTHER_LABEL}</NativeSelectOption>
    </NativeSelect>
    {custom ? <Input aria-label={CLAIM_TRANSFER_BANK_CUSTOM_LABEL} autoComplete="off" className="w-full" disabled={disabled} maxLength={CLAIM_TRANSFER_BANK_MAX_LENGTH}
      name={name} onChange={event => onChange(event.target.value)} placeholder={CLAIM_TRANSFER_BANK_CUSTOM_LABEL} required={required} value={value} /> : null}
  </>;
}
