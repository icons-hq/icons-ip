/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
import { RANDOM_OPTION_PROBLEMS, type RandomOptionProblem } from '@/lib/goods-option-sale-mode';

/* 운영자 화면 어휘는 '상품'·'옵션'이다. */
const RANDOM_OPTION_PROBLEM_MESSAGES: Record<RandomOptionProblem, string> = {
  random_option_count: '판매 중인 옵션이 2개 이상이어야 랜덤 판매를 쓸 수 있습니다.',
  random_option_default_inactive: '첫 번째(기본) 옵션이 판매 중이어야 랜덤 판매를 쓸 수 있습니다.',
  random_option_preorder_mismatch: '랜덤 판매 상품은 판매 중인 모든 옵션이 같은 접수 기간·발송 예정일로 예약판매하거나 모두 일반 재고로 판매해야 합니다. 예약판매의 랜덤 판매 예약에서 모든 옵션을 한 번에 설정하세요.',
  random_option_price_mismatch: '랜덤 판매 상품은 판매 중인 모든 옵션의 판매가와 기간 할인이 같아야 합니다. 기간 할인은 모든 옵션에 한 번에 넣으세요.',
  random_option_limit_mismatch: '랜덤 판매 상품은 옵션별 구매 제한(같은 옵션 배정 상한)이 판매 중인 모든 옵션에서 같아야 합니다.',
  random_option_custom_inputs: '직접 입력 옵션이 있으면 랜덤 판매를 쓸 수 없습니다.',
  random_option_aggregation: '옵션을 상품으로 나눈 이력이 있는 상품은 랜덤 판매를 쓸 수 없습니다.',
  random_option_group: '그룹상품에 묶인 상품은 랜덤 판매를 쓸 수 없습니다.',
  random_option_subscription: '정기배송을 쓰는 상품은 랜덤 판매로 바꿀 수 없습니다. 정기배송 정책을 끄고 진행 중인 정기배송이 끝난 뒤 바꾸세요.',
  random_option_gift_pending: '수락 대기 중인 선물에 담긴 상품은 랜덤 판매로 바꿀 수 없습니다. 선물이 주문되거나 끝난 뒤 바꾸세요.',
};

/**
 * setter·옵션 저장·기간 할인 저장이 랜덤 조건으로 거절됐을 때의 운영자 문구. DB 메시지를 그대로 받아도 된다.
 * 상품 저장 액션(`app/admin/actions.ts`)도 같은 함수로 random_option_* 거절을 옮길 수 있다.
 */
export function goodsOptionSaleModeErrorMessage(message: string): string {
  const problem = RANDOM_OPTION_PROBLEMS.find((code) => message.includes(code));
  if (problem) return RANDOM_OPTION_PROBLEM_MESSAGES[problem];
  if (message.includes('goods_changed')) return '다른 곳에서 상품이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.';
  if (message.includes('operator_capability_required') || message.includes('forbidden')) return '상품 판매 방식을 바꿀 권한이 없습니다.';
  if (message.includes('catalog_archived')) return '보관된 상품은 판매 방식을 바꿀 수 없습니다.';
  if (message.includes('good_not_found')) return '상품을 찾지 못했습니다.';
  return '판매 방식을 바꾸지 못했습니다. 잠시 후 다시 시도하세요.';
}
