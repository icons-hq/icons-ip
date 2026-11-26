import type { AdminHelpBook } from './types';

/**
 * 주문통합검색의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 이 묶음의 "?"는 한 곳뿐이다 — 상품주문별 조회의 '할인·적립금 배분' 열은 이름만으로는 무엇을 나눈 값인지 알 수 없다.
 * 칸 이름은 화면에 적힌 그대로 쓴다. 화면에서 바꾸면 여기도 함께 바꾼다.
 */
export const SALES_ORDERS_HELP = {
  /* 상품주문별 조회의 '할인·적립금 배분' 열. 표 위 건수 줄 옆에 단다(표 머리글은 글자만 받는다). */
  allocation: {
    what: '주문에 쓴 쿠폰·적립금·복수구매 할인을 상품 줄마다 나눈 금액입니다. 거래확정 엑셀과 같은 규칙으로 나눕니다.',
    where: '나눈 뒤 금액은 배분 후 금액 열에 보이고, 배송비는 들어 있지 않습니다.',
    caution: '주문 당시 기록이 없어 나눌 수 없는 줄은 —로 보입니다.',
  },
} as const satisfies AdminHelpBook;

export type SalesOrdersHelpKey = keyof typeof SALES_ORDERS_HELP;
