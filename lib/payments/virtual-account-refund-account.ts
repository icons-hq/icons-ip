import type { PaymentRefundReceiveAccount } from './gateway';
import { tossBankCodeForName } from './toss-bank-codes';

/*
 * 가상계좌 입금 뒤 환불에 실을 환급 계좌 고르기(ADR-0049 결정 5, 2026-11-23 보강).
 *
 * 후보는 둘이다(service_goods_virtual_account_refund_accounts).
 *  - claim: 이 취소·반품 요청에서 구매자가 반품·취소 신청 화면이나 주문 상세에 입력한 계좌(은행 이름).
 *  - checkout: 결제 UI가 받은 계좌(토스 은행 코드, 결제창 뒤 30분만 조회돼 입금 대기 확정 때 남긴 값).
 * 구매자가 이 요청에서 직접 입력한 계좌가 가장 최근의 뜻이라 먼저 쓴다. 그 계좌를 결제사에 그대로 보낼 수 있는지는 DB 판정 하나
 * (private.virtual_account_refund_account_usable — 목록의 은행 이름, 하이픈을 뺀 숫자 6~20자리, 예금주 1~50자)가 정해 후보 응답의
 * usable로 준다. 재시도 시작(service_begin_virtual_account_refund_retry)도 같은 판정을 써서 앱과 DB가 계좌를 다르게 보지 않는다.
 * 입력한 계좌를 쓸 수 없으면 결제 UI 계좌로 넘어가지 않는다 — 구매자가 바꾸려던 계좌가 아닌 곳으로 송금되지 않게, 쓸 계좌가 없는 것으로
 * 본다. 그러면 게이트웨이가 결제사를 부르지 않고 결제확인필요(provider_refund_account_required)로 남기고, 구매자 화면은 그 계좌를
 * 바꾸라고 알린다(문맥의 refundAccountIssue 'unusable').
 * 계좌가 바뀌면 멱등키도 바뀐다(refund:{attemptId}:va-{계좌 해시}) — 거절된 첫 응답이 고친 계좌의 요청에 재생되지 않는다.
 */

export interface VirtualAccountRefundAccountCandidates {
  readonly claim: {
    readonly bankName: string; readonly accountNumber: string; readonly holderName: string;
    /** DB 판정(private.virtual_account_refund_account_usable) — false면 이 계좌로도 결제 UI 계좌로도 환불하지 않는다. */
    readonly usable: boolean;
  } | null;
  readonly checkout: PaymentRefundReceiveAccount | null;
}

export type VirtualAccountRefundAccountSource = 'claim' | 'checkout';

/**
 * 환불이 환급 계좌 때문에 멈춘 결제확인필요 사유(계좌 없음·결제사 거절). 이 사유로 멈추면 구매자에게 앱 알림(DB 트리거)·메일(앱)이 가고,
 * 운영자는 전화 등으로 받은 계좌를 대신 입력할 수 있다(admin_set_order_claim_refund_account, 2026-11-25).
 */
export const VIRTUAL_ACCOUNT_REFUND_ACCOUNT_REVIEW_CODES = ['provider_refund_account_required', 'provider_refund_account_invalid'] as const;
export type VirtualAccountRefundAccountReviewCode = (typeof VIRTUAL_ACCOUNT_REFUND_ACCOUNT_REVIEW_CODES)[number];

export function isVirtualAccountRefundAccountReviewCode(code: unknown): code is VirtualAccountRefundAccountReviewCode {
  return typeof code === 'string' && (VIRTUAL_ACCOUNT_REFUND_ACCOUNT_REVIEW_CODES as readonly string[]).includes(code);
}

const BANK_CODE = /^[0-9]{2,3}$/;
const ACCOUNT_NUMBER = /^[0-9]{6,20}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * RPC 응답을 좁힌다. 모양이 어긋나면 null — 호출자는 계좌가 없는 것으로 본다(결제사를 부르지 않는다). 입력한 계좌 칸이 있는데 모양이
 * 어긋나도 전체를 null로 본다(결제 UI 계좌로 넘어가지 않는다).
 */
export function parseVirtualAccountRefundAccountCandidates(value: unknown): VirtualAccountRefundAccountCandidates | null {
  if (!record(value)) return null;
  let claim: VirtualAccountRefundAccountCandidates['claim'] = null;
  if (value.claim !== null && value.claim !== undefined) {
    if (!record(value.claim) || !text(value.claim.bankName) || !text(value.claim.accountNumber) || !text(value.claim.holderName)
      || typeof value.claim.usable !== 'boolean') return null;
    claim = { bankName: value.claim.bankName, accountNumber: value.claim.accountNumber, holderName: value.claim.holderName, usable: value.claim.usable };
  }
  const checkout = record(value.checkout) && text(value.checkout.bankCode) && text(value.checkout.accountNumber) && text(value.checkout.holderName)
    ? { bankCode: value.checkout.bankCode, accountNumber: value.checkout.accountNumber, holderName: value.checkout.holderName }
    : null;
  return { claim, checkout };
}

function usable(account: PaymentRefundReceiveAccount): PaymentRefundReceiveAccount | null {
  const holderName = account.holderName.trim();
  return BANK_CODE.test(account.bankCode) && ACCOUNT_NUMBER.test(account.accountNumber)
    && holderName.length >= 1 && holderName.length <= 50 && !CONTROL.test(holderName)
    ? { bankCode: account.bankCode, accountNumber: account.accountNumber, holderName }
    : null;
}

/** 환불에 실을 계좌. 구매자가 이 요청에서 입력한 계좌가 있으면 그것만, 없으면 결제 UI 계좌. 쓸 수 있는 계좌가 없으면 null. */
export function selectVirtualAccountRefundAccount(
  candidates: VirtualAccountRefundAccountCandidates | null,
): { readonly account: PaymentRefundReceiveAccount; readonly source: VirtualAccountRefundAccountSource } | null {
  if (!candidates) return null;
  if (candidates.claim) {
    if (!candidates.claim.usable) return null;
    const bankCode = tossBankCodeForName(candidates.claim.bankName);
    // 클레임 계좌번호는 하이픈을 받는다(숫자·하이픈 8~30자). 결제사에는 숫자만 보낸다.
    const accountNumber = candidates.claim.accountNumber.replace(/-/g, '');
    const account = bankCode ? usable({ bankCode, accountNumber, holderName: candidates.claim.holderName }) : null;
    return account ? { account, source: 'claim' } : null;
  }
  if (candidates.checkout) {
    const account = usable(candidates.checkout);
    if (account) return { account, source: 'checkout' };
  }
  return null;
}
