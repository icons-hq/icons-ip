import type { AdminHelpBook } from './types';

/**
 * 상품 편집기 본문(판매 정보·기본 정보·상세설명·고시·배송·추가 설정)의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 화면 구조·미리보기·이름으로 풀리지 않는 개념에만 단다. 한두 문장, 옆자리 동료에게 말하듯 쓴다.
 * 칸 이름을 바꾸면 이 글 안의 칸 이름도 함께 바꾼다(화면에 적힌 그대로 쓴다). good-editor.ts의 말투를 따른다.
 */
export const GOOD_FIELDS_A_HELP = {
  /* ── 배송·반품·결제 ── */
  claimFees: {
    what: '고객 사정(단순 변심 등)으로 반품·교환할 때 고객이 내는 비용입니다. 편도는 한 번 가는 값이고, 왕복 합계는 보내고 받는 값의 합입니다.',
  },

  /* ── 추가 설정 ── */
  customInputs: {
    what: '각인 문구처럼 고객이 주문할 때 직접 적는 글을 받는 칸입니다.',
    caution: '받은 글은 옵션이 아니라서 가격과 재고에는 영향이 없습니다.',
  },
} as const satisfies AdminHelpBook;

export type GoodFieldsAHelpKey = keyof typeof GOOD_FIELDS_A_HELP;
