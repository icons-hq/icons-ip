/*
 * 토스 failUrl 복귀 안내 문구. 굿즈 주문서(/checkout)와 주문 결제
 * (/checkout/[orderId]) 두 복귀 화면이 같은 문구를 쓴다 — 사본이 갈라지면 같은
 * 실패가 화면마다 다르게 읽힌다. 쿼리의 message는 위조 가능한 외부 문자열이라
 * 표시하지 않고, 서버가 형식 검증까지 마친 code를 우리 문구로만 바꾼다. 미지
 * 코드는 공통 문구로 덮어 provider 원문이 화면에 새지 않게 한다.
 */
const paymentFailCopy: Record<string, string> = {
  PAY_PROCESS_CANCELED: '결제를 직접 취소하셨어요. 준비되면 같은 주문에서 다시 시도할 수 있어요.',
  PAY_PROCESS_ABORTED: '결제가 진행되지 않았어요. 잠시 후 같은 주문에서 다시 시도해주세요.',
  REJECT_CARD_COMPANY: '카드사가 결제를 거절했어요. 다른 카드나 결제수단으로 다시 시도해주세요.',
};
const paymentFailFallback = '결제가 완료되지 않았어요. 같은 주문에서 다시 시도해주세요.';

export function paymentFailNoticeCopy(code: string): string {
  return paymentFailCopy[code] ?? paymentFailFallback;
}
