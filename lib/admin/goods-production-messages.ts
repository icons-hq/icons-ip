import { productionError } from '@/lib/order-production';

/** 저장 결과를 모를 때. 패널의 [저장됐는지 확인]은 같은 작업 번호로 다시 보내므로 두 번 저장되지 않는다. */
export const GOODS_PRODUCTION_SAVE_UNCERTAIN = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';

/** 상품 수정 화면의 주문 후 제작을 고치다 떠날 때 묻는 말(따로 저장하는 영역이라 [주문제작 설정 저장]을 눌러야 저장된다). */
export const GOODS_PRODUCTION_LEAVE_MESSAGE = '주문 후 제작을 고친 뒤 [주문제작 설정 저장]을 누르지 않았습니다. 이 화면을 떠나면 적은 내용이 사라집니다. 이동할까요?';

/**
 * 주문 후 제작은 쇼핑몰 전체에 걸린 주문 설정이 켜져 있어야 켤 수 있다(꺼져 있으면 DB가 켠 채 저장하는 것을 거절한다. 끄는 저장은 된다).
 * 그 설정을 켜는 어드민 화면은 없고 개발 담당자가 켠다. 화면은 상품을 열 때 그 설정을 읽어, 꺼져 있으면 켜기 전에 막는다(화면 규칙 5).
 */
export const GOODS_PRODUCTION_RUNTIME_OFF = '지금 쇼핑몰 설정에서는 주문 후 제작을 켤 수 없습니다. 써야 하면 개발 담당자에게 요청해 주세요.';
/** 이미 켜져 있는 상품에서, 그리고 화면이 미리 막지 못한 채 저장이 거절됐을 때. */
export const GOODS_PRODUCTION_RUNTIME_OFF_ENABLED = '지금 쇼핑몰 설정에서는 주문 후 제작을 켠 채로 저장할 수 없습니다. 끄고 저장하거나, 써야 하면 개발 담당자에게 요청해 주세요.';

const OWN: Record<string, string> = {
  production_changed: '다른 사람이 먼저 바꿨습니다. [현재 주문제작 설정 불러오기]를 눌러 지금 설정을 확인한 뒤 다시 저장해주세요.',
  transaction_runtime_disabled: GOODS_PRODUCTION_RUNTIME_OFF_ENABLED,
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
