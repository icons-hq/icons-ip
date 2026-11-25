import 'server-only';

import type { PaymentRefundReceiveAccount } from './gateway';
import type { createServiceClient } from '../supabase/service';
import { parseVirtualAccountRefundAccountCandidates, selectVirtualAccountRefundAccount } from './virtual-account-refund-account';

/**
 * 가상계좌 결제의 환급 계좌(service 전용 RPC, ADR-0049 결정 5 보강). 이 요청에서 구매자가 입력한 계좌(반품·취소 신청 화면·주문 상세, 운영자
 * 대신 입력)를 먼저, 없으면 결제 UI가 받은 계좌를 쓴다(lib/payments/virtual-account-refund-account.ts). 원장 결제 키가 다르거나 가상계좌가
 * 아니면 RPC가 null이다. 쓸 계좌가 없으면 undefined — 어댑터가 결제사를 부르지 않고 결제확인필요(계좌 없음)로 남긴다.
 * 조회 자체가 실패하면 계좌 없음과 구분해 던진다 — 환불 호출부가 결제사를 부르지 않고 '결제사 응답 없음'(provider_unavailable, 운영자
 * [상태 다시 확인]으로 다시 시도)으로 남긴다. 계좌 없음으로 적으면 구매자에게 계좌를 다시 입력하라는 잘못된 안내가 나간다.
 *
 * 전액 취소(취소 오케스트레이터)와 부분 취소·부분 반품(부분 취소 오케스트레이터, 2026-11-25 보강)이 같은 고르기를 쓴다. 재고 부족 부분 취소는
 * 취소·반품 요청이 없어(requestId 없음) 결제 UI 계좌만 후보다.
 */
export async function loadVirtualAccountRefundAccount(
  service: ReturnType<typeof createServiceClient>,
  attemptId: string,
  paymentKey: string,
  requestId: string | null | undefined,
): Promise<PaymentRefundReceiveAccount | undefined> {
  const { data, error } = await service.rpc('service_goods_virtual_account_refund_accounts', {
    p_attempt_id: attemptId,
    p_payment_key: paymentKey,
    p_request_id: requestId ?? null,
  });
  if (error) throw new Error('virtual account refund account lookup failed');
  return selectVirtualAccountRefundAccount(parseVirtualAccountRefundAccountCandidates(data))?.account;
}
