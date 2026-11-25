import type { AdminHelpBook } from './types';

/**
 * 상품 등록·수정 화면 '판매 시기'의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 세 선택지는 카드가 스스로 말하므로 여기에는 화면에 보이지 않는 것만 쓴다 — 예약 주문과 재고의 관계, 주문 후 제작과의 차이.
 * 칸 이름을 바꾸면 이 글 안의 이름도 함께 바꾼다(화면에 적힌 그대로 쓴다).
 */
export const GOOD_SALE_TIMING_HELP = {
  saleTiming: {
    what: '예약판매는 아직 창고에 없는 상품을 미리 결제받고, 들어온 뒤 정한 날 보냅니다. 예약 주문은 재고수량을 줄이지 않습니다.',
    when: "주문을 받고 나서 만드는 상품은 예약판매가 아니라 '주문 후 제작'을 씁니다. 날짜 대신 결제 뒤 며칠 안에 보내는지 안내합니다.",
    where: "접수 시작 전에는 고객 화면에 '판매 예정'으로 보이고 주문은 받지 않습니다.",
  },
} as const satisfies AdminHelpBook;

export type GoodSaleTimingHelpKey = keyof typeof GOOD_SALE_TIMING_HELP;
