import type { AdminHelpBook } from './types';

/**
 * 주문 상세의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 이 화면의 "?"는 한 곳뿐이다 — '결제 전 확인 동의' 칸에 기록이 없는 주문이 왜 있는지는 이름만으로 알 수 없다.
 * 칸 이름은 화면에 적힌 그대로 쓴다. 화면에서 바꾸면 여기도 함께 바꾼다.
 */
export const ORDER_DETAIL_HELP = {
  /* '결제 전 확인 동의' 칸의 '동의 기록이 없습니다.' 옆. */
  acknowledgementMissing: {
    what: '동의 기록이 없는 주문은 세 가지입니다. 기록을 만들기 전에 주문한 건, 기록을 저장하지 못한 건, 정기구매 주문입니다.',
    caution: '정기구매 주문은 정기구매 약관 동의로 대신해 이 칸에 기록이 남지 않습니다. 기록이 없어도 주문과 결제는 정상입니다.',
  },
} as const satisfies AdminHelpBook;

export type OrderDetailHelpKey = keyof typeof ORDER_DETAIL_HELP;
