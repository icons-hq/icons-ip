import 'server-only';

import { createServiceClient } from '../supabase/service';

// 토스 paymentKey wire 형식 — 콜백·웹훅 파서·어댑터와 같은 계약(최대 200자, 제어문자·공백 금지).
const PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;

/**
 * 굿즈 결제 시도의 재정합 힌트로 쓸 결제 키(ADR-0049). 가상계좌 원장의 결제 키, 없으면 마지막 결제사 증거의 결제 키다.
 *
 * 주문서형 시크릿 키(gsk)가 쓸 수 있다고 명시된 조회는 paymentKey 조회뿐이라(공식문서 /reference/using-api/api-keys), 본문에
 * 결제 키가 없는 웹훅(DEPOSIT_CALLBACK)·자동 재확인 cron·입금 전 취소의 반납이 이 키로 조회한다. 힌트는 확정 근거가 아니다 —
 * 게이트웨이가 조회 응답이 이 시도(주문·상점)와 맞을 때만 쓴다. 조회 실패·키 없음은 undefined(힌트 없이 orderId 조회).
 */
export async function loadGoodsPaymentKeyHint(attemptId: string): Promise<string | undefined> {
  try {
    const { data, error } = await createServiceClient().rpc('service_goods_attempt_payment_key_hint', {
      p_attempt_id: attemptId,
    });
    if (error || typeof data !== 'string' || !PAYMENT_KEY.test(data)) return undefined;
    return data;
  } catch {
    return undefined;
  }
}
