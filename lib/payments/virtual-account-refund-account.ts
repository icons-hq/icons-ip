import type { PaymentRefundReceiveAccount } from './gateway';
import { tossBankCodeForName } from './toss-bank-codes';

/*
 * 가상계좌 입금 뒤 환불에 실을 환급 계좌 고르기(ADR-0049 결정 5, 2026-11-23 보강).
 *
 * 후보는 둘이다(service_goods_virtual_account_refund_accounts).
 *  - claim: 이 취소·반품 요청에서 구매자가 반품·취소 신청 화면이나 주문 상세에 입력한 계좌(은행 이름).
 *  - checkout: 결제 UI가 받은 계좌(토스 은행 코드, 결제창 뒤 30분만 조회돼 입금 대기 확정 때 남긴 값).
 * 구매자가 이 요청에서 직접 입력한 계좌가 가장 최근의 뜻이라 먼저 쓴다. 은행 이름을 토스 코드로 바꿀 수 없거나 형식이 맞지 않으면
 * 결제 UI 계좌로 간다. 둘 다 없으면 undefined — 게이트웨이가 결제사를 부르지 않고 결제확인필요(provider_refund_account_required)로 남긴다.
 * 계좌가 바뀌면 멱등키도 바뀐다(refund:{attemptId}:va-{계좌 해시}) — 거절된 첫 응답이 고친 계좌의 요청에 재생되지 않는다.
 */

export interface VirtualAccountRefundAccountCandidates {
  readonly claim: { readonly bankName: string; readonly accountNumber: string; readonly holderName: string } | null;
  readonly checkout: PaymentRefundReceiveAccount | null;
}

export type VirtualAccountRefundAccountSource = 'claim' | 'checkout';

const BANK_CODE = /^[0-9]{2,3}$/;
const ACCOUNT_NUMBER = /^[0-9]{6,20}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** RPC 응답을 좁힌다. 모양이 어긋나면 null — 호출자는 계좌가 없는 것으로 본다(결제사를 부르지 않는다). */
export function parseVirtualAccountRefundAccountCandidates(value: unknown): VirtualAccountRefundAccountCandidates | null {
  if (!record(value)) return null;
  const claim = record(value.claim) && text(value.claim.bankName) && text(value.claim.accountNumber) && text(value.claim.holderName)
    ? { bankName: value.claim.bankName, accountNumber: value.claim.accountNumber, holderName: value.claim.holderName }
    : null;
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

/** 환불에 실을 계좌. 구매자가 이 요청에서 입력한 계좌 → 결제 UI 계좌 순서. 쓸 수 있는 계좌가 없으면 null. */
export function selectVirtualAccountRefundAccount(
  candidates: VirtualAccountRefundAccountCandidates | null,
): { readonly account: PaymentRefundReceiveAccount; readonly source: VirtualAccountRefundAccountSource } | null {
  if (!candidates) return null;
  if (candidates.claim) {
    const bankCode = tossBankCodeForName(candidates.claim.bankName);
    // 클레임 계좌번호는 하이픈을 받는다(숫자·하이픈 8~30자). 결제사에는 숫자만 보낸다.
    const accountNumber = candidates.claim.accountNumber.replace(/-/g, '');
    const account = bankCode ? usable({ bankCode, accountNumber, holderName: candidates.claim.holderName }) : null;
    if (account) return { account, source: 'claim' };
  }
  if (candidates.checkout) {
    const account = usable(candidates.checkout);
    if (account) return { account, source: 'checkout' };
  }
  return null;
}
