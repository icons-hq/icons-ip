import type { AdminHelpBook } from './types';

/**
 * 상품 '이어서 설정'·'상품과 함께 저장할 설정' 패널의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 화면 구조·미리보기·이름으로 풀리지 않는 개념에만 단다. 한두 문장, 옆자리 동료에게 말하듯 쓴다.
 * 칸 이름을 바꾸면 이 글 안의 칸 이름도 함께 바꾼다(화면에 적힌 그대로 쓴다).
 */
export const GOOD_FIELDS_B_HELP = {
  /* ── 복수구매 할인·착불·수량별 배송비 ── */
  volumeDiscount: {
    what: '같은 상품을 여러 개 살 때 개당 금액을 깎아 줍니다. 옵션이 달라도 같은 상품이면 수량을 합쳐 셉니다.',
    caution: '기간 할인가에서 먼저 깎고, 쿠폰과 적립금은 그다음에 적용합니다. 비율 할인은 개당 1원 미만을 버립니다.',
  },
  ownShippingRule: {
    what: '이 상품에만 쓰는 배송비 규칙입니다. 끄면 배송·반품·결제 카드에서 정한 배송비를 그대로 받습니다.',
    when: '착불로 받거나, 여러 개 살 때 개수에 따라 배송비를 다르게 받는 상품만 켭니다.',
  },
  quantityShipping: {
    what: '같은 상품이면 옵션이 달라도 수량을 합쳐 개수를 셉니다. 그 개수에 따라 배송비가 정해집니다.',
  },

  /* ── 수령 방식 ── */
  digitalFiles: {
    what: '결제가 확인된 로그인 구매자만 파일을 내려받을 수 있습니다.',
    caution: '환불하면 더는 내려받을 수 없습니다. 이미 내려받기 시작한 주문의 취소는 담당자가 검토합니다.',
  },

  /* ── 정기배송 ── */
  subscription: {
    what: '고객이 고른 주기마다 같은 상품을 반복해서 받는 판매입니다.',
    where: '신청 화면에서 첫 회차와 다음 회차의 결제 금액·주기를 나눠 보여 줍니다.',
    caution: '이후 가격이나 배송 조건이 바뀌면 고객이 다시 확인한 뒤 결제합니다.',
  },
} as const satisfies AdminHelpBook;

export type GoodFieldsBHelpKey = keyof typeof GOOD_FIELDS_B_HELP;
