'use client';

import { TOSS_REFUND_BANKS } from '@/lib/payments/toss-bank-codes';

/*
 * 취소·반품 신청 화면의 환불계좌 칸(반품 신청 OrderClaimRequest와 주문 취소 OrderCancellation이 같이 쓴다).
 *
 * 입금된 토스 가상계좌 주문(ADR-0049 결정 5 보강)은 이 계좌로 결제대행사가 환불하므로 은행을 결제대행사 은행 목록에서 고르게 한다 —
 * 이름 → 은행 코드 변환이 추측이 되지 않게. 그대로 보낼 수 있는 계좌인지는 DB 판정 하나(private.virtual_account_refund_account_usable)가
 * 신청 때 다시 본다. 그 밖의 주문은 결제수단으로 환급하지 못할 때만 쓰는 선택 칸이다(자유 입력).
 */

/** 가상계좌 환불은 결제대행사에 은행 코드와 숫자 6~20자리 계좌번호를 보낸다(DB 판정 private.virtual_account_refund_account_usable과 같다). */
export const VIRTUAL_ACCOUNT_REFUND_ACCOUNT_MESSAGE = '은행은 목록에서 고르고, 계좌번호는 숫자 6~20자리(하이픈 제외)로 입력해주세요.';
const VIRTUAL_ACCOUNT_REFUND_NUMBER = /^[0-9]{6,20}$/;

/** 가상계좌 환불 계좌번호 형식(하이픈을 뺀 숫자 6~20자리). 화면은 신청 전에 이 형식만 보고, 최종 판정은 DB가 한다. */
export function isVirtualAccountRefundNumber(accountNumber: string) {
  return VIRTUAL_ACCOUNT_REFUND_NUMBER.test(accountNumber.replace(/-/g, ''));
}

export interface RefundAccountDraft {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

export function RefundAccountFieldset({
  error,
  idPrefix,
  intro,
  legend,
  onChange,
  value,
  virtualAccount,
}: {
  error: string | null;
  /** 칸 id 앞부분(예: order-claim → order-claim-bank·order-claim-account·order-claim-holder). */
  idPrefix: string;
  intro: string;
  legend: string;
  onChange: (next: RefundAccountDraft) => void;
  value: RefundAccountDraft;
  virtualAccount: boolean;
}) {
  return (
    <fieldset className="order-cancellation-reason">
      <legend>{legend}</legend>
      <p className="money-caption">{intro}</p>
      <label htmlFor={`${idPrefix}-bank`}>
        <span>은행</span>
        {virtualAccount ? (
          /* 결제대행사에 은행 코드를 보낸다 — 목록에서 골라 이름 → 코드 변환이 추측이 되지 않게 한다. */
          <select
            id={`${idPrefix}-bank`}
            onChange={(event) => onChange({ ...value, bankName: event.target.value })}
            value={value.bankName}
          >
            <option value="">은행 선택</option>
            {TOSS_REFUND_BANKS.map((bank) => <option key={bank.code} value={bank.name}>{bank.name}</option>)}
          </select>
        ) : (
          <input
            id={`${idPrefix}-bank`}
            maxLength={40}
            onChange={(event) => onChange({ ...value, bankName: event.target.value })}
            type="text"
            value={value.bankName}
          />
        )}
      </label>
      <label htmlFor={`${idPrefix}-account`}>
        <span>계좌번호</span>
        <input
          id={`${idPrefix}-account`}
          inputMode="numeric"
          maxLength={30}
          onChange={(event) => onChange({ ...value, accountNumber: event.target.value })}
          type="text"
          value={value.accountNumber}
        />
      </label>
      <label htmlFor={`${idPrefix}-holder`}>
        <span>예금주</span>
        <input
          id={`${idPrefix}-holder`}
          maxLength={40}
          onChange={(event) => onChange({ ...value, accountHolder: event.target.value })}
          type="text"
          value={value.accountHolder}
        />
      </label>
      {error ? (
        <p className="order-cancellation-feedback order-cancellation-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
