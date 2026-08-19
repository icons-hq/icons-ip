import 'server-only';

import { getServiceRoleConfig } from '../supabase/service';
import type { BankTransferAccount } from './bank-transfer';

/**
 * 법인계좌는 서버 설정에서만 읽는다 (#256).
 *
 * DB에 두지 않는 이유는 두 가지다. 계좌 정보는 카탈로그가 아니라 회사 설정이고,
 * 아직 확정되지 않았다(#255). 값이 하나라도 비면 무통장 결제수단 자체가 뜨지
 * 않는다 — 계좌 없이 "입금해주세요"를 띄우는 것이 최악이다.
 */
export function getBankTransferAccount(): BankTransferAccount | null {
  const bank = process.env.BANK_TRANSFER_BANK_NAME?.trim();
  const accountNumber = process.env.BANK_TRANSFER_ACCOUNT_NUMBER?.trim();
  const holder = process.env.BANK_TRANSFER_ACCOUNT_HOLDER?.trim();
  if (!bank || !accountNumber || !holder) return null;
  return { bank, accountNumber, holder };
}

/**
 * 무통장 주문을 받을 수 있는지.
 *
 * 카드와 달리 PG provider gate를 보지 않는다 — 무통장에는 결제사가 없다.
 * 필요한 것은 주문 생성을 대신 부를 서버 신뢰 경계와 입금받을 계좌뿐이다.
 */
export function bankTransferCheckoutEnabled() {
  return getServiceRoleConfig().isConfigured && getBankTransferAccount() !== null;
}
