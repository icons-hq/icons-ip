import { productionError } from '@/lib/order-production';

/** 저장 결과를 모를 때. 패널의 [저장됐는지 확인]은 같은 작업 번호로 다시 보내므로 두 번 저장되지 않는다. */
export const GOODS_PRODUCTION_SAVE_UNCERTAIN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';

const OWN: Record<string, string> = {
  production_changed: '다른 사람이 먼저 바꿨습니다. [현재 주문제작 설정 불러오기]를 눌러 지금 설정을 확인한 뒤 다시 저장해주세요.',
  transaction_runtime_disabled: '지금은 주문 후 제작을 켤 수 없습니다. 운영 설정을 확인해주세요.',
  /* 디지털 파일 상품에 주문 후 제작을 켜면 DB가 거절한다(private.digital_supply_guard). */
  digital_supply_conflict: '디지털 파일을 제공하는 상품에는 주문 후 제작을 쓸 수 없습니다. 수령 방식을 먼저 바꿔주세요.',
};
const SHARED_INVALID = productionError('22023'), SHARED_UNKNOWN = productionError();

/**
 * 상품의 주문 후 제작 설정(불러오기·저장) 오류 문구. 운영자 화면 전용이다.
 * 주문 상세의 제작 시작·완료 기록은 productionError를 그대로 쓴다 — 그쪽 문구는 기록할 때 적는 '처리 근거'까지 말하는데,
 * 상품 설정에는 근거 칸이 없다(2026-11-25 결정). 그래서 두 문구만 상품 설정에 맞게 바꾼다.
 */
export function goodsProductionError(code?: string, message?: string) {
  const own = OWN[message ?? ''];
  if (own) return own;
  const shared = productionError(code, message);
  if (shared === SHARED_INVALID) return '발송 예정 기간(1~365일)·기간 계산 기준·휴무일 날짜를 확인해주세요.';
  if (shared === SHARED_UNKNOWN) return '처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  return shared;
}
